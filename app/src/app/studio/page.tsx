"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  createEmptyScene,
  sceneReducer,
} from "@/lib/broadcast/scene";
import { createLive2DSource } from "@/lib/broadcast/sources";
import { DEFAULT_LIVE2D_MODEL } from "@/lib/broadcast/model-registry";
import {
  StudioPublisher,
  type PublisherSnapshot,
} from "@/lib/broadcast/studio-publisher";
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
// /studio — 直播工作室
//
// OBS 风格的多源合成器:
//   - 添加摄像头 / 屏幕共享 / Live2D 皮套 (saba1B + 全套表情) 作为源
//   - 调整每个源的位置、大小、层级
//   - 在中间预览 canvas 实时看到合成效果
//   - 启用 MediaPipe 面捕 → 头/眼/嘴 驱动 Live2D
//   - 表情按钮 → 触发 .exp3.json fade
//   - 推流: canvas.captureStream → LiveKit → /watch/{slug}
//
// 推流和 /go-live 走完全相同的 channel + /api/streams + /api/livekit/token
// 链路, 不复制 channel 概念. 注意:不要同时打开 /studio 和 /go-live,
// LiveKit 同 identity 进同 room 会强制踢掉旧连接 (participant duplicated).
//
// 入口: 直接访问 /studio. 后续可在 navbar 加链接.
// ────────────────────────────────────────────────────────────────

function makeInitialScene() {
  // 默认放 registry 里的第一个模型 (Phase 3b: saba1B). 让用户访问 /studio
  // 立刻看到真 Live2D 模型 + 自带 .vtube.json — "启用面捕"开关一开就能用,
  // 表情面板也会自动填充 hotkeys.
  const scene = createEmptyScene();
  const m = DEFAULT_LIVE2D_MODEL;
  scene.sources.push(
    createLive2DSource({
      name: m.name,
      avatarId: m.avatarId,
      modelUrl: m.modelUrl,
      vtubeConfigUrl: m.vtubeConfigUrl,
    })
  );
  return scene;
}

export default function StudioPage() {
  const [scene, dispatch] = useReducer(sceneReducer, undefined, makeInitialScene);
  const [faceTracking, setFaceTracking] = useState(false);
  const [faceTrackErr, setFaceTrackErr] = useState<string | null>(null);

  // Compositor 输出 canvas 的 ref — 父组件持有, 推流时直接 captureStream
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // StudioPublisher 实例 — 跨 re-render 持久, 用 ref 避免触发 setState 循环
  const publisherRef = useRef<StudioPublisher | null>(null);
  if (!publisherRef.current) {
    publisherRef.current = new StudioPublisher();
  }
  const [pubSnap, setPubSnap] = useState<PublisherSnapshot>(
    () => publisherRef.current!.snapshot
  );

  // 订阅 publisher 状态 → 同步到 React state
  useEffect(() => {
    const publisher = publisherRef.current!;
    const unsubscribe = publisher.subscribe((s) => setPubSnap(s));
    return () => {
      unsubscribe();
      // 离开页面时主动停止推流, 避免后台留连接
      publisher.stop().catch(() => {});
    };
  }, []);

  const handleStartPublish = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      await publisherRef.current!.start(canvas, { withMic: false });
    } catch {
      // start 内部已经 setSnap("error"), UI 自动显示错误
    }
  };

  const handleStopPublish = async () => {
    await publisherRef.current!.stop();
  };

  const isPublishBusy = pubSnap.state === "starting" || pubSnap.state === "stopping";
  const isLive = pubSnap.state === "live";

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
            phase 3c · livekit publish 已接通
          </span>
        </div>

        {/* ── Publish bar ───────────────────────── */}
        <div className="mb-4 pixel-border bg-bg-card/60 px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-purple uppercase tracking-wider">
            推流 · LiveKit
          </span>
          <div className="flex-1 min-w-[120px]">
            {isLive && pubSnap.watchPath ? (
              <p className="text-[11px] text-accent-green">
                ● 直播中 · 观看页:{" "}
                <a
                  href={pubSnap.watchPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-accent-cyan"
                >
                  {pubSnap.watchPath}
                </a>
              </p>
            ) : pubSnap.state === "error" && pubSnap.error ? (
              <p className="text-[11px] text-accent-red/80 truncate">
                ⚠ {pubSnap.error}
              </p>
            ) : pubSnap.state === "starting" ? (
              <p className="text-[11px] text-accent-yellow/80">连接 LiveKit 中...</p>
            ) : pubSnap.state === "stopping" ? (
              <p className="text-[11px] text-text-secondary">正在停止...</p>
            ) : (
              <p className="text-[11px] text-text-secondary/70">
                把 compositor canvas 推到你的 channel · 观众访问 /watch/{"{slug}"} 看
              </p>
            )}
          </div>
          {isLive ? (
            <button
              type="button"
              onClick={handleStopPublish}
              disabled={isPublishBusy}
              className="pixel-border px-4 py-1.5 font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-wider bg-accent-red/20 text-accent-red hover:bg-accent-red/30 disabled:opacity-50 transition-colors"
            >
              ■ 停止推流
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartPublish}
              disabled={isPublishBusy}
              className="pixel-border px-4 py-1.5 font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-wider bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30 disabled:opacity-50 transition-colors"
            >
              ▶ 开始推流
            </button>
          )}
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
                canvasRef={canvasRef}
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
                onLive2DReady={(id, hotkeys) => {
                  // .vtube.json 解析完成 — 把 hotkeys 写回 source state,
                  // SourceInspector 用它渲染表情按钮
                  dispatch({
                    type: "updateSource",
                    id,
                    patch: { hotkeys },
                  });
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

        {/* ── Footer / Phase 3d hint ─────────────── */}
        <div className="mt-8 pixel-border bg-bg-card/50 p-4">
          <p className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary leading-relaxed">
            ◇ Phase 3d 待做: react-moveable 拖拽手柄 ·
            模型迁移到 Vercel Blob · 自定义 model URL 加载入口 ·
            麦克风音频开关
          </p>
        </div>
      </div>
    </div>
  );
}
