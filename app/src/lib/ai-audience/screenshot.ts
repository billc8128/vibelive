export interface CapturePreviewScreenshotOptions {
  maxWidth?: number;
  mimeType?: string;
  quality?: number;
}

const DEFAULT_MAX_WIDTH = 640;
const DEFAULT_MIME_TYPE = "image/jpeg";
const DEFAULT_QUALITY = 0.7;

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
