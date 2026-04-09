import type { TransformBox } from "../sources";
import type { SourceRenderer } from "./types";

// ────────────────────────────────────────────────────────────────
// Live2D 占位 renderer (MVP).
//
// 真正的 Live2D 渲染需要 Cubism Core SDK + pixi-live2d-display + 一个
// .moc3 模型 + license 决策, 这些都不是可以在 dev iteration 内拍板的.
//
// 这个占位 renderer 用纯 canvas 2D 绘制一个简单的 anime-style 头像
// (圆脸 + 简化眼睛/嘴 + 头发 + 微微 idle bob 动画), 让用户看到完整的
// "添加 Live2D source → 在画布上看到一个会动的角色 → 调整位置大小"
// 的体验流程. 等接入真 Cubism, 替换这一个文件即可, 接口不变.
//
// 关键点:
//   1. 完全不需要外部资源 / 网络请求 — Pure procedural draw
//   2. idle 动画基于 time 参数, 不需要内部 state
//   3. 能演示出 "我有一个虚拟皮套" 的感觉, 但明显是占位
// ────────────────────────────────────────────────────────────────

export class Live2DPlaceholderRenderer implements SourceRenderer {
  private _ready = false;
  // 不同 avatar 用不同色调暗示 "可换皮套"
  private hue: number;

  constructor(opts: { avatarId?: string } = {}) {
    // 简单的 hash → hue
    this.hue = avatarHue(opts.avatarId || "default");
  }

  get ready() {
    return this._ready;
  }

  async init(): Promise<void> {
    // 纯 canvas 绘制不需要资源, 立即就绪
    this._ready = true;
  }

  draw(ctx: CanvasRenderingContext2D, box: TransformBox, time: number): void {
    if (!this._ready) return;
    ctx.save();

    // 平移 + 缩放, 让所有局部坐标基于 box 居中, [-1, 1] 的归一化空间
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const scale = Math.min(box.width, box.height) / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // idle bob: 上下飘 ±2%, 周期 ~3 秒
    const t = time / 1000;
    const bob = Math.sin(t * 2.0) * 0.02;
    const blink = (Math.sin(t * 1.7) + 1) / 2; // 0..1, 用作眼睛轻微收缩
    ctx.translate(0, bob);

    drawCharacter(ctx, this.hue, blink);

    ctx.restore();
  }

  dispose(): void {
    this._ready = false;
  }
}

function avatarHue(avatarId: string): number {
  let h = 0;
  for (let i = 0; i < avatarId.length; i++) {
    h = (h * 31 + avatarId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

// ────────────────────────────────────────────────────────────────
// Pure procedural anime-style head — 占位字符
// ────────────────────────────────────────────────────────────────

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  hue: number,
  blink: number
) {
  // 阴影
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0.95, 0.55, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 头发后部 (大圆)
  ctx.fillStyle = `hsl(${hue}, 65%, 35%)`;
  ctx.beginPath();
  ctx.arc(0, -0.05, 0.78, 0, Math.PI * 2);
  ctx.fill();

  // 脸 (椭圆)
  ctx.fillStyle = "#fde7d6";
  ctx.beginPath();
  ctx.ellipse(0, 0.05, 0.55, 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // 头发刘海 (从头顶覆盖到眼睛上方)
  ctx.fillStyle = `hsl(${hue}, 70%, 45%)`;
  ctx.beginPath();
  ctx.moveTo(-0.55, -0.15);
  ctx.quadraticCurveTo(-0.4, -0.7, 0, -0.65);
  ctx.quadraticCurveTo(0.4, -0.7, 0.55, -0.15);
  ctx.quadraticCurveTo(0.3, -0.05, 0, -0.1);
  ctx.quadraticCurveTo(-0.3, -0.05, -0.55, -0.15);
  ctx.closePath();
  ctx.fill();

  // 眼睛 (两个椭圆, blink 控制纵向收缩)
  const eyeOpen = 0.1 + 0.04 * (1 - blink * 0.4);
  const eyeColor = `hsl(${(hue + 200) % 360}, 75%, 45%)`;

  // 左眼白
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(-0.22, 0.1, 0.13, eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();
  // 左瞳
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.ellipse(-0.22, 0.1, 0.07, eyeOpen * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  // 左眼高光
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(-0.2, 0.07, 0.025, 0.025, 0, 0, Math.PI * 2);
  ctx.fill();

  // 右眼镜像
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0.22, 0.1, 0.13, eyeOpen, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.ellipse(0.22, 0.1, 0.07, eyeOpen * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0.24, 0.07, 0.025, 0.025, 0, 0, Math.PI * 2);
  ctx.fill();

  // 鼻子小点
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0.27, 0.012, 0.018, 0, 0, Math.PI * 2);
  ctx.fill();

  // 嘴 (微笑曲线)
  ctx.strokeStyle = "rgba(120, 60, 60, 0.9)";
  ctx.lineWidth = 0.018;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.07, 0.4);
  ctx.quadraticCurveTo(0, 0.46, 0.07, 0.4);
  ctx.stroke();

  // 腮红
  ctx.fillStyle = `hsla(${(hue + 340) % 360}, 80%, 70%, 0.45)`;
  ctx.beginPath();
  ctx.ellipse(-0.32, 0.28, 0.08, 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.32, 0.28, 0.08, 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  // PLACEHOLDER 标签 — 提醒这是占位, 不是真 Live2D
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = "0.075px monospace";
  ctx.textAlign = "center";
  ctx.fillText("◈ PLACEHOLDER LIVE2D", 0, 0.85);
}
