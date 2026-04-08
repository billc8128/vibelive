"use client";

// ────────────────────────────────────────────────────────────────
// /studio segment 的 Error Boundary.
//
// Next.js App Router file convention: 同级 `page.tsx` 抛出的 render
// 错误会被这里 catch 住, 不再触发默认 (整页 blank) fallback.
//
// 为什么 /studio 特别需要:
//   - SceneCanvas / SourceMoveableOverlay 走 dynamic({ssr:false}),
//     load 失败或模块顶层 throw 都会冒到这里
//   - PIXI / pixi-live2d-display 是 webgl 重模块, 浏览器不支持 webgl,
//     CORS 拒绝, 第三方 CDN 挂了 → 都是真实场景
//   - 即使 init 失败, 用户至少要看到错误信息 + 重试按钮, 而不是看着
//     页面闪一下消失
//
// 注意: 这个 boundary 只 catch render / effect / 同步事件 handler 里的
// throw. async event handler 里的 promise rejection 不走这条, 那些
// 由调用方 (publisher / face tracker / compositor) 自己 try/catch.
// ────────────────────────────────────────────────────────────────

import { useEffect } from "react";

interface StudioErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function StudioError({ error, reset }: StudioErrorProps) {
  // 把错误打到控制台 — 即使 UI 已经显示了 error.message,
  // 真实 stack 在 devtools 里更易看
  useEffect(() => {
    console.error("[/studio] uncaught error:", error);
  }, [error]);

  return (
    <div className="ambient-gradient min-h-screen">
      <div className="mx-auto max-w-[800px] px-4 py-12">
        <div className="pixel-border-glow bg-bg-card p-8 space-y-6">
          <div className="space-y-2">
            <h1 className="font-[family-name:var(--font-pixel)] text-[14px] text-accent-red glow-red">
              ⚠ STUDIO 出错了
            </h1>
            <p className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary opacity-60 uppercase tracking-wider">
              UNCAUGHT ERROR · /STUDIO
            </p>
          </div>

          <div className="pixel-border bg-bg-surface/50 p-4">
            <p className="font-mono text-[12px] text-accent-red/90 break-words leading-relaxed">
              {error.message || String(error)}
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-[10px] text-text-secondary/60">
                digest: {error.digest}
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="text-[12px] text-text-secondary leading-relaxed">
              Studio 在初始化时遇到错误。常见原因:
            </p>
            <ul className="text-[11px] text-text-secondary/80 space-y-1.5 list-disc pl-5">
              <li>浏览器不支持 WebGL / WebGPU (Live2D 渲染需要)</li>
              <li>第三方 CDN 拉取 Live2D Cubism Core 失败 (网络 / 代理 / 防火墙)</li>
              <li>Vercel Blob 模型文件 CORS 或 404</li>
              <li>本地代理 / 浏览器扩展拦截了脚本加载</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={reset}
              className="pixel-border px-4 py-2 font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-wider bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30 transition-colors"
            >
              ↻ 重试
            </button>
            <a
              href="/"
              className="pixel-border px-4 py-2 font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-wider bg-bg-surface text-text-secondary hover:bg-bg-card transition-colors"
            >
              ← 返回首页
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
