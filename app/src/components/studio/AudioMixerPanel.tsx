"use client";

import { useEffect, useSyncExternalStore } from "react";
import { audioMixer } from "@/lib/broadcast/audio-mixer";

// ────────────────────────────────────────────────────────────────
// AudioMixerPanel — 直播工作室的麦克风 + 系统声音控制台.
//
// 状态来源: audioMixer singleton (全局, 跨 page 持久). 用 useSyncExternalStore
// 订阅 snapshot, 跟 React state 干净集成 (concurrent mode 安全).
//
// 直接 mutation singleton: setMicEnabled / setMicGain / setSystemEnabled / ...
// audioMixer 内部会触发 setSnap → 通知所有 listener → React re-render.
// 不走 React state → mutation, 是因为状态需要在 page navigate / hot-reload
// 之后保留 (跟 face tracker 一样的策略).
// ────────────────────────────────────────────────────────────────

// useSyncExternalStore subscribe — 注意 stable reference, 不要每次 render 新建.
// audioMixer.subscribe 已经是稳定的, getSnapshot 也是稳定的, 直接传.
const subscribe = (cb: () => void) => audioMixer.subscribe(cb);
const getSnapshot = () => audioMixer.snapshot;
// SSR 阶段没有 audioMixer (well, singleton 存在但没值), 给个空 snapshot
const getServerSnapshot = () => audioMixer.snapshot;

// ────────────────────────────────────────────────────────────────
// Level meter — 用 div 宽度模拟竖直/水平 bar.
// RMS [0, 0.3] 是常规人声范围, *3 放大让小声音也能看到反馈
// ────────────────────────────────────────────────────────────────

interface MeterProps {
  level: number; // 0..1
  active: boolean;
}

