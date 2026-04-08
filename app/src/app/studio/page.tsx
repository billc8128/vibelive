"use client";

import { useReducer, useState } from "react";
import dynamic from "next/dynamic";
import {
  createEmptyScene,
  sceneReducer,
} from "@/lib/broadcast/scene";
import { createLive2DSource } from "@/lib/broadcast/sources";
import { SourceList } from "@/components/studio/SourceList";
import { SourceInspector } from "@/components/studio/SourceInspector";
import { AddSourceMenu } from "@/components/studio/AddSourceMenu";

// SceneCanvas import 链最终拉到 PIXI + pixi-live2d-display, 这两个库在
// 模块顶层访问 window, Next.js prerender 阶段 (server) 会 ReferenceError.
// 用 next/dynamic + ssr:false 把 SceneCanvas 限制为纯 client 加载,
// 整个 broadcast/renderers/* 链就不会被 SSR evaluate.
const SceneCanvas = dynamic(
  () => import("@/components/studio/SceneCanvas").then((m) => m.SceneCanvas),
  { ssr: false }
);

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
  // 默认放 saba1B (从 VTube Studio 复制到 public/live2d/), 让用户访问 /studio
  // 立刻看到真 Live2D 模型. Phase 3a 起也带上 .vtube.json,
  // 使能"启用面捕"按钮一开就能驱动头部+眼+嘴.
  const scene = createEmptyScene();
  scene.sources.push(
    createLive2DSource({
      name: "saba1B",
      avatarId: "saba1B",
      modelUrl: "/live2d/saba1B/saba1B.model3.json",
      vtubeConfigUrl: "/live2d/saba1B/saba1B.vtube.json",
    })
  );
  return scene;
}

export default function StudioPage() {
  const [scene, dispatch] = useReducer(sceneReducer, undefined, makeInitialScene);
  const [faceTracking, setFaceTracking] = useState(false);
  const [faceTrackErr, setFaceTrackErr] = useState<string | null>(null);

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
            phase 3a · 合成预览 + 真 live2d + 面捕 · 未推流
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
            <div className="flex items-center gap-2 px-1">
              <h2 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-green uppercase tracking-wider">
                预览 · Preview ({scene.width}×{scene.height})
              </h2>
              <div className="flex-1" />
              {/* 面捕开关 — 启动时申请摄像头, 关掉时释放 */}
              <button
                type="button"
                onClick={() => {
                  setFaceTrackErr(null);
                  setFaceTracking((v) => !v);
                }}
                className={`pixel-border px-3 py-1 font-[family-name:var(--font-pixel)] text-[8px] uppercase tracking-wider transition-colors ${
                  faceTracking
                    ? "bg-accent-green/20 text-accent-green"
                    : "bg-bg-card text-text-secondary hover:bg-accent-green/10"
                }`}
              >
                {faceTracking ? "● 面捕已启用" : "○ 启用面捕"}
              </button>
            </div>
            <div className="pixel-border-glow bg-bg-card p-2">
              <SceneCanvas
                scene={scene}
                faceTrackingEnabled={faceTracking}
                onSourceError={(id, err) => {
                  console.warn("[studio] source error", id, err.message);
                  // 自动移除 init 失败的 source, 避免列表里留下 "ghost"
                  dispatch({ type: "removeSource", id });
                }}
                onScreenEnded={(id) => {
                  // 用户停止屏幕共享 → 自动从 scene 移除
                  dispatch({ type: "removeSource", id });
                }}
                onFaceTrackingError={(err) => {
                  setFaceTracking(false);
                  setFaceTrackErr(err.message);
                }}
              />
            </div>
            {faceTrackErr ? (
              <p className="text-[10px] text-accent-red/80 px-1 leading-relaxed">
                ⚠ 面捕启动失败: {faceTrackErr}
              </p>
            ) : (
              <p className="text-[10px] text-text-secondary/60 px-1 leading-relaxed">
                所有源在这块 canvas 上实时合成 · 启用面捕会申请摄像头授权 ·
                头部 / 眼睛 / 嘴巴 通过 saba1B.vtube.json 映射写入 Live2D 参数
              </p>
            )}
          </div>

          {/* Right: Inspector */}
          <div className="space-y-3">
            <h2 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-yellow uppercase tracking-wider px-1">
              属性 · Inspector
            </h2>
            <SourceInspector scene={scene} dispatch={dispatch} />
          </div>
        </div>

        {/* ── Footer / Phase 3b hint ─────────────── */}
        <div className="mt-8 pixel-border bg-bg-card/50 p-4">
          <p className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary leading-relaxed">
            ◇ Phase 3b 待做: 表情触发 (.exp3.json) · 多模型选择器 ·
            模型迁移到 Vercel Blob · canvas.captureStream → LiveKit publishTrack ·
            react-moveable 拖拽手柄
          </p>
        </div>
      </div>
    </div>
  );
}
