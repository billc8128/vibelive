"use client";

import { useEffect, useRef } from "react";
import type { Scene } from "@/lib/broadcast/scene";
import { Compositor } from "@/lib/broadcast/compositor";
import { faceTracker } from "@/lib/broadcast/face-tracker";

// ────────────────────────────────────────────────────────────────
// SceneCanvas — React wrapper around the imperative Compositor.
//
// 关键的 React 接口设计:
//   - mount 时建立一个 Compositor 实例并 start
//   - scene prop 变化时调用 compositor.updateScene (浅 diff)
//   - unmount 时 stop, 释放摄像头/屏幕共享/Live2D 等资源
//
// 不把 compositor 放进 useState — 它是 mutable, 不应触发 React 重渲染.
// 用 useRef 持有, 让 React 仅负责入口/出口的生命周期.
//
// 面部追踪:
//   - faceTrackingEnabled prop 控制 faceTracker 启停
//   - 启动时 subscribe faceTracker, 把 inputs 推给 compositor
//   - 关闭/卸载时 unsubscribe + faceTracker.stop()
// ────────────────────────────────────────────────────────────────

interface SceneCanvasProps {
  scene: Scene;
  /** 显示尺寸 (CSS 像素), 不影响 scene 内部分辨率. */
  className?: string;
  /** 是否启用 MediaPipe 面部追踪 → 推送给所有 Live2D renderer */
  faceTrackingEnabled?: boolean;
  onSourceError?: (sourceId: string, error: Error) => void;
  onScreenEnded?: (sourceId: string) => void;
  /** 面部追踪启动失败 (用户拒绝授权 / 模型加载失败 等) */
  onFaceTrackingError?: (error: Error) => void;
}

export function SceneCanvas({
  scene,
  className,
  faceTrackingEnabled = false,
  onSourceError,
  onScreenEnded,
  onFaceTrackingError,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<Compositor | null>(null);

  // 把回调引用稳到 ref 里, 避免 compositor 因 callback 变化反复重建.
  // ref 更新必须在 effect 里 (React 19 禁止 render 阶段 mutate ref).
  const errCbRef = useRef(onSourceError);
  const endedCbRef = useRef(onScreenEnded);
  const faceErrCbRef = useRef(onFaceTrackingError);
  useEffect(() => {
    errCbRef.current = onSourceError;
    endedCbRef.current = onScreenEnded;
    faceErrCbRef.current = onFaceTrackingError;
  });

  // 启动 / 销毁 compositor (仅 mount/unmount)
  //
  // scene 故意不放依赖里 — 我们在下一个 effect 用 updateScene 推送变化,
  // 不希望每次 scene 变都重建整个 compositor (那会重启摄像头等). 用一个
  // ref 把"最初"的 scene 闭包进去, 仅供 start() 拿首屏分辨率使用.
  const initialSceneRef = useRef(scene);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const compositor = new Compositor({
      onSourceError: (id, err) => errCbRef.current?.(id, err),
      onScreenEnded: (id) => endedCbRef.current?.(id),
    });
    compositor.start(canvas, initialSceneRef.current);
    compositorRef.current = compositor;

    return () => {
      compositor.stop();
      compositorRef.current = null;
    };
  }, []);

  // Scene 变化时 push 给 compositor
  useEffect(() => {
    compositorRef.current?.updateScene(scene);
  }, [scene]);

  // ── 面部追踪生命周期 ──────────────────────────────────────────
  // faceTrackingEnabled toggle:
  //   true  → start tracker + subscribe → relay 给 compositor
  //   false → unsubscribe + stop tracker
  //
  // 注意: faceTracker 是 module 级单例 (一个 webcam, 多个 listener).
  // 如果未来同时有多个 SceneCanvas (e.g. studio + 预览缩略图), 它们
  // 共用同一个 tracker, 引用计数靠 listener 数量自然成立.
  useEffect(() => {
    if (!faceTrackingEnabled) {
      // 关闭路径 — 如果没有其他 listener, 关掉 tracker
      // 简化版: 只有一个 SceneCanvas, 关掉就直接 stop
      faceTracker.stop();
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        await faceTracker.start();
        if (cancelled) {
          faceTracker.stop();
          return;
        }
        unsubscribe = faceTracker.subscribe((inputs) => {
          compositorRef.current?.setTrackingInputs(inputs);
        });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.warn("[SceneCanvas] face tracker start failed:", err.message);
        faceErrCbRef.current?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      // 这里也 stop, 因为目前是单 listener — 如果未来支持多 SceneCanvas
      // 共享, 这里要换成引用计数.
      faceTracker.stop();
    };
  }, [faceTrackingEnabled]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // 内部分辨率由 compositor.start 设, 这里只控 CSS 显示尺寸
      style={{
        width: "100%",
        height: "auto",
        aspectRatio: `${scene.width} / ${scene.height}`,
        background: "#0a0a14",
      }}
    />
  );
}
