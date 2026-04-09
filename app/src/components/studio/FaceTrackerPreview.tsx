"use client";

import { useEffect, useRef, useState } from "react";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { faceTracker } from "@/lib/broadcast/face-tracker";
import { studioConfig } from "@/lib/broadcast/studio-config";

// ────────────────────────────────────────────────────────────────
// FaceTrackerPreview — full-screen modal 显示 MediaPipe face mesh
// 实时可视化, 灵感来自 OpenSeeFace 的预览界面.
//
// 内容:
//   - 顶部状态栏: 录制指示灯 + FPS + Confidence% + 关闭按钮
//   - 中央: white canvas, 蓝色点 + 蓝色线 (face oval / lips / eyes),
//     红色高亮线 (eyebrows)
//   - 底部: 大 Calibrate 按钮 (跟 MotionSettingsPanel 同 logic)
//
// 数据流: faceTracker.snapshot 每帧 face tracker 内部更新, 这里用
// requestAnimationFrame 轮询读取 + 重画. 不走 listener subscription
// 因为 modal 只在用户打开时活, 不需要复杂的订阅 / 取消.
//
// 镜像: canvas 画 landmark 时 X 翻转 (1 - x), 让 preview 像照镜子.
// ────────────────────────────────────────────────────────────────

interface FaceTrackerPreviewProps {
  open: boolean;
  onClose: () => void;
}

interface Connection {
  start: number;
  end: number;
}

// MediaPipe 的 connections constants 在 FaceLandmarker 上, 类型是
// `{ start: number; end: number }[]`. 我们包成 type-safe 的引用.
const FACE_OVAL = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL as Connection[];
const LIPS = FaceLandmarker.FACE_LANDMARKS_LIPS as Connection[];
const LEFT_EYE = FaceLandmarker.FACE_LANDMARKS_LEFT_EYE as Connection[];
const RIGHT_EYE = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE as Connection[];
const LEFT_EYEBROW = FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW as Connection[];
const RIGHT_EYEBROW = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW as Connection[];

function drawConnections(
  ctx: CanvasRenderingContext2D,
  landmarks: { x: number; y: number }[],
  conns: Connection[],
  color: string,
  lineWidth: number,
  width: number,
  height: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const c of conns) {
    const a = landmarks[c.start];
    const b = landmarks[c.end];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo((1 - a.x) * width, a.y * height);
    ctx.lineTo((1 - b.x) * width, b.y * height);
    ctx.stroke();
  }
}

export function FaceTrackerPreview({ open, onClose }: FaceTrackerPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [calibState, setCalibState] = useState<"idle" | "sampling" | "done">(
    "idle"
  );

  // RAF 循环画 face mesh
  useEffect(() => {
    if (!open) return;

    let rafId = 0;
    let lastConfidenceUpdate = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const W = canvas.width;
          const H = canvas.height;
          // 白底
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, W, H);

          const snap = faceTracker.snapshot;
          const lms = snap.landmarks;

          if (lms.length > 0) {
            // 连线 — 蓝色细线: 脸轮廓 / 嘴 / 眼
            const blue = "#4a90e2";
            drawConnections(ctx, lms, FACE_OVAL, blue, 2, W, H);
            drawConnections(ctx, lms, LIPS, blue, 2, W, H);
            drawConnections(ctx, lms, LEFT_EYE, blue, 2, W, H);
            drawConnections(ctx, lms, RIGHT_EYE, blue, 2, W, H);
            // 鼻梁 — 简单连一条线 (landmark 1 是鼻尖, 168 是鼻根)
            const noseStart = lms[168];
            const noseEnd = lms[1];
            if (noseStart && noseEnd) {
              ctx.strokeStyle = blue;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo((1 - noseStart.x) * W, noseStart.y * H);
              ctx.lineTo((1 - noseEnd.x) * W, noseEnd.y * H);
              ctx.stroke();
            }

            // 眉毛 — 红色粗线高亮 (情绪载体, 跟 OSF 风格一致)
            const red = "#ff7070";
            drawConnections(ctx, lms, LEFT_EYEBROW, red, 5, W, H);
            drawConnections(ctx, lms, RIGHT_EYEBROW, red, 5, W, H);

            // landmark 点 — 蓝色小圆点
            ctx.fillStyle = blue;
            for (const lm of lms) {
              const x = (1 - lm.x) * W;
              const y = lm.y * H;
              ctx.beginPath();
              ctx.arc(x, y, 1.8, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            // 没检测到脸 — 提示
            ctx.fillStyle = "#999";
            ctx.font = "16px monospace";
            ctx.textAlign = "center";
            ctx.fillText("No face detected", W / 2, H / 2);
          }

          // 每 200ms 更新一次 React state (FPS / confidence), 避免每帧
          // setState 触发不必要的 React render
          const now = performance.now();
          if (now - lastConfidenceUpdate > 200) {
            lastConfidenceUpdate = now;
            setFps(snap.fps);
            setConfidence(snap.hasDetection ? 100 : 0);
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  // ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const calibrate = () => {
    studioConfig.calibrationVersion += 1;
    setCalibState("sampling");
    setTimeout(() => setCalibState("done"), 600);
    setTimeout(() => setCalibState("idle"), 1500);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="pixel-border-glow bg-bg-card max-w-2xl w-full p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — recording indicator + FPS + Confidence + close */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="w-3 h-3 rounded-full bg-accent-red animate-pulse flex-shrink-0" />
            <span className="font-mono text-sm text-text-primary">
              {fps} FPS
            </span>
            <span className="text-text-secondary">·</span>
            <span className="font-mono text-sm text-text-primary">
              Confidence: {confidence}%
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-accent-red hover:text-accent-pink text-3xl leading-none flex-shrink-0 px-2"
            title="关闭 (ESC)"
          >
            ×
          </button>
        </div>

        {/* Canvas — white background, face mesh visualization */}
        <div className="bg-white pixel-border overflow-hidden">
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            className="w-full block"
            style={{ aspectRatio: "640 / 480" }}
          />
        </div>

        {/* Calibrate — 大蓝色按钮, 跟 modal 风格一致 */}
        <button
          type="button"
          onClick={calibrate}
          disabled={calibState === "sampling"}
          className={`w-full pixel-border px-4 py-3 font-[family-name:var(--font-pixel)] text-[10px] uppercase tracking-wider transition-colors disabled:cursor-not-allowed ${
            calibState === "sampling"
              ? "bg-accent-yellow/30 text-accent-yellow"
              : calibState === "done"
                ? "bg-accent-green/30 text-accent-green"
                : "bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30"
          }`}
        >
          {calibState === "sampling"
            ? "⏺ 采样中... 保持不动 0.5 秒"
            : calibState === "done"
              ? "✓ 已校准"
              : "⊕ Calibrate"}
        </button>
      </div>
    </div>
  );
}
