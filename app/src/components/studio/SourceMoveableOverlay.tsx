"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import Moveable from "react-moveable";
import type { Scene, SceneAction } from "@/lib/broadcast/scene";

// ────────────────────────────────────────────────────────────────
// SourceMoveableOverlay — react-moveable 包装层, 让用户在 canvas 上
// 直接拖动 / 调整 source 大小, 替代 inspector 里的数字输入框 (那些
// 还能用, 但不再是唯一入口).
//
// 坐标系:
//   scene 空间   = compositor 内部分辨率 (e.g. 1920×1080), source.transform
//                 的 x/y/w/h 都在这个空间.
//   display 空间 = canvas 在屏幕上实际占的 CSS 像素, 由父容器宽度决定.
//
// 我们用 ResizeObserver 监听 canvas 实际尺寸 → 算 scale = displayW/sceneW.
// 每个 source 渲染一个透明 div 在 display 空间 (t.x*scale, t.y*scale).
// react-moveable 包住 selected target, 拖动时回调给的 left/top 还是
// display 空间, 我们 / scale 转回 scene-space dispatch updateTransform.
//
// 选择交互:
//   - 未选中 source 上点击 → dispatch select (这一下不拖动, 两步操作)
//   - 已选中后, Moveable 在 target 上挂自己的 mousedown listener, 用户
//     按下并拖动 → 真实拖动. 选+拖分两步是因为如果第一下就触发拖动,
//     React 重渲染要先 mount Moveable 才能 capture mousedown, 时间窗口
//     做不到无缝, 反而易出 bug. OBS / Figma 也是两步.
//
// SSR: 这个组件不直接 import, 通过 dynamic({ ssr: false }) 加载 — Moveable
// 在模块顶层访问 window. 引入路径在 SceneCanvas wrapper 旁边.
// ────────────────────────────────────────────────────────────────

interface SourceMoveableOverlayProps {
  scene: Scene;
  dispatch: (action: SceneAction) => void;
  /** SceneCanvas 内部 canvas 元素的 ref. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function SourceMoveableOverlay({
  scene,
  dispatch,
  canvasRef,
}: SourceMoveableOverlayProps) {
  // display 空间下的 canvas 尺寸 + scene→display 缩放系数
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const scale = displaySize.width > 0 && scene.width > 0 ? displaySize.width / scene.width : 0;

  // 每个 source id → DOM target div, 给 react-moveable 用
  const targetMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectedTarget, setSelectedTarget] = useState<HTMLElement | null>(null);

  // ── 监听 canvas 显示尺寸 (ResizeObserver + 初始读取) ──
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sync = () => {
      const r = canvas.getBoundingClientRect();
      setDisplaySize({ width: r.width, height: r.height });
    };
    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef]);

  // ── 同步 selected target (scene.selectedId 变化或 source 列表变化) ──
  useEffect(() => {
    if (!scene.selectedId) {
      setSelectedTarget(null);
      return;
    }
    const el = targetMap.current.get(scene.selectedId);
    setSelectedTarget(el ?? null);
    // depend on sources 是为了 source 列表重渲染后 ref map 已经更新
  }, [scene.selectedId, scene.sources]);

  if (scale === 0) return null;

  return (
    <div
      className="absolute inset-0"
      // overlay 整体不挡 canvas 上的鼠标事件; 只有 target div 自己挡
      style={{ pointerEvents: "none" }}
    >
      {scene.sources.map((source) => {
        const t = source.transform;
        const isSelected = source.id === scene.selectedId;
        return (
          <div
            key={source.id}
            ref={(el) => {
              if (el) {
                targetMap.current.set(source.id, el);
              } else {
                targetMap.current.delete(source.id);
              }
            }}
            onMouseDown={(e) => {
              // 仅未选中时拦截 — 选中后让 Moveable 抓事件做拖动
              if (!isSelected) {
                e.stopPropagation();
                dispatch({ type: "select", id: source.id });
              }
            }}
            className={`absolute transition-colors ${
              isSelected
                ? "border border-accent-cyan/90"
                : "border border-white/15 hover:border-accent-cyan/50 cursor-pointer"
            }`}
            style={{
              left: t.x * scale,
              top: t.y * scale,
              width: t.width * scale,
              height: t.height * scale,
              pointerEvents: "auto",
            }}
            title={source.name}
          />
        );
      })}

      {selectedTarget && (
        <Moveable
          target={selectedTarget}
          draggable
          resizable
          // origin disable — 不在中心画一个原点圈, 干净一点
          origin={false}
          // 不限制方向, 任意边都能拽
          edge={false}
          throttleDrag={0}
          throttleResize={0}
          // 内部 transform 用 px (我们外层设的 left/top), 不要 Moveable 用
          // CSS transform 重写 (那样会让我们的 left/top 失效)
          useResizeObserver
          onDrag={({ left, top }) => {
            // 即时反馈 — 直接改 DOM, 同时 dispatch 更新 React state
            selectedTarget.style.left = `${left}px`;
            selectedTarget.style.top = `${top}px`;
            if (scene.selectedId) {
              dispatch({
                type: "updateTransform",
                id: scene.selectedId,
                patch: {
                  x: Math.round(left / scale),
                  y: Math.round(top / scale),
                },
              });
            }
          }}
          onResize={({ width, height, drag }) => {
            selectedTarget.style.width = `${width}px`;
            selectedTarget.style.height = `${height}px`;
            selectedTarget.style.left = `${drag.left}px`;
            selectedTarget.style.top = `${drag.top}px`;
            if (scene.selectedId) {
              dispatch({
                type: "updateTransform",
                id: scene.selectedId,
                patch: {
                  width: Math.round(width / scale),
                  height: Math.round(height / scale),
                  x: Math.round(drag.left / scale),
                  y: Math.round(drag.top / scale),
                },
              });
            }
          }}
        />
      )}
    </div>
  );
}
