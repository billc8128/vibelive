import type { Source, TransformBox } from "./sources";

// ────────────────────────────────────────────────────────────────
// Scene state + reducer.
//
// Scene 是 "画布大小 + 按 z-index 从下到上的源数组". 所有对 Scene
// 的修改走 sceneReducer, 保持不可变性和可预测性. 这样后续:
//   - React 组件可以 useReducer(sceneReducer, initialScene)
//   - 持久化只需 JSON.stringify(scene)
//   - 撤销/重做可以靠保留历史 Scene 快照
// ────────────────────────────────────────────────────────────────

export interface Scene {
  width: number;   // 输出分辨率 (目标 LiveKit 推流分辨率)
  height: number;
  /** 按任意顺序排列, 渲染时按 transform.z 排序后依次绘制。 */
  sources: Source[];
  /** 当前选中的源 id, 用于 inspector 绑定。 */
  selectedId: string | null;
}

export function createEmptyScene(width = 1920, height = 1080): Scene {
  return { width, height, sources: [], selectedId: null };
}

// ────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────

export type SceneAction =
  | { type: "addSource"; source: Source }
  | { type: "removeSource"; id: string }
  | { type: "select"; id: string | null }
  | { type: "toggleVisible"; id: string }
  | { type: "rename"; id: string; name: string }
  | { type: "updateTransform"; id: string; patch: Partial<TransformBox> }
  | { type: "updateSource"; id: string; patch: Partial<Source> }
  | { type: "moveUp"; id: string }
  | { type: "moveDown"; id: string }
  | { type: "bringToFront"; id: string }
  | { type: "sendToBack"; id: string };

// ────────────────────────────────────────────────────────────────
// Reducer
// ────────────────────────────────────────────────────────────────

export function sceneReducer(state: Scene, action: SceneAction): Scene {
  switch (action.type) {
    case "addSource":
      return {
        ...state,
        sources: [...state.sources, action.source],
        selectedId: action.source.id,
      };

    case "removeSource":
      return {
        ...state,
        sources: state.sources.filter((s) => s.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };

    case "select":
      return { ...state, selectedId: action.id };

    case "toggleVisible":
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id ? { ...s, visible: !s.visible } : s
        ),
      };

    case "rename":
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id ? { ...s, name: action.name } : s
        ),
      };

    case "updateTransform":
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id
            ? { ...s, transform: { ...s.transform, ...action.patch } }
            : s
        ),
      };

    case "updateSource":
      // 用于 type-specific 字段 (avatarId, deviceId 等). 调用方保证 patch
      // 不改变 type, 否则 TS 类型就被破坏了.
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id ? ({ ...s, ...action.patch } as Source) : s
        ),
      };

    case "moveUp": {
      // 把选中的源在 z-index 上抬一层. 没有精细的 z-index 分配, 直接
      // +1 就行 — 后续渲染按 z 排序, 相等时按数组顺序.
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id
            ? { ...s, transform: { ...s.transform, z: s.transform.z + 1 } }
            : s
        ),
      };
    }

    case "moveDown":
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id
            ? {
                ...s,
                transform: {
                  ...s.transform,
                  z: Math.max(0, s.transform.z - 1),
                },
              }
            : s
        ),
      };

    case "bringToFront": {
      const maxZ = state.sources.reduce(
        (m, s) => Math.max(m, s.transform.z),
        0
      );
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id
            ? { ...s, transform: { ...s.transform, z: maxZ + 1 } }
            : s
        ),
      };
    }

    case "sendToBack": {
      const minZ = state.sources.reduce(
        (m, s) => Math.min(m, s.transform.z),
        0
      );
      return {
        ...state,
        sources: state.sources.map((s) =>
          s.id === action.id
            ? { ...s, transform: { ...s.transform, z: minZ - 1 } }
            : s
        ),
      };
    }

    default: {
      // Exhaustiveness check — 如果以后加了新 action 忘了处理, TS 会报错
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** 按 z-index 升序返回源 (从低到高, 渲染顺序 = 先画低的, 后画高的覆盖). */
export function sourcesInRenderOrder(scene: Scene): Source[] {
  return [...scene.sources].sort(
    (a, b) => a.transform.z - b.transform.z
  );
}

export function findSource(scene: Scene, id: string | null): Source | null {
  if (!id) return null;
  return scene.sources.find((s) => s.id === id) ?? null;
}
