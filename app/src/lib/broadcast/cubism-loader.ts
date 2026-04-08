// ────────────────────────────────────────────────────────────────
// Cubism Core 加载器
//
// Live2D Cubism Core 是 Live2D 公司的预编译 binary wrapper, 因为 license
// 原因**不在 npm 上**, 只能通过 <script> tag 加载. 它会把自己注册到
// window.Live2DCubismCore. pixi-live2d-display 在 Live2DModel.from() 时
// 检查这个全局变量, 没有就崩.
//
// 这个 loader 实现单例 Promise:
//   - 第一次调用 → 注入 <script>, 等 onload, resolve
//   - 后续调用 → 直接 resolve 已存的 promise
//   - 多个 source 同时初始化 → 共享同一个 in-flight 请求
//
// 用 jsdelivr 上 dylanNew/live2d 镜像的 live2dcubismcore.min.js
// (社区常用,稳定). 生产可以下载到 public/ 用本地路径换掉 URL.
// ────────────────────────────────────────────────────────────────

const CUBISM_CORE_CDN =
  "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2dcubismcore.min.js";

// Global on window — 只在浏览器存在
declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

let cubismReadyPromise: Promise<void> | null = null;

export function loadCubismCore(): Promise<void> {
  // SSR 守卫: 服务端 import 这个 module 时不要崩
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cubism Core 只能在浏览器加载"));
  }

  // 已经加载过 (e.g. 用户在多个 source 之间复用)
  if (window.Live2DCubismCore) {
    return Promise.resolve();
  }

  // 已经在加载中, 复用同一个 promise
  if (cubismReadyPromise) {
    return cubismReadyPromise;
  }

  cubismReadyPromise = new Promise<void>((resolve, reject) => {
    // 双重检查 — 极小概率两个 source 同时进入这里
    if (window.Live2DCubismCore) {
      resolve();
      return;
    }

    // 看看是不是已经有别人注入过同一个 script (e.g. <Script> in page)
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CUBISM_CORE_CDN}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Cubism Core script 加载失败 (existing tag)")),
        { once: true }
      );
      // 万一已经 loaded 但事件没触发 — fallback
      if (window.Live2DCubismCore) resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = CUBISM_CORE_CDN;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener(
      "load",
      () => {
        if (window.Live2DCubismCore) {
          resolve();
        } else {
          reject(
            new Error(
              "Cubism Core script onload 触发但 window.Live2DCubismCore 仍然 undefined"
            )
          );
        }
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => {
        cubismReadyPromise = null; // 允许后续重试
        reject(new Error("Cubism Core script 网络加载失败"));
      },
      { once: true }
    );
    document.head.appendChild(script);
  });

  return cubismReadyPromise;
}

export function isCubismCoreReady(): boolean {
  return typeof window !== "undefined" && !!window.Live2DCubismCore;
}
