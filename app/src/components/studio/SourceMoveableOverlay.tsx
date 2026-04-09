"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import Moveable from "react-moveable";
import type { Scene, SceneAction } from "@/lib/broadcast/scene";
import type { Source } from "@/lib/broadcast/sources";

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
// 每个 source 渲染一个透明 div 在 display 空间.
//
// 交互设计 (一步拖动):
//   - 任何 source 上 pointerdown → 立即 select + 进入 drag 模式
//   - pointer move → 更新 source.transform.x/y (经 setPointerCapture 捕获)
//   - pointer up → 退出 drag 模式
//   - 选中后, Moveable 显示 resize handles, 但 draggable={false} (我们自己
//     处理 drag, Moveable 只负责 resize)
//
// 这样用户体验跟 VTube Studio / OBS 拖元素一致 — 看到就拖, 一步到位.
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

interface DragState {
  sourceId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
}

export function SourceMoveableOverlay({
  scene,
  dispatch,
  canvasRef,
}: SourceMoveableOverlayProps) {
  // display 空间下的 canvas 尺寸 + scene→display 缩放系数
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const scale =
    displaySize.width > 0 && scene.width > 0
      ? displaySize.width / scene.width
      : 0;

  // 每个 source id → DOM target div, 给 react-moveable 用
  const targetMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectedTarget, setSelectedTarget] = useState<HTMLElement | null>(
    null
  );

  // 拖动状态 — ref 而不是 state, 避免每次 pointer move 重渲染整个 overlay.
  const dragRef = useRef<DragState | null>(null);
  // scale 也 ref 化, 让 pointer move handler 能拿到最新值 (closure 抓的是
  // mousedown 时的 scale, 中途 canvas resize 时不会跟进).
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

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
  // Moveable 需要一个 HTMLElement 作为 target prop. 这个 element 由
  // ref callback 写入 targetMap (timing 在 commit 阶段, 早于 effect),
  // 所以 effect 里读 targetMap.current 安全. setState 是因为我们需要
  // re-render 让 Moveable 拿到 element — derived state 在第一次 render
  // 时 targetMap 还没填充, 拿不到. 这是 effect → setState 的合法用法,
  // 暂时 disable React 19 的 lint warning.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!scene.selectedId) {
      setSelectedTarget(null);
      return;
    }
    const el = targetMap.current.get(scene.selectedId);
    setSelectedTarget(el ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // depend on sources 是为了 source 列表重渲染后 ref map 已经更新
  }, [scene.selectedId, scene.sources]);

  // ── Drag handlers (一步拖动) ────────────────────────────────────
  // pointerdown: 立即 select + 记录起点 + setPointerCapture
  // pointermove: 算 delta / scale, dispatch updateTransform
  // pointerup:   清状态 + releasePointerCapture
  const handlePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    source: Source
  ) => {
    // 只处理主键 (左键 / 单指), 忽略右键和多指 — 避免跟系统手势冲突
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // 立即 select (即使已选中也无害)
    dispatch({ type: "select", id: source.id });

    dragRef.current = {
      sourceId: source.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: source.transform.x,
      origY: source.transform.y,
    };

    // 捕获后续 pointer events 到这个元素, 即使鼠标移出 div 边界也能继续 drag
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 极少数浏览器/环境不支持, 忽略
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ds = dragRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    const sc = scaleRef.current;
    if (sc === 0) return;

    const dx = (e.clientX - ds.startClientX) / sc;
    const dy = (e.clientY - ds.startClientY) / sc;
    dispatch({
      type: "updateTransform",
      id: ds.sourceId,
      patch: {
        x: Math.round(ds.origX + dx),
        y: Math.round(ds.origY + dy),
      },
    });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ds = dragRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragRef.current = null;
  };

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
            onPointerDown={(e) => handlePointerDown(e, source)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`absolute select-none transition-colors ${
              isSelected
                ? "border border-accent-cyan/90"
                : "border border-white/15 hover:border-accent-cyan/50 cursor-move"
            }`}
            style={{
              left: t.x * scale,
              top: t.y * scale,
              width: t.width * scale,
              height: t.height * scale,
              pointerEvents: "auto",
              touchAction: "none", // 阻止浏览器处理 touch (滑动滚动等)
            }}
            title={source.name}
          />
        );
      })}

      {/* 选中的 source 上挂 Moveable, 但只用 resize handles —
          drag 由我们自己的 pointer events 处理 (一步拖动). */}
      {selectedTarget && (
        <Moveable
          target={selectedTarget}
          draggable={false}
          resizable
          // origin disable — 不在中心画一个原点圈, 干净一点
          origin={false}
          // 不限制方向, 任意边都能拽
          edge={false}
          throttleResize={0}
          // 内部 transform 用 px (我们外层设的 left/top), 不要 Moveable 用
          // CSS transform 重写 (那样会让我们的 left/top 失效)
          useResizeObserver
          onResize={({ width, height, drag }) => {
            // 不 mutation DOM, 让 dispatch 更新 React state, re-render
            // 自动更新 target div 的 left/top/width/height. 同步发生.
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
