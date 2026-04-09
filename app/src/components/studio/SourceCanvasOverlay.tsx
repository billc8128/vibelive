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

  // Overlay root ref — global pointerdown handler 用 contains 判断
  // 点击是否落在 overlay 内, 实现"点击外部 deselect"
  const overlayRootRef = useRef<HTMLDivElement>(null);

  // selectedId 也用 ref 拿最新值, 避免 effect dep 包含 selectedId 反复 install
  const selectedIdRef = useRef(scene.selectedId);
  useEffect(() => {
    selectedIdRef.current = scene.selectedId;
  });

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

  // ── Alpha-based hit test ─────────────────────────────────────
  // 读 compositor 2D canvas 的指定像素 alpha. alpha > 0 = 该位置有
  // 模型实际像素 → 找包含 (cx, cy) 的最高 z source. alpha == 0 = 透明
  // 区域 → null (不算 hit, 让用户穿透到 background).
  //
  // 跟单纯的 box hit test 区别: source 的 transform.box 里很多区域
  // 是透明 padding (Live2D contain mode 适配后模型只占 box 一小部分),
  // box test 会让 user hover/click 整个 box, 视觉上不像在跟模型交互.
  // alpha test 真正只在模型像素上响应, 体验跟"直接点模型"一致.
  const hitTestByAlpha = (clientX: number, clientY: number): Source | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    if (
      clientX < r.left ||
      clientX >= r.right ||
      clientY < r.top ||
      clientY >= r.bottom
    ) {
      return null;
    }
    // Client → canvas 内部坐标 (scene 空间)
    const cx = ((clientX - r.left) / r.width) * canvas.width;
    const cy = ((clientY - r.top) / r.height) * canvas.height;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const px = ctx.getImageData(Math.floor(cx), Math.floor(cy), 1, 1).data;
      if (px[3] === 0) return null; // 完全透明
    } catch {
      // getImageData 失败 (比如 canvas tainted by cross-origin) → 不 hit
      return null;
    }
    // 找包含 (cx, cy) 的最高 z source
    const ordered = [...scene.sources].sort(
      (a, b) => b.transform.z - a.transform.z
    );
    for (const s of ordered) {
      const t = s.transform;
      if (
        cx >= t.x &&
        cx < t.x + t.width &&
        cy >= t.y &&
        cy < t.y + t.height
      ) {
        return s;
      }
    }
    return null;
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

  // ── Root pointer down — alpha hit test 决定 select / deselect / drag
  const handleRootPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 如果 click 在 handle 上, handle 自己 stopPropagation 处理 resize,
    // event 不冒泡到 root, 这里走不到. 安全检查.
    if (e.target !== e.currentTarget) return;

    const hit = hitTestByAlpha(e.clientX, e.clientY);
    if (!hit) {
      // 透明区域 / 在 source box 外 → deselect
      dispatch({ type: "select", id: null });
      setMenu(null);
      return;
    }
    // 命中 source → select + 立即开始 drag
    e.preventDefault();
    setMenu(null);
    dispatch({ type: "select", id: hit.id });
    dragRef.current = {
      kind: "move",
      sourceId: hit.id,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      origTransform: { ...hit.transform },
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // ── Root pointer move — drag 跑 drag, 否则 hover detection
  const handleRootPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ds = dragRef.current;
    if (ds && ds.pointerId === e.pointerId) {
      // 让现有的 drag move handler 处理
      handlePointerMove(e);
      return;
    }
    // 没在拖, 用 hit test 检测 hover
    const hit = hitTestByAlpha(e.clientX, e.clientY);
    setHoverId(hit?.id ?? null);
  };

  const handleRootPointerLeave = () => {
    if (!dragRef.current) {
      setHoverId(null);
    }
  };

  // ── Root context menu — 只在 hit 到 source 像素时显示我们的 menu
  const handleRootContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const hit = hitTestByAlpha(e.clientX, e.clientY);
    if (!hit) return; // 透明区域 → 不阻止浏览器默认 menu, 也不显示我们的
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "select", id: hit.id });
    setMenu({ clientX: e.clientX, clientY: e.clientY, sourceId: hit.id });
  };

  // ── Window-level pointerdown — 点击 overlay 外的任何地方 deselect.
  // 让 inspector / source list / 其他 page 元素的 click 既能触发自己的
  // handler, 也能 deselect canvas 上的 source. 用 overlayRootRef.contains
  // 区分"在 overlay 内 (overlay 自己处理)"和"在 overlay 外 (要 deselect)".
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!selectedIdRef.current) return; // 没选中, 不需要 deselect
      const tgt = e.target as Node | null;
      if (!tgt) return;
      // 在 overlay 内 → 让 overlay 自己处理 (source pointerdown / handle / background)
      if (overlayRootRef.current?.contains(tgt)) return;
      dispatch({ type: "select", id: null });
      setMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [dispatch]);

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
      ref={overlayRootRef}
      className="absolute inset-0"
      style={{
        pointerEvents: "auto",
        // cursor 跟随 hover state — alpha hit test 命中 source 时 move
        cursor: hoverId ? "move" : "default",
        touchAction: "none",
      }}
      onPointerDown={handleRootPointerDown}
      onPointerMove={handleRootPointerMove}
      onPointerLeave={handleRootPointerLeave}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleRootContextMenu}
    >
      {/* Source target divs — 纯 visual, pointer-events: none.
          Hover / select / click / context menu 全部走 root div 的 alpha
          hit test. source div 只显示边框 (selected / hover) 用作视觉提示. */}
      {sortedSources.map((source) => {
        const t = source.transform;
        const isSelected = source.id === scene.selectedId;
        const isHover = source.id === hoverId;
        return (
          <div
            key={source.id}
            className={`absolute select-none pointer-events-none ${
              isSelected
                ? "border-2 border-accent-cyan"
                : isHover
                  ? "border border-accent-cyan/70"
                  : ""
            }`}
            style={{
              left: t.x * scale,
              top: t.y * scale,
              width: t.width * scale,
              height: t.height * scale,
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
