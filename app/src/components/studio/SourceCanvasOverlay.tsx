"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { Scene, SceneAction } from "@/lib/broadcast/scene";
import type { Source, TransformBox } from "@/lib/broadcast/sources";

// ────────────────────────────────────────────────────────────────
// SourceCanvasOverlay — OBS-style source 操作层 (drag / resize /
// snap / context menu / keyboard).
//
// 完全自己实现, 不依赖 react-moveable. react-moveable 跟"React state
// 是真理"的架构不兼容: 它需要直接 mutate DOM 才能保持 internal handle
// 位置跟 element rect 一致, 用我们的 dispatch + re-render 模型时就会
// 出现 handle 跟 source 错位的诡异 bug.
//
// 坐标系:
//   scene 空间 = compositor 内部分辨率 (e.g. 1920×1080), source.transform
//                的 x/y/w/h 都在这个空间.
//   display 空间 = canvas 在屏幕上实际占的 CSS 像素.
//   scale = displayW / sceneW, 把 scene 坐标转 display 坐标.
//
// 功能 (参考 OBS):
//   - 点击 source 选中, 点击空白 deselect
//   - 拖动 source 移动 (一步操作, pointer down 立即开始)
//   - 8 个 resize handle (4 角 + 4 边) 拖动改大小
//   - Shift + 角 handle = 等比缩放
//   - Snap to canvas 边缘 / 中心 / 其他 source 边缘 (±8 scene px)
//   - 吸附时显示粉色 alignment guide
//   - 右键 context menu: 居中 / 适应 / 重置 / 层级 / 删除
//   - Hover 高亮 + cursor 反馈 (move / nwse-resize / ns-resize ...)
//   - 键盘: Delete 删除选中, Escape 取消选中
//   - 按 z-index 从低到高渲染 source target
// ────────────────────────────────────────────────────────────────

