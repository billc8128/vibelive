"use client";

import { useReducer } from "react";
import {
  createEmptyScene,
  sceneReducer,
} from "@/lib/broadcast/scene";
import { createLive2DSource } from "@/lib/broadcast/sources";
import { SceneCanvas } from "@/components/studio/SceneCanvas";
import { SourceList } from "@/components/studio/SourceList";
import { SourceInspector } from "@/components/studio/SourceInspector";
import { AddSourceMenu } from "@/components/studio/AddSourceMenu";

// ────────────────────────────────────────────────────────────────
// /studio — 直播工作室原型 (Phase 1 MVP)
//
// 一个 OBS 风格的多源合成器, 用户可以:
//   - 添加摄像头 / 屏幕共享 / Live2D 皮套 (占位) 作为源
//   - 调整每个源的位置、大小、层级
//   - 在中间预览 canvas 实时看到合成效果
//
// 这个页面**故意没有集成到 go-live 的推流逻辑**:
//   - 避免和正在迭代的 go-live/page.tsx (2000+ 行) 撞车
//   - 让产品先确认合成方向, 再做 Phase 2 (LiveKit publish, 真 Live2D)
//
// 入口: 直接访问 /studio. 后续可在 navbar 加链接.
// ────────────────────────────────────────────────────────────────

function makeInitialScene() {
  // 默认放一个 Live2D 占位, 让用户访问 /studio 立刻看到东西
  const scene = createEmptyScene();
  scene.sources.push(createLive2DSource({ name: "默认皮套" }));
  return scene;
}

export default function StudioPage() {
  const [scene, dispatch] = useReducer(sceneReducer, undefined, makeInitialScene);

  return (
    <div className="ambient-gradient min-h-screen">
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        {/* ── Header ────────────────────────────── */}
        <div className="flex items-center gap-3 mb-5">
          <span className="font-[family-name:var(--font-pixel)] text-[12px] text-accent-purple glow-purple">
            ◈ 直播工作室
          </span>
          <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary opacity-60">
            STUDIO · MVP PREVIEW
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-accent-purple/40 to-transparent" />
          <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary opacity-50">
            phase 1 · 合成预览 · 未推流
          </span>
        </div>

        {/* ── 3-column layout ──────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-4">
          {/* Left: Source list + Add menu */}
          <div className="space-y-3">
            <h2 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-cyan uppercase tracking-wider px-1">
              源 · Sources
            </h2>
            <SourceList scene={scene} dispatch={dispatch} />
            <AddSourceMenu
              onAdd={(source) => dispatch({ type: "addSource", source })}
            />
          </div>

          {/* Center: Scene canvas (合成预览) */}
          <div className="space-y-3">
            <h2 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-green uppercase tracking-wider px-1">
              预览 · Preview ({scene.width}×{scene.height})
            </h2>
            <div className="pixel-border-glow bg-bg-card p-2">
              <SceneCanvas
                scene={scene}
                onSourceError={(id, err) => {
                  console.warn("[studio] source error", id, err.message);
                  // 自动移除 init 失败的 source, 避免列表里留下 "ghost"
                  dispatch({ type: "removeSource", id });
                }}
                onScreenEnded={(id) => {
                  // 用户停止屏幕共享 → 自动从 scene 移除
                  dispatch({ type: "removeSource", id });
                }}
              />
            </div>
            <p className="text-[10px] text-text-secondary/60 px-1 leading-relaxed">
              所有源在这块 canvas 上实时合成 · 摄像头/屏幕共享会请求浏览器权限 ·
              Live2D 当前是占位渲染,等接入 Cubism SDK 后切换为真 .moc3 模型
            </p>
          </div>

          {/* Right: Inspector */}
          <div className="space-y-3">
            <h2 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-yellow uppercase tracking-wider px-1">
              属性 · Inspector
            </h2>
            <SourceInspector scene={scene} dispatch={dispatch} />
          </div>
        </div>

        {/* ── Footer / Phase 2 hint ─────────────── */}
        <div className="mt-8 pixel-border bg-bg-card/50 p-4">
          <p className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary leading-relaxed">
            ◇ 下一阶段: 接入 LiveKit publish (canvas.captureStream → publishTrack),
            真 Live2D Cubism SDK + .moc3 预置皮套, react-moveable 拖拽手柄,
            场景持久化到 channel.settings
          </p>
        </div>
      </div>
    </div>
  );
}
