"use client";

import { useEffect, useRef } from "react";
import type { Scene } from "@/lib/broadcast/scene";
import { Compositor } from "@/lib/broadcast/compositor";

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
// ────────────────────────────────────────────────────────────────

interface SceneCanvasProps {
  scene: Scene;
  /** 显示尺寸 (CSS 像素), 不影响 scene 内部分辨率. */
  className?: string;
  onSourceError?: (sourceId: string, error: Error) => void;
  onScreenEnded?: (sourceId: string) => void;
}

export function SceneCanvas({
  scene,
  className,
  onSourceError,
  onScreenEnded,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<Compositor | null>(null);

  // 把回调引用稳到 ref 里, 避免 compositor 因 callback 变化反复重建.
  // ref 更新必须在 effect 里 (React 19 禁止 render 阶段 mutate ref).
  const errCbRef = useRef(onSourceError);
  const endedCbRef = useRef(onScreenEnded);
  useEffect(() => {
    errCbRef.current = onSourceError;
    endedCbRef.current = onScreenEnded;
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
