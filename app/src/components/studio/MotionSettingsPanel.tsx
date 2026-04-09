"use client";

import { useState } from "react";
import {
  studioConfig,
  STUDIO_CONFIG_DEFAULTS,
} from "@/lib/broadcast/studio-config";

// ────────────────────────────────────────────────────────────────
// 动捕设置面板 — slider 调头部灵敏度 + 呼吸参数, 直接 mutation
// 全局 studioConfig. face tracker 和 live2d renderer 每帧读这个
// object, 改动立即生效, 无需事件订阅.
//
// 状态来源: useState 持有显示值, onChange 同时 set state + mutate
// studioConfig. 关闭 / 重新挂载时不丢失 (mutation 是真理来源).
// ────────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: SliderRowProps) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary uppercase tracking-wider">
          {label}
        </span>
        <span className="font-mono text-[10px] text-accent-cyan">
          {value.toFixed(step < 0.1 ? 2 : 1)}
          {unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-bg-surface rounded-none appearance-none cursor-pointer accent-accent-cyan"
      />
    </label>
  );
}

export function MotionSettingsPanel() {
  // 初值从 studioConfig 取 (而不是 defaults), 这样如果用户跨页面切换,
  // mutation 仍然保留. defaults 只用于"重置"按钮.
  const [faceScale, setFaceScale] = useState(studioConfig.faceAngleScale);
  const [breathEnabled, setBreathEnabled] = useState(
    studioConfig.breathEnabled
  );
  const [breathAmp, setBreathAmp] = useState(studioConfig.breathAmpY);
  const [breathFreq, setBreathFreq] = useState(studioConfig.breathFreqHz);

  const reset = () => {
    setFaceScale(STUDIO_CONFIG_DEFAULTS.faceAngleScale);
    setBreathEnabled(STUDIO_CONFIG_DEFAULTS.breathEnabled);
    setBreathAmp(STUDIO_CONFIG_DEFAULTS.breathAmpY);
    setBreathFreq(STUDIO_CONFIG_DEFAULTS.breathFreqHz);
    studioConfig.faceAngleScale = STUDIO_CONFIG_DEFAULTS.faceAngleScale;
    studioConfig.breathEnabled = STUDIO_CONFIG_DEFAULTS.breathEnabled;
    studioConfig.breathAmpY = STUDIO_CONFIG_DEFAULTS.breathAmpY;
    studioConfig.breathFreqHz = STUDIO_CONFIG_DEFAULTS.breathFreqHz;
  };

  return (
    <div className="pixel-border bg-bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-purple uppercase tracking-wider">
          ◈ 动捕设置
        </h3>
        <button
          type="button"
          onClick={reset}
          className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary hover:text-accent-purple uppercase tracking-wider"
          title="重置为默认值"
        >
          ↺ 重置
        </button>
      </div>

      <SliderRow
        label="头部灵敏度"
        value={faceScale}
        min={0.1}
        max={1.5}
        step={0.05}
        onChange={(v) => {
          setFaceScale(v);
          studioConfig.faceAngleScale = v;
        }}
      />

      {/* 呼吸开关 */}
      <label className="flex items-center justify-between cursor-pointer">
        <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary uppercase tracking-wider">
          呼吸模拟
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !breathEnabled;
            setBreathEnabled(next);
            studioConfig.breathEnabled = next;
          }}
          className={`pixel-border px-2 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] uppercase tracking-wider transition-colors ${
            breathEnabled
              ? "bg-accent-green/20 text-accent-green"
              : "bg-bg-surface text-text-secondary"
          }`}
        >
          {breathEnabled ? "● 开" : "○ 关"}
        </button>
      </label>

      <SliderRow
        label="呼吸幅度"
        value={breathAmp}
        min={0}
        max={15}
        step={0.5}
        unit="°"
        onChange={(v) => {
          setBreathAmp(v);
          studioConfig.breathAmpY = v;
        }}
      />

      <SliderRow
        label="呼吸频率"
        value={breathFreq}
        min={0.05}
        max={1}
        step={0.05}
        unit=" Hz"
        onChange={(v) => {
          setBreathFreq(v);
          studioConfig.breathFreqHz = v;
        }}
      />

      <p className="text-[9px] text-text-secondary/60 leading-relaxed pt-1">
        头部灵敏度 = MediaPipe 物理角度的缩放系数。
        ±50° 头转 × 0.4 = ±20° 输出, 匹配 vtube.json。
      </p>
    </div>
  );
}
