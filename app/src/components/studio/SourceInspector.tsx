"use client";

import type { Scene, SceneAction } from "@/lib/broadcast/scene";
import { findSource } from "@/lib/broadcast/scene";

// ────────────────────────────────────────────────────────────────
// SourceInspector — 选中源的属性面板.
//
// MVP: 数字输入框编辑 x / y / w / h, 没有拖拽手柄. 后续可以加 react-moveable.
// 也支持 rename, type-specific 字段 (avatarId / deviceId).
// ────────────────────────────────────────────────────────────────

interface SourceInspectorProps {
  scene: Scene;
  dispatch: (action: SceneAction) => void;
}

export function SourceInspector({ scene, dispatch }: SourceInspectorProps) {
  const source = findSource(scene, scene.selectedId);

  if (!source) {
    return (
      <div className="pixel-border bg-bg-card p-6 text-center">
        <p className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary opacity-60">
          选中一个源以编辑属性
        </p>
      </div>
    );
  }

  const updateNum = (field: "x" | "y" | "width" | "height" | "z", v: string) => {
    const n = Number(v);
    if (!isFinite(n)) return;
    dispatch({ type: "updateTransform", id: source.id, patch: { [field]: Math.round(n) } });
  };

  return (
    <div className="pixel-border bg-bg-card p-3 space-y-3">
      <div>
        <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
          名称
        </label>
        <input
          type="text"
          value={source.name}
          onChange={(e) => dispatch({ type: "rename", id: source.id, name: e.target.value })}
          className="w-full bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary focus:border-accent-cyan focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="X"      value={source.transform.x}      onChange={(v) => updateNum("x", v)} />
        <NumField label="Y"      value={source.transform.y}      onChange={(v) => updateNum("y", v)} />
        <NumField label="宽度"   value={source.transform.width}  onChange={(v) => updateNum("width", v)} />
        <NumField label="高度"   value={source.transform.height} onChange={(v) => updateNum("height", v)} />
        <NumField label="层级 z" value={source.transform.z}      onChange={(v) => updateNum("z", v)} />
      </div>

      {/* type-specific 字段 */}
      {source.type === "live2d" && (
        <div className="space-y-2">
          <div>
            <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
              皮套 ID
            </label>
            <input
              type="text"
              value={source.avatarId}
              onChange={(e) =>
                dispatch({
                  type: "updateSource",
                  id: source.id,
                  patch: { avatarId: e.target.value },
                })
              }
              placeholder="default"
              className="w-full bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary focus:border-accent-cyan focus:outline-none"
            />
          </div>
          {source.modelUrl ? (
            <div>
              <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
                模型 URL
              </label>
              <p className="text-[10px] text-accent-green/80 break-all">
                {source.modelUrl}
              </p>
              <p className="text-[10px] text-text-secondary/60 mt-1">
                Cubism 4 模型 (兼容 VTube Studio 模型规格)
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-text-secondary/60">
              占位 renderer · 修改皮套 ID 会换一个色调
            </p>
          )}
        </div>
      )}

      {source.type === "camera" && (
        <p className="text-[10px] text-text-secondary/60">
          MVP 默认使用系统第一个摄像头。后续可加设备选择。
        </p>
      )}

      {source.type === "screen" && (
        <p className="text-[10px] text-text-secondary/60">
          首次添加时浏览器会弹出选择窗口/标签页的对话框。
        </p>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary block mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-primary border border-border-pixel px-2 py-1 text-xs text-text-primary focus:border-accent-cyan focus:outline-none"
      />
    </div>
  );
}