interface Props {
  scene: Scene;
  dispatch: (action: SceneAction) => void;
  /** SceneCanvas 内部 canvas 元素的 ref. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

interface DragMove {
  kind: "move";
  sourceId: string;
  pointerId: number;
  startClient: { x: number; y: number };
  origTransform: TransformBox;
}

interface DragResize {
  kind: "resize";
  sourceId: string;
  pointerId: number;
  handle: Handle;
  startClient: { x: number; y: number };
  origTransform: TransformBox;
}

type DragState = DragMove | DragResize | null;

interface Guide {
  axis: "x" | "y";
  pos: number; // scene-space coord
}

const MIN_SIZE = 20; // scene-space px
const SNAP_THRESHOLD = 8; // scene-space px

// ── Helper: compute resize ──────────────────────────────────────
function computeResize(
  orig: TransformBox,
  handle: Handle,
  dx: number,
  dy: number,
  shiftLock: boolean
): TransformBox {
  let x = orig.x;
  let y = orig.y;
  let w = orig.width;
  let h = orig.height;

  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (handle.includes("s")) {
    h += dy;
  }
  if (handle.includes("e")) {
    w += dx;
  }
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }

  // Aspect lock — Shift + 角 handle 等比缩放
  const isCorner =
    handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";
  if (shiftLock && isCorner && orig.height > 0) {
    const ratio = orig.width / orig.height;
    // 用 width 主导计算 height (鼠标操作主要影响 width 时), 反之亦然
    const wFromH = h * ratio;
    const hFromW = w / ratio;
    // 选哪个看哪个变化更大
    if (Math.abs(w - orig.width) > Math.abs(h - orig.height) * ratio) {
      const newH = hFromW;
      if (handle.includes("n")) y = orig.y + orig.height - newH;
      h = newH;
    } else {
      const newW = wFromH;
      if (handle.includes("w")) x = orig.x + orig.width - newW;
      w = newW;
    }
  }

  return { x, y, width: w, height: h, z: orig.z };
}

// ── Helper: snap move ────────────────────────────────────────────
interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

function computeSnap(
  rect: { x: number; y: number; width: number; height: number },
  scene: Scene,
  excludeSourceId: string
): SnapResult {
  const guides: Guide[] = [];
  let x = rect.x;
  let y = rect.y;

  // 候选对齐点 — canvas 边缘 + 中心 + 其他 source 的左/中/右
  const xTargets: number[] = [0, scene.width / 2, scene.width];
  const yTargets: number[] = [0, scene.height / 2, scene.height];
  for (const s of scene.sources) {
    if (s.id === excludeSourceId) continue;
    xTargets.push(
      s.transform.x,
      s.transform.x + s.transform.width / 2,
      s.transform.x + s.transform.width
    );
    yTargets.push(
      s.transform.y,
      s.transform.y + s.transform.height / 2,
      s.transform.y + s.transform.height
    );
  }

  // 试 left / center / right 三个 anchor 哪个最接近 target
  const cx = x + rect.width / 2;
  const right = x + rect.width;
  let bestX: { dist: number; newX: number; pos: number } | null = null;
  for (const tx of xTargets) {
    for (const [anchor, val] of [
      ["left", x],
      ["center", cx],
      ["right", right],
    ] as const) {
      const dist = Math.abs((val as number) - tx);
      if (dist < SNAP_THRESHOLD && (bestX === null || dist < bestX.dist)) {
        const newX =
          anchor === "left"
            ? tx
            : anchor === "center"
              ? tx - rect.width / 2
              : tx - rect.width;
        bestX = { dist, newX, pos: tx };
      }
    }
  }
  if (bestX) {
    x = bestX.newX;
    guides.push({ axis: "x", pos: bestX.pos });
  }

  const cy = y + rect.height / 2;
  const bottom = y + rect.height;
  let bestY: { dist: number; newY: number; pos: number } | null = null;
  for (const ty of yTargets) {
    for (const [anchor, val] of [
      ["top", y],
      ["center", cy],
      ["bottom", bottom],
    ] as const) {
      const dist = Math.abs((val as number) - ty);
      if (dist < SNAP_THRESHOLD && (bestY === null || dist < bestY.dist)) {
        const newY =
          anchor === "top"
            ? ty
            : anchor === "center"
              ? ty - rect.height / 2
              : ty - rect.height;
        bestY = { dist, newY, pos: ty };
      }
    }
  }
  if (bestY) {
    y = bestY.newY;
    guides.push({ axis: "y", pos: bestY.pos });
  }

  return { x, y, guides };
}

// ── 组件 ─────────────────────────────────────────────────────────
export function SourceCanvasOverlay({ scene, dispatch, canvasRef }: Props) {
  // canvas 显示尺寸
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const scale =
    displaySize.width > 0 && scene.width > 0
      ? displaySize.width / scene.width
      : 0;

  // 拖动状态 (ref, 不触发 re-render)
  const dragRef = useRef<DragState>(null);
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // 吸附 guides (state, 拖动时显示)
  const [guides, setGuides] = useState<Guide[]>([]);

  // Hover state
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Context menu
  const [menu, setMenu] = useState<{
    clientX: number;
    clientY: number;
    sourceId: string;
  } | null>(null);

  // ── canvas 显示尺寸监听 ──
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

  // selected source
  const selected = useMemo(
    () => scene.sources.find((s) => s.id === scene.selectedId) ?? null,
    [scene.sources, scene.selectedId]
  );

  // 按 z 升序渲染 (低层在底)
  const sortedSources = useMemo(
    () => [...scene.sources].sort((a, b) => a.transform.z - b.transform.z),
    [scene.sources]
  );

  // ── Drag move handlers (绑在 source target div) ──
  const handleSourcePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    source: Source
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    dispatch({ type: "select", id: source.id });
    dragRef.current = {
      kind: "move",
      sourceId: source.id,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      origTransform: { ...source.transform },
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // ── Resize drag handlers (绑在 handle) ──
  const handleResizePointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    handle: Handle
  ) => {
    if (e.button !== 0 || !selected) return;
    e.stopPropagation();
    e.preventDefault();
    setMenu(null);
    dragRef.current = {
      kind: "resize",
      sourceId: selected.id,
      pointerId: e.pointerId,
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      origTransform: { ...selected.transform },
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // 共享 pointer move/up handler — 跟随 dragRef 状态
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ds = dragRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    const sc = scaleRef.current;
    if (sc === 0) return;
    const dx = (e.clientX - ds.startClient.x) / sc;
    const dy = (e.clientY - ds.startClient.y) / sc;

    if (ds.kind === "move") {
      const orig = ds.origTransform;
      const candidate = {
        x: orig.x + dx,
        y: orig.y + dy,
        width: orig.width,
        height: orig.height,
      };
      const snap = computeSnap(candidate, scene, ds.sourceId);
      setGuides(snap.guides);
      dispatch({
        type: "updateTransform",
        id: ds.sourceId,
        patch: { x: Math.round(snap.x), y: Math.round(snap.y) },
      });
    } else {
      const rect = computeResize(
        ds.origTransform,
        ds.handle,
        dx,
        dy,
        e.shiftKey
      );
      // Min size + 不允许翻转
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;
      dispatch({
        type: "updateTransform",
        id: ds.sourceId,
        patch: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }
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
    setGuides([]);
  };

  // ── Background pointer down (deselect) ──
  const handleBackgroundDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target === e.currentTarget) {
      dispatch({ type: "select", id: null });
      setMenu(null);
    }
  };

  // ── Right click → context menu ──
  const handleContextMenu = (
    e: ReactMouseEvent<HTMLDivElement>,
    source: Source
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "select", id: source.id });
    setMenu({ clientX: e.clientX, clientY: e.clientY, sourceId: source.id });
  };

  // 关闭 context menu (点击其他地方)
  useEffect(() => {
    if (!menu) return;
    const onDown = () => setMenu(null);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu]);

  // ── 键盘快捷键 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!scene.selectedId) return;
      // 不干扰文本输入
      const tgt = e.target as HTMLElement;
      const tag = tgt?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tgt?.isContentEditable
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch({ type: "select", id: null });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({ type: "removeSource", id: scene.selectedId });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene.selectedId, dispatch]);

  // ── Context menu actions ──
  const menuAction = (action: string) => {
    if (!menu) return;
    const id = menu.sourceId;
    const src = scene.sources.find((s) => s.id === id);
    if (!src) return;

    switch (action) {
      case "center": {
        const cx = Math.round((scene.width - src.transform.width) / 2);
        const cy = Math.round((scene.height - src.transform.height) / 2);
        dispatch({
          type: "updateTransform",
          id,
          patch: { x: cx, y: cy },
        });
        break;
      }
      case "fit-width": {
        const ratio = src.transform.width / src.transform.height;
        const newW = scene.width;
        const newH = Math.round(newW / ratio);
        dispatch({
          type: "updateTransform",
          id,
          patch: {
            x: 0,
            y: Math.round((scene.height - newH) / 2),
            width: newW,
            height: newH,
          },
        });
        break;
      }
      case "fit-height": {
        const ratio = src.transform.width / src.transform.height;
        const newH = scene.height;
        const newW = Math.round(newH * ratio);
        dispatch({
          type: "updateTransform",
          id,
          patch: {
            x: Math.round((scene.width - newW) / 2),
            y: 0,
            width: newW,
            height: newH,
          },
        });
        break;
      }
      case "fit-screen": {
        // 等比适配整个 canvas (contain)
        const ratio = src.transform.width / src.transform.height;
        const sceneRatio = scene.width / scene.height;
        let newW: number, newH: number;
        if (ratio > sceneRatio) {
          newW = scene.width;
          newH = Math.round(newW / ratio);
        } else {
          newH = scene.height;
          newW = Math.round(newH * ratio);
        }
        dispatch({
          type: "updateTransform",
          id,
          patch: {
            x: Math.round((scene.width - newW) / 2),
            y: Math.round((scene.height - newH) / 2),
            width: newW,
            height: newH,
          },
        });
        break;
      }
      case "fill-screen":
        // 全屏 stretch (不保持比例)
        dispatch({
          type: "updateTransform",
          id,
          patch: { x: 0, y: 0, width: scene.width, height: scene.height },
        });
        break;
      case "to-front":
        dispatch({ type: "bringToFront", id });
        break;
      case "to-back":
        dispatch({ type: "sendToBack", id });
        break;
      case "up":
        dispatch({ type: "moveUp", id });
        break;
      case "down":
        dispatch({ type: "moveDown", id });
        break;
      case "delete":
        dispatch({ type: "removeSource", id });
        break;
    }
    setMenu(null);
  };

  if (scale === 0) return null;

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: "auto" }}
      onPointerDown={handleBackgroundDown}
    >
      {/* Source target divs (按 z-index 升序, 选中的最后渲染保证 handles 在最上) */}
      {sortedSources.map((source) => {
        const t = source.transform;
        const isSelected = source.id === scene.selectedId;
        const isHover = source.id === hoverId;
        return (
          <div
            key={source.id}
            onPointerDown={(e) => handleSourcePointerDown(e, source)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerEnter={() => setHoverId(source.id)}
            onPointerLeave={() => setHoverId(null)}
            onContextMenu={(e) => handleContextMenu(e, source)}
            className={`absolute select-none ${
              isSelected
                ? "border-2 border-accent-cyan cursor-move"
                : isHover
                  ? "border border-accent-cyan/70 cursor-move"
                  : "border border-white/15 cursor-move"
            }`}
            style={{
              left: t.x * scale,
              top: t.y * scale,
              width: t.width * scale,
              height: t.height * scale,
              touchAction: "none",
            }}
            title={source.name}
          />
        );
      })}

      {/* Resize handles for selected (8 个) */}
      {selected && (
        <ResizeHandles
          transform={selected.transform}
          scale={scale}
          onHandleDown={handleResizePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}

      {/* Alignment guides (拖动吸附时显示, 粉色细线) */}
      {guides.map((g, i) => (
        <div
          key={`${g.axis}-${i}-${g.pos}`}
          className="absolute bg-accent-pink pointer-events-none"
          style={
            g.axis === "x"
              ? {
                  left: g.pos * scale - 0.5,
                  top: 0,
                  width: 1,
                  bottom: 0,
                }
              : {
                  top: g.pos * scale - 0.5,
                  left: 0,
                  height: 1,
                  right: 0,
                }
          }
        />
      ))}

      {/* Context menu */}
      {menu && (
        <ContextMenu
          clientX={menu.clientX}
          clientY={menu.clientY}
          onAction={menuAction}
        />
      )}
    </div>
  );
}

// ── Resize handles 子组件 ───────────────────────────────────────
interface HandlesProps {
  transform: TransformBox;
  scale: number;
  onHandleDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    handle: Handle
  ) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

function ResizeHandles({
  transform,
  scale,
  onHandleDown,
  onPointerMove,
  onPointerUp,
}: HandlesProps) {
  const t = transform;
  const x = t.x * scale;
  const y = t.y * scale;
  const w = t.width * scale;
  const h = t.height * scale;

  const positions: Record<Handle, { left: number; top: number }> = {
    nw: { left: x, top: y },
    n: { left: x + w / 2, top: y },
    ne: { left: x + w, top: y },
    e: { left: x + w, top: y + h / 2 },
    se: { left: x + w, top: y + h },
    s: { left: x + w / 2, top: y + h },
    sw: { left: x, top: y + h },
    w: { left: x, top: y + h / 2 },
  };

  return (
    <>
      {HANDLES.map((handle) => {
        const pos = positions[handle];
        return (
          <div
            key={handle}
            onPointerDown={(e) => onHandleDown(e, handle)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-accent-cyan border border-bg-card hover:bg-accent-pink"
            style={{
              left: pos.left,
              top: pos.top,
              cursor: HANDLE_CURSORS[handle],
              touchAction: "none",
            }}
          />
        );
      })}
    </>
  );
}

// ── Context menu 子组件 ─────────────────────────────────────────
interface ContextMenuProps {
  clientX: number;
  clientY: number;
  onAction: (action: string) => void;
}

const MENU_ITEMS: Array<{ label: string; action: string } | "sep"> = [
  { label: "居中 Center", action: "center" },
  { label: "适应宽度 Fit width", action: "fit-width" },
  { label: "适应高度 Fit height", action: "fit-height" },
  { label: "适应画面 Fit screen", action: "fit-screen" },
  { label: "全屏拉伸 Fill screen", action: "fill-screen" },
  "sep",
  { label: "置顶 Bring to front", action: "to-front" },
  { label: "置底 Send to back", action: "to-back" },
  { label: "上移一层 Up", action: "up" },
  { label: "下移一层 Down", action: "down" },
  "sep",
  { label: "删除 Delete", action: "delete" },
];

function ContextMenu({ clientX, clientY, onAction }: ContextMenuProps) {
  return (
    <div
      className="fixed pixel-border bg-bg-card py-1 z-50 min-w-[180px]"
      style={{ left: clientX, top: clientY }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {MENU_ITEMS.map((item, i) =>
        item === "sep" ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border-pixel/40" />
        ) : (
          <button
            key={item.action}
            type="button"
            onClick={() => onAction(item.action)}
            className="w-full text-left px-3 py-1.5 text-[11px] text-text-primary hover:bg-accent-purple/20 hover:text-accent-purple transition-colors font-[family-name:var(--font-pixel)]"
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