function Meter({ level, active }: MeterProps) {
  // 放大 ~3x, clamp 到 1
  const display = Math.min(1, level * 3);
  // 颜色: 低绿, 中黄, 高红 (常见 VU 风格)
  const color =
    display < 0.5
      ? "bg-accent-green"
      : display < 0.8
        ? "bg-accent-yellow"
        : "bg-accent-red";
  return (
    <div className="h-1.5 w-full bg-bg-surface overflow-hidden border border-border-pixel/30">
      <div
        className={`h-full transition-[width] duration-75 ${active ? color : "bg-text-secondary/30"}`}
        style={{ width: `${display * 100}%` }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Slider row (复制 MotionSettingsPanel 的风格)
// ────────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: SliderRowProps) {
  return (
    <label className={`block ${disabled ? "opacity-40" : ""}`}>
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
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-bg-surface rounded-none appearance-none cursor-pointer accent-accent-cyan disabled:cursor-not-allowed"
      />
    </label>
  );
}

interface CheckRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function CheckRow({ label, checked, onChange, disabled }: CheckRowProps) {
  return (
    <label
      className={`flex items-center gap-2 cursor-pointer ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent-cyan"
      />
      <span className="font-[family-name:var(--font-pixel)] text-[8px] text-text-secondary uppercase tracking-wider">
        {label}
      </span>
    </label>
  );
}

// ────────────────────────────────────────────────────────────────
// Main panel
// ────────────────────────────────────────────────────────────────

export function AudioMixerPanel() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Mount 时申请麦克风权限 (一次性), 之后 audioMixer 自己持久化
  useEffect(() => {
    audioMixer.requestMicPermission().catch(() => {});
    // permission 给了之后才能拿到完整 device label, 再刷一次
    audioMixer.refreshDevices().catch(() => {});
  }, []);

  const micUsable =
    snap.micPermission === "granted" || snap.micPermission === "unknown";
  const showPermissionDenied = snap.micPermission === "denied";
  const showPermissionUnavailable = snap.micPermission === "unavailable";

  return (
    <div className="pixel-border bg-bg-card p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-[family-name:var(--font-pixel)] text-[9px] text-accent-purple uppercase tracking-wider">
          ◈ 音频混合器
        </h3>
        {snap.attachedToRoom ? (
          <span className="font-[family-name:var(--font-pixel)] text-[7px] text-accent-green uppercase tracking-wider">
            ● LIVE
          </span>
        ) : null}
      </div>

      {snap.error ? (
        <p className="text-[9px] text-accent-red/80 leading-relaxed">
          ⚠ {snap.error}
        </p>
      ) : null}

      {/* ── Mic 卡片 ─────────────────────────────────────────── */}
      <div className="space-y-2 pt-2 border-t border-border-pixel/30 first:border-t-0 first:pt-0">
        <div className="flex items-center justify-between">
          <h4 className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-cyan uppercase tracking-wider">
            🎤 麦克风
          </h4>
          {/* Mute toggle */}
          <button
            type="button"
            onClick={() => audioMixer.setMicEnabled(!snap.micEnabled)}
            disabled={!snap.micReady}
            className={`pixel-border px-2 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              snap.micEnabled && snap.micReady
                ? "bg-accent-green/20 text-accent-green"
                : "bg-bg-surface text-text-secondary"
            }`}
          >
            {snap.micEnabled && snap.micReady ? "● 开" : "○ 关"}
          </button>
        </div>

        {showPermissionDenied ? (
          <div className="space-y-2">
            <p className="text-[9px] text-accent-red/80 leading-relaxed">
              麦克风权限被拒绝. 推流将仅含视频. 在浏览器地址栏的锁图标里允许后刷新页面.
            </p>
            <button
              type="button"
              onClick={() => audioMixer.requestMicPermission()}
              className="pixel-border px-2 py-1 font-[family-name:var(--font-pixel)] text-[7px] uppercase tracking-wider bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/30 transition-colors"
            >
              ↺ 重试授权
            </button>
          </div>
        ) : showPermissionUnavailable ? (
          <p className="text-[9px] text-accent-red/80">
            找不到可用的麦克风设备
          </p>
        ) : null}

        {/* 设备选择 */}
        {micUsable && snap.devices.length > 0 ? (
          <div>
            <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary uppercase tracking-wider block mb-1">
              设备
            </span>
            <select
              value={snap.micDeviceId ?? ""}
              onChange={(e) =>
                audioMixer.setMicDevice(e.target.value || null)
              }
              disabled={!snap.micReady}
              className="w-full pixel-border bg-bg-surface text-text-primary text-[10px] px-2 py-1 disabled:opacity-40"
            >
              <option value="">系统默认</option>
              {snap.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Level meter */}
        <div>
          <Meter level={snap.micLevel} active={snap.micEnabled && snap.micReady} />
        </div>

        {/* Gain slider */}
        <SliderRow
          label="音量"
          value={snap.micGain}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => audioMixer.setMicGain(v)}
          disabled={!snap.micReady}
        />

        {/* Constraints */}
        <div className="space-y-1 pt-1">
          <CheckRow
            label="噪声抑制"
            checked={snap.noiseSuppression}
            onChange={(v) => audioMixer.setNoiseSuppression(v)}
            disabled={!snap.micReady}
          />
          <CheckRow
            label="回声消除"
            checked={snap.echoCancellation}
            onChange={(v) => audioMixer.setEchoCancellation(v)}
            disabled={!snap.micReady}
          />
          <CheckRow
            label="自动增益"
            checked={snap.autoGainControl}
            onChange={(v) => audioMixer.setAutoGainControl(v)}
            disabled={!snap.micReady}
          />
        </div>
      </div>

      {/* ── System audio 卡片 ──────────────────────────────────── */}
      <div className="space-y-2 pt-2 border-t border-border-pixel/30">
        <div className="flex items-center justify-between">
          <h4 className="font-[family-name:var(--font-pixel)] text-[8px] text-accent-yellow uppercase tracking-wider">
            🔊 系统声音
          </h4>
          {snap.systemSupported ? (
            <button
              type="button"
              onClick={() => audioMixer.setSystemEnabled(!snap.systemEnabled)}
              className={`pixel-border px-2 py-0.5 font-[family-name:var(--font-pixel)] text-[7px] uppercase tracking-wider transition-colors ${
                snap.systemEnabled && snap.systemReady
                  ? "bg-accent-green/20 text-accent-green"
                  : "bg-bg-surface text-text-secondary hover:bg-accent-yellow/10"
              }`}
            >
              {snap.systemEnabled && snap.systemReady
                ? "● 已开启"
                : "⊕ 添加来源"}
            </button>
          ) : (
            <span className="font-[family-name:var(--font-pixel)] text-[7px] text-text-secondary/60 uppercase">
              不支持
            </span>
          )}
        </div>

        {!snap.systemSupported ? (
          <p className="text-[9px] text-text-secondary/60 leading-relaxed">
            当前浏览器不支持系统声音捕获 (仅 Chrome / Edge 在 Windows / macOS 支持)
          </p>
        ) : !snap.systemReady ? (
          <p className="text-[9px] text-text-secondary/60 leading-relaxed">
            点击「添加来源」选择要分享的窗口或标签页, 并勾选「同时分享音频」
          </p>
        ) : (
          <>
            <Meter level={snap.systemLevel} active={snap.systemEnabled} />
            <SliderRow
              label="音量"
              value={snap.systemGain}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => audioMixer.setSystemGain(v)}
            />
          </>
        )}
      </div>
    </div>
  );
}
