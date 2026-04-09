"use client";

import { useState } from "react";
import {
  studioConfig,
  STUDIO_CONFIG_DEFAULTS,
} from "@/lib/broadcast/studio-config";

// ────────────────────────────────────────────────────────────────
// 动捕设置面板 — slider 调头部 / 眼睛 / 身体 / 呼吸 灵敏度, 加 calibration
// 按钮. 直接 mutation 全局 studioConfig, face tracker 和 live2d renderer
// 每帧读, 改动立即生效, 无需事件订阅.
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

interface SectionProps {
  title: string;
  color: string; // tailwind text color class
  children: React.ReactNode;
}

function Section({ title, color, children }: SectionProps) {
  return (
    <div className="space-y-2 pt-2 border-t border-border-pixel/30 first:border-t-0 first:pt-0">
      <h4
        className={`font-[family-name:var(--font-pixel)] text-[8px] uppercase tracking-wider ${color}`}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

export function MotionSettingsPanel() {
  // 初值从 studioConfig 取 (而不是 defaults), 这样如果用户跨页面切换,
  // mutation 仍然保留. defaults 只用于"重置"按钮.
  const [faceScale, setFaceScale] = useState(studioConfig.faceAngleScale);
  const [eyeOpenScale, setEyeOpenScale] = useState(studioConfig.eyeOpenScale);
  const [eyeBallScale, setEyeBallScale] = useState(studioConfig.eyeBallScale);
  const [bodyFollow, setBodyFollow] = useState(studioConfig.bodyFollowFactor);
  const [breathEnabled, setBreathEnabled] = useState(
    studioConfig.breathEnabled
  );
  const [breathAmp, setBreathAmp] = useState(studioConfig.breathAmpY);
  const [breathFreq, setBreathFreq] = useState(studioConfig.breathFreqHz);
  const [calibBlink, setCalibBlink] = useState(false);

  const reset = () => {
    setFaceScale(STUDIO_CONFIG_DEFAULTS.faceAngleScale);
    setEyeOpenScale(STUDIO_CONFIG_DEFAULTS.eyeOpenScale);
    setEyeBallScale(STUDIO_CONFIG_DEFAULTS.eyeBallScale);
    setBodyFollow(STUDIO_CONFIG_DEFAULTS.bodyFollowFactor);
    setBreathEnabled(STUDIO_CONFIG_DEFAULTS.breathEnabled);
    setBreathAmp(STUDIO_CONFIG_DEFAULTS.breathAmpY);
    setBreathFreq(STUDIO_CONFIG_DEFAULTS.breathFreqHz);
    Object.assign(studioConfig, STUDIO_CONFIG_DEFAULTS);
  };

  const calibrate = () => {
    studioConfig.calibrationVersion += 1;
    // UI 反馈: 短暂闪烁 "已校准" 提示
    setCalibBlink(true);
    setTimeout(() => setCalibBlink(false), 800);
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

      {/* Calibration — 显眼的大按钮, 用户做任何调节前先校准 */}
      <button
        type="button"
        onClick={calibrate}
        className={`w-full pixel-border px-3 py-2 font-[family-name:var(--font-pixel)] text-[9px] uppercase tracking-wider transition-colors ${
          calibBlink
            ? "bg-accent-green/30 text-accent-green"
            : "bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/30"
        }`}
        title="保持自然正脸 + 自然睁眼, 点击记录基准"
      >
        {calibBlink ? "✓ 已校准" : "⊕ 校准 / Calibrate"}
      </button>
      <p className="text-[9px] text-text-secondary/60 leading-relaxed -mt-1">
        保持自然正脸 + 自然睁眼时点击, 系统记录这是中性姿态.
      </p>

      <Section title="头部" color="text-accent-cyan">
        <SliderRow
          label="灵敏度"
          value={faceScale}
          min={0.1}
          max={1.5}
          step={0.05}
          onChange={(v) => {
            setFaceScale(v);
            studioConfig.faceAngleScale = v;
          }}
        />
      </Section>

      <Section title="眼睛" color="text-accent-yellow">
        <SliderRow
          label="开合灵敏度"
          value={eyeOpenScale}
          min={0.3}
          max={3}
          step={0.1}
          onChange={(v) => {
            setEyeOpenScale(v);
            studioConfig.eyeOpenScale = v;
          }}
        />
        <SliderRow
          label="眼球追踪"
          value={eyeBallScale}
          min={0.3}
          max={3}
          step={0.1}
          onChange={(v) => {
            setEyeBallScale(v);
            studioConfig.eyeBallScale = v;
          }}
        />
      </Section>

      <Section title="身体" color="text-accent-green">
        <SliderRow
          label="跟随头部"
          value={bodyFollow}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(v) => {
            setBodyFollow(v);
            studioConfig.bodyFollowFactor = v;
          }}
        />
      </Section>

      <Section title="呼吸" color="text-accent-red">
        {/* 开关 */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary uppercase tracking-wider">
            模拟开关
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
          label="幅度"
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
          label="频率"
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
      </Section>
    </div>
  );
}
