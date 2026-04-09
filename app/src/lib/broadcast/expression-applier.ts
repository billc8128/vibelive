// ────────────────────────────────────────────────────────────────
// Live2D Cubism 4 .exp3.json — runtime applier with fade.
//
// .exp3.json 结构 (Cubism 标准):
//   {
//     "Type": "Live2D Expression",
//     "FadeInTime": 0.5,    // 可选, 不写就用我们默认 500ms
//     "FadeOutTime": 0.5,
//     "Parameters": [
//       { "Id": "ParamCheek", "Value": 1, "Blend": "Add" },
//       ...
//     ]
//   }
//
// Blend 模式三种:
//   Add       → coreModel.addParameterValueById(id, value, weight)
//   Multiply  → coreModel.multiplyParameterValueById(id, value, weight)
//   Overwrite → coreModel.setParameterValueById(id, value, weight)
//
// 我们的应用顺序: face tracking 先写, expression 后写 — 表情参数会
// 覆盖追踪的对应参数 (跟 VTube Studio 一致). 这正好是 beforeModelUpdate
// hook 里 vtubeApplier → expressionApplier 的执行顺序.
//
// Fade 处理: 用一个 weight (0..1) 平滑过渡. 切换表情时, 当前表情
// fade out → 0, 然后 pending 表情 fade in → 1. 同一帧 set 同一个表情
// 直接 no-op.
// ────────────────────────────────────────────────────────────────

interface ExpParam {
  Id?: string;
  Value?: number;
  Blend?: string;
}

interface ExpressionData {
  Parameters?: ExpParam[];
  FadeInTime?: number;
  FadeOutTime?: number;
}

interface CubismLikeModel {
  setParameterValueById(id: string, value: number, weight?: number): void;
  addParameterValueById?(id: string, value: number, weight?: number): void;
  multiplyParameterValueById?(id: string, value: number, weight?: number): void;
}

const DEFAULT_FADE_MS = 500;

export class ExpressionApplier {
  /** Map<filename, parsed exp3 data>. 第一次访问时 fetch + cache. */
  private cache = new Map<string, ExpressionData>();

  /** 当前正在应用的表情 — null 表示无表情. */
  private current: { name: string; data: ExpressionData } | null = null;
  /** 当 current 在 fade out 时, 等队的下一个表情. */
  private pending: { name: string; data: ExpressionData } | null = null;

  /** Fade 阶段: in → 0→1, out → 1→0, idle → 维持 weight. */
  private phase: "in" | "out" | "idle" = "idle";
  private weight = 0;

  /**
   * 切换激活的表情. name=null 清除 (RemoveAllExpressions).
   * baseUrls — 按顺序尝试的目录前缀列表 (用于兼容不同模型布局,
   * 比如 saba1B 把 exp 放 animetions/, 其他模型可能放根目录).
   *
   * 这个方法是 fire-and-forget, 不阻塞调用方. 抛错时静默吞掉.
   */
  async setActive(baseUrls: string[], name: string | null): Promise<void> {
    if (name === null) {
      if (this.current) {
        this.phase = "out";
      }
      this.pending = null;
      return;
    }

    // 同名 + 已激活 — no-op (避免每帧重复 setActive 重置 fade)
    if (this.current?.name === name && this.phase !== "out") return;
    if (this.pending?.name === name) return;

    // 加载数据 (cache 命中就跳过 fetch)
    let data = this.cache.get(name);
    if (!data) {
      const fetched = await this.fetchExpression(baseUrls, name);
      if (!fetched) return; // 全部 baseUrls 都 404, 放弃
      data = fetched;
      this.cache.set(name, data);
    }

    if (this.current && this.phase !== "out") {
      // 当前表情还在 in/idle, 先让它 fade out
      this.pending = { name, data };
      this.phase = "out";
    } else if (this.current && this.phase === "out") {
      // 当前正在 fade out, 替换 pending
      this.pending = { name, data };
    } else {
      // 没有当前表情 — 直接进入
      this.current = { name, data };
      this.weight = 0;
      this.phase = "in";
    }
  }

  /** 每帧调用 — 推进 fade, 应用参数到 coreModel. dtMs 来自上一帧间隔. */
  apply(coreModel: CubismLikeModel, dtMs: number): void {
    // 推进 weight
    if (this.phase === "in") {
      const fadeMs = (this.current?.data.FadeInTime ?? 0) * 1000 || DEFAULT_FADE_MS;
      this.weight = Math.min(1, this.weight + dtMs / fadeMs);
      if (this.weight >= 1) this.phase = "idle";
    } else if (this.phase === "out") {
      const fadeMs = (this.current?.data.FadeOutTime ?? 0) * 1000 || DEFAULT_FADE_MS;
      this.weight = Math.max(0, this.weight - dtMs / fadeMs);
      if (this.weight <= 0) {
        this.current = null;
        this.phase = "idle";
        // 切到 pending (如果有)
        if (this.pending) {
          this.current = this.pending;
          this.pending = null;
          this.weight = 0;
          this.phase = "in";
        }
      }
    }

    if (!this.current || this.weight <= 0) return;
    const params = this.current.data.Parameters;
    if (!Array.isArray(params)) return;

    for (const p of params) {
      if (!p?.Id) continue;
      const value = Number(p.Value ?? 0);
      const blend = p.Blend ?? "Overwrite";
      try {
        if (blend === "Add" && coreModel.addParameterValueById) {
          coreModel.addParameterValueById(p.Id, value, this.weight);
        } else if (blend === "Multiply" && coreModel.multiplyParameterValueById) {
          coreModel.multiplyParameterValueById(p.Id, value, this.weight);
        } else {
          // Overwrite (默认), 也兜底 Multiply/Add 在 coreModel 没暴露时
          coreModel.setParameterValueById(p.Id, value, this.weight);
        }
      } catch {
        // 模型上没有这个参数 ID — 静默吞掉
      }
    }
  }

  /** 完全清空状态 (e.g. renderer dispose). */
  reset(): void {
    this.current = null;
    this.pending = null;
    this.phase = "idle";
    this.weight = 0;
  }

  // ────────────────────────────────────────────────────────────────

  /**
   * 按 baseUrls 顺序尝试 fetch. 第一个返回 200 的就用. 全 404 返回 null.
   * 这种"多前缀"策略是因为 .vtube.json 的 Hotkey.File 字段不带子目录,
   * 但实际文件可能在 animetions/ 子目录里 (saba1B 就是这样).
   */
  private async fetchExpression(
    baseUrls: string[],
    name: string
  ): Promise<ExpressionData | null> {
    for (const base of baseUrls) {
      const url = base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
      try {
        const res = await fetch(url);
        if (res.ok) return (await res.json()) as ExpressionData;
      } catch {
        // 网络错误 — 继续试下一个 base
      }
    }
    console.warn(`[expression] ${name} 在所有 baseUrl 都未找到`);
    return null;
  }
}
