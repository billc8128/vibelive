export interface CapturePreviewScreenshotOptions {
  maxWidth?: number;
  mimeType?: string;
  quality?: number;
}

export interface CapturePreviewVideoClipOptions {
  durationMs?: number;
  mimeType?: string;
  videoBitsPerSecond?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_WIDTH = 640;
const DEFAULT_MIME_TYPE = "image/jpeg";
const DEFAULT_QUALITY = 0.7;
const DEFAULT_VIDEO_DURATION_MS = 2_000;
const DEFAULT_VIDEO_MIME_TYPE = "video/webm";
const DEFAULT_VIDEO_BITS_PER_SECOND = 250_000;
const DEFAULT_MAX_VIDEO_BYTES = 350_000;

type CaptureStreamVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
};

export function capturePreviewScreenshot(
  video: HTMLVideoElement,
  options: CapturePreviewScreenshotOptions = {},
) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL(
    options.mimeType ?? DEFAULT_MIME_TYPE,
    options.quality ?? DEFAULT_QUALITY,
  );
}

function pickVideoMimeType(preferredMimeType: string) {
  if (
    typeof MediaRecorder.isTypeSupported !== "function" ||
    MediaRecorder.isTypeSupported(preferredMimeType)
  ) {
    return preferredMimeType;
  }

  return "";
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onloadend = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(blob);
  });
}

export async function capturePreviewVideoClip(
  video: HTMLVideoElement,
  options: CapturePreviewVideoClipOptions = {},
) {
  const captureStream = (video as CaptureStreamVideoElement).captureStream;
  if (typeof MediaRecorder === "undefined" || !captureStream) {
    return null;
  }

  const stream = captureStream.call(video);
  if (!stream.getVideoTracks().length) {
    return null;
  }

  const mimeType = pickVideoMimeType(
    options.mimeType ?? DEFAULT_VIDEO_MIME_TYPE,
  );
  const chunks: Blob[] = [];

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let recorder: MediaRecorder;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond:
          options.videoBitsPerSecond ?? DEFAULT_VIDEO_BITS_PER_SECOND,
      });
    } catch {
      settle(null);
      return;
    }

    const stopTimer = window.setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, options.durationMs ?? DEFAULT_VIDEO_DURATION_MS);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      window.clearTimeout(stopTimer);
      settle(null);
    };
    recorder.onstop = () => {
      window.clearTimeout(stopTimer);
      const blob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || DEFAULT_VIDEO_MIME_TYPE,
      });
      if (
        !blob.size ||
        blob.size > (options.maxBytes ?? DEFAULT_MAX_VIDEO_BYTES)
      ) {
        settle(null);
        return;
      }

      void readBlobAsDataUrl(blob).then(settle);
    };

    recorder.start();
  });
}
