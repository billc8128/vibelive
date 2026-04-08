"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Scene } from "@/lib/broadcast/scene";
import type { Live2DHotkey } from "@/lib/broadcast/sources";
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
  /**
   * 父组件 ref — SceneCanvas 把 internal canvas element 写进去, 父组件
   * 在按钮点击等时机用 canvasRef.current 直接调 captureStream() 等.
   * 不传也行 (无需访问 canvas 的纯展示场景).
   */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  onSourceError?: (sourceId: string, error: Error) => void;
  onScreenEnded?: (sourceId: string) => void;
  /** 面部追踪启动失败 (用户拒绝授权 / 模型加载失败 等) */
  onFaceTrackingError?: (error: Error) => void;
  /** Live2D source 加载完 .vtube.json — 把 hotkeys 推回 React state */
  onLive2DReady?: (sourceId: string, hotkeys: Live2DHotkey[]) => void;
}

export function SceneCanvas({
  scene,
  className,
  faceTrackingEnabled = false,
  canvasRef: externalCanvasRef,
  onSourceError,
  onScreenEnded,
  onFaceTrackingError,
  onLive2DReady,
}: SceneCanvasProps) {
  // 内部 ref — compositor 生命周期用; 同时把 element 写入外部 ref (如果有),
  // 让父组件能直接抓 canvas 调 captureStream() 等.
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = (el: HTMLCanvasElement | null) => {
    internalCanvasRef.current = el;
    if (externalCanvasRef) externalCanvasRef.current = el;
  };
  const compositorRef = useRef<Compositor | null>(null);

  // 把回调引用稳到 ref 里, 避免 compositor 因 callback 变化反复重建.
  // ref 更新必须在 effect 里 (React 19 禁止 render 阶段 mutate ref).
  const errCbRef = useRef(onSourceError);
  const endedCbRef = useRef(onScreenEnded);
  const faceErrCbRef = useRef(onFaceTrackingError);
  const live2dReadyCbRef = useRef(onLive2DReady);
  useEffect(() => {
    errCbRef.current = onSourceError;
    endedCbRef.current = onScreenEnded;
    faceErrCbRef.current = onFaceTrackingError;
    live2dReadyCbRef.current = onLive2DReady;
  });

  // 启动 / 销毁 compositor (仅 mount/unmount)
  //
  // scene 故意不放依赖里 — 我们在下一个 effect 用 updateScene 推送变化,
  // 不希望每次 scene 变都重建整个 compositor (那会重启摄像头等). 用一个
  // ref 把"最初"的 scene 闭包进去, 仅供 start() 拿首屏分辨率使用.
  const initialSceneRef = useRef(scene);
  useEffect(() => {
    const canvas = internalCanvasRef.current;
    if (!canvas) return;

    const compositor = new Compositor({
      onSourceError: (id, err) => errCbRef.current?.(id, err),
      onScreenEnded: (id) => endedCbRef.current?.(id),
      onLive2DReady: (id, hotkeys) => live2dReadyCbRef.current?.(id, hotkeys),
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
      ref={setCanvasRef}
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
