"use client";

import {
  Room,
  Track,
  LocalAudioTrack,
  type LocalTrackPublication,
} from "livekit-client";

// ────────────────────────────────────────────────────────────────
// AudioMixer — singleton 管理 studio 推流的麦克风 + 系统声音.
//
// 为什么单例 (而不是 StudioPublisher 内部):
//   - 音频状态需要跨"未推流 / 推流中"两种模式持续存在
//     (level meter 在推流前就要 monitor 麦克风, 让用户先确认能听到)
//   - UI 需要订阅实时状态变化 (设备列表, 电平, mute) — publisher 的
//     PublisherSnapshot 太粗粒度
//   - 直播中改设置不应该重连 LiveKit room — track.mute() / replaceTrack()
//     是无延迟的, 跟 unpublish + republish 走 SDP 重协商完全不同
//
// Web Audio 图 (mic 和 system 各一份, 互相独立):
//
//   ┌─ getUserMedia ─┐                                       ┌─ LK publish ─┐
//   │   raw stream   ├──source──┬──gain──destination──[track]┤              │
//   │                │          │                            └──────────────┘
//   └────────────────┘          └──analyser (level meter)
//
// 把 gain 放在 LK publish 之前的原因: 用户调"音量"应该让接收者听到的就是
// 调过的音量, 不是先正常发出去再让接收端音量按钮压低. 同时 analyser 接在
// source 端 (gain 之前), 这样 level meter 显示的是用户麦克风原始电平,
// 跟 gain slider 的位置无关 — slider 显示"我说话有多大声", 不是"传到
// 对方的有多大声".
//
// Mute / device 切换的成本:
//   - LK track.mute()      : ~5ms, 不重协商, 只是发停止信号
//   - LK replaceTrack()    : ~10ms, 不重协商, 换底层 MediaStreamTrack
//   - unpublish + publish  : ~200ms, 走 SDP 重协商, 接收端会看到 track 消失再出现
//
// 所以 user toggle on/off 走 mute(), 改设备走 replaceTrack(),
// 只在彻底关闭/重启时才 unpublish.
// ────────────────────────────────────────────────────────────────

export type PermissionState = "unknown" | "granted" | "denied" | "unavailable";

export interface AudioMixerSnapshot {
  // ── 权限 / 浏览器能力 ──
  micPermission: PermissionState;
  /** 浏览器是否支持 getDisplayMedia 抓系统声音 (Safari 不支持) */
  systemSupported: boolean;

  // ── Mic ──
  /** 用户开关 — true 表示要发声, false 表示静音 */
  micEnabled: boolean;
  /** Stream + LK track 已就绪 (可以 mute/unmute, 可以 publish) */
  micReady: boolean;
  /** 当前选中的设备 id, null = 系统默认 */
  micDeviceId: string | null;
  /** Web Audio gain, 1 = 原始音量, 0 = 静音, 2 = 放大 6dB */
  micGain: number;
  /** 实时电平 RMS [0, 1], setInterval 30fps 刷新 */
  micLevel: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;

  // ── System ──
  systemEnabled: boolean;
  systemReady: boolean;
  systemGain: number;
  systemLevel: number;

  // ── Devices ──
  devices: Array<{ deviceId: string; label: string }>;

  // ── Connection ──
  attachedToRoom: boolean;

  // ── Errors ──
  error: string | null;
}

type Listener = (snap: AudioMixerSnapshot) => void;

const DEFAULT_SNAPSHOT: AudioMixerSnapshot = {
  micPermission: "unknown",
  systemSupported: false, // hydration 后 detectCapabilities() 改成正确值
  micEnabled: true,
  micReady: false,
  micDeviceId: null,
  micGain: 1,
  micLevel: 0,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
  systemEnabled: false,
  systemReady: false,
  systemGain: 1,
  systemLevel: 0,
  devices: [],
  attachedToRoom: false,
  error: null,
};

// Safari/Chrome 兼容: webkitAudioContext 是老 Safari 的别名
type AudioContextCtor = typeof AudioContext;
function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

class AudioMixerImpl {
  // ── State ──
  private snap: AudioMixerSnapshot = { ...DEFAULT_SNAPSHOT };
  private listeners = new Set<Listener>();

  // ── Mic Web Audio graph ──
  private audioCtx: AudioContext | null = null; // mic + system 共用一个 context
  private micRawStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micDest: MediaStreamAudioDestinationNode | null = null;
  private micLkTrack: LocalAudioTrack | null = null;
  private micPublication: LocalTrackPublication | null = null;
  private micEndedHandler: (() => void) | null = null;

  // ── System Web Audio graph ──
  private systemRawStream: MediaStream | null = null;
  private systemSource: MediaStreamAudioSourceNode | null = null;
  private systemGainNode: GainNode | null = null;
  private systemAnalyser: AnalyserNode | null = null;
  private systemDest: MediaStreamAudioDestinationNode | null = null;
  private systemLkTrack: LocalAudioTrack | null = null;
  private systemPublication: LocalTrackPublication | null = null;
  private systemEndedHandler: (() => void) | null = null;

  // ── Room ──
  private room: Room | null = null;

  // ── Level meter loop ──
  private meterTimerId: number | null = null;
  private static METER_INTERVAL_MS = 33; // ~30fps, 比 RAF 60fps 省 CPU

  // ── DeviceChange listener installed flag ──
  private deviceChangeAttached = false;

  // ── Reentrancy locks ──
  // requestMicPermission 锁: React StrictMode dev 默认会双 mount, 让 useEffect
  // 跑两次. 没锁的话两次都进 openMicStream, 各自 await getUserMedia, 然后两个
  // source 节点都 connect 到同一个持久 gain → 双声道叠加 + 第一个 stream 引用
  // 被覆盖泄漏. 锁让第二次直接 await 第一次的 promise, 完了之后 micReady=true
  // 早返回, 不重复跑.
  private requestMicInFlight: Promise<void> | null = null;

  constructor() {
    // 浏览器 capability detection — 跟 SSR 解耦
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      this.snap = {
        ...this.snap,
        systemSupported:
          typeof navigator.mediaDevices.getDisplayMedia === "function",
      };
    }
  }

  // ── Public API ────────────────────────────────────────────────

  get snapshot(): AudioMixerSnapshot {
    return this.snap;
  }

  /** 订阅状态变化, 立刻 emit 一次当前 snapshot. 返回 unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    this.attachDeviceChangeListener();
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setSnap(patch: Partial<AudioMixerSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const f of this.listeners) {
      try {
        f(this.snap);
      } catch {
        // listener 抛错不能阻塞其他 listener
      }
    }
  }

  // ── Mic ───────────────────────────────────────────────────────

  /**
   * 申请麦克风权限并建图. 进 studio 时调.
   * 已经 ready 直接返回. 用户拒绝就 setSnap permission=denied 不抛.
   *
   * 并发安全: 如果已有调用在跑, 后续调用会 await 同一个 promise (不再重复
   * 申请权限). 这是为了 React StrictMode dev 双 mount — face-tracker 用同样
   * 的 starting promise 模式.
   */
  async requestMicPermission(): Promise<void> {
    if (this.snap.micReady) return;
    if (this.requestMicInFlight) {
      // 等已在跑的那次结果, 不管成功失败都直接返回 — 失败的话用户可以手动
      // 点 AudioMixerPanel 的"重试授权"按钮再试, 不要在这里自动重试 (会
      // 反复弹拒绝 dialog).
      try {
        await this.requestMicInFlight;
      } catch {
        // 已在 setSnap 里报告了错误, 这里吞掉
      }
      return;
    }
    this.requestMicInFlight = this._doRequestMicPermission();
    try {
      await this.requestMicInFlight;
    } finally {
      this.requestMicInFlight = null;
    }
  }

  private async _doRequestMicPermission(): Promise<void> {
    try {
      await this.openMicStream();
      this.setSnap({
        micPermission: "granted",
        micReady: true,
        error: null,
      });
      // permission granted 之后才能拿到设备 label
      await this.refreshDevices();
      this.startMeterLoop();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const msg = err.message;
      const denied =
        err.name === "NotAllowedError" ||
        msg.toLowerCase().includes("denied") ||
        msg.toLowerCase().includes("permission");
      this.setSnap({
        micPermission: denied ? "denied" : "unavailable",
        micReady: false,
        micEnabled: false,
        error: msg,
      });
      console.warn("[audio-mixer] mic permission failed:", err);
    }
  }

  /** 完全释放麦克风资源 (停 stream, 关 LK track). 退出 studio 时调. */
  releaseMic(): void {
    this.closeMicGraph();
    this.setSnap({
      micReady: false,
      micLevel: 0,
    });
    // 如果 system 也不在跑, 停 meter loop
    if (!this.snap.systemReady) {
      this.stopMeterLoop();
    }
  }

  /**
   * Mute / unmute. 直播中调用瞬时切换, 不重连.
   * 推流前调用只更新 state, 推流时会按 enabled 状态决定是否 publish.
   */
  setMicEnabled(enabled: boolean): void {
    if (this.snap.micEnabled === enabled) return;
    this.setSnap({ micEnabled: enabled });
    if (this.micLkTrack) {
      if (enabled) {
        this.micLkTrack.unmute().catch((e) => {
          console.warn("[audio-mixer] mic unmute failed:", e);
        });
      } else {
        this.micLkTrack.mute().catch((e) => {
          console.warn("[audio-mixer] mic mute failed:", e);
        });
      }
    }
  }

  /** 0..2 (1=原始, 0=静音, 2=放大 6dB). 立即生效, 用 setTargetAtTime 平滑. */
  setMicGain(gain: number): void {
    const clamped = Math.max(0, Math.min(2, gain));
    this.setSnap({ micGain: clamped });
    if (this.micGainNode && this.audioCtx) {
      // setTargetAtTime 防止 click — 10ms 时间常数, 用户感知不到延迟
      this.micGainNode.gain.setTargetAtTime(
        clamped,
        this.audioCtx.currentTime,
        0.01
      );
    }
  }

  /**
   * 切换麦克风设备. 直播中无需重连, 也无需 replaceTrack —
   * 因为 LK track 包装的是 Web Audio destination 的输出, 这个 track 永远
   * 不变. 我们只是换一个新的 source 节点 (不同的 raw mic) 接到同一个 gain
   * 节点上, destination 的输出依然是同一个 MediaStreamTrack, LiveKit 完全
   * 不知道 upstream 换了.
   */
  async setMicDevice(deviceId: string | null): Promise<void> {
    if (this.snap.micDeviceId === deviceId) return;
    this.setSnap({ micDeviceId: deviceId });
    if (!this.snap.micReady) return; // 还没拿到权限, 改了 deviceId 等下次 open 用
    try {
      await this.openMicStream();
      this.setSnap({ error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[audio-mixer] setMicDevice failed:", e);
      this.setSnap({ error: `切换设备失败: ${msg}` });
    }
  }

  async setEchoCancellation(value: boolean): Promise<void> {
    if (this.snap.echoCancellation === value) return;
    this.setSnap({ echoCancellation: value });
    await this.reapplyMicConstraints();
  }

  async setNoiseSuppression(value: boolean): Promise<void> {
    if (this.snap.noiseSuppression === value) return;
    this.setSnap({ noiseSuppression: value });
    await this.reapplyMicConstraints();
  }

  async setAutoGainControl(value: boolean): Promise<void> {
    if (this.snap.autoGainControl === value) return;
    this.setSnap({ autoGainControl: value });
    await this.reapplyMicConstraints();
  }

  // ── Mic internals ─────────────────────────────────────────────

  /**
   * 打开/重开 mic 输入. 关键设计:
   *   - **持久化** 的节点 (gainNode / analyser / dest / lkTrack) 第一次创建,
   *     之后跨 device / constraint 切换都不重建.
   *   - **临时** 的节点 (rawStream / sourceNode) 每次都重建.
   *   - 这样 LK 看到的 destination output track 永远不变 → 直播中切设备
   *     完全不需要 unpublish/republish, 也不需要 replaceTrack.
   */
  private async openMicStream(): Promise<void> {
    // ── 1. 停掉旧的 raw stream + source 节点 (如果存在) ──
    this.disconnectMicSource();

    // ── 2. getUserMedia 拿新的 raw stream ──
    const constraints: MediaTrackConstraints = {
      echoCancellation: this.snap.echoCancellation,
      noiseSuppression: this.snap.noiseSuppression,
      autoGainControl: this.snap.autoGainControl,
    };
    if (this.snap.micDeviceId) {
      constraints.deviceId = { exact: this.snap.micDeviceId };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: constraints,
      video: false,
    });
    this.micRawStream = stream;

    // 监听设备拔出 / 权限撤销 → 触发 ended 事件
    const rawTrack = stream.getAudioTracks()[0];
    if (rawTrack) {
      const handler = () => {
        console.warn("[audio-mixer] mic raw track ended");
        this.handleMicEnded();
      };
      this.micEndedHandler = handler;
      rawTrack.addEventListener("ended", handler);
    }

    // ── 3. 建 AudioContext (如果还没有) ──
    if (!this.audioCtx) {
      const Ctx = getAudioContextCtor();
      if (!Ctx) {
        throw new Error("浏览器不支持 Web Audio API");
      }
      this.audioCtx = new Ctx();
    }
    if (this.audioCtx.state === "suspended") {
      // 点击事件触发的 user gesture 应该已经允许 resume
      try {
        await this.audioCtx.resume();
      } catch {}
    }

    // ── 4. 第一次进入 — 建持久化的 gain / analyser / dest / lkTrack ──
    let firstInit = false;
    if (!this.micGainNode || !this.micAnalyser || !this.micDest || !this.micLkTrack) {
      firstInit = true;
      this.micGainNode = this.audioCtx.createGain();
      this.micGainNode.gain.value = this.snap.micGain;
      this.micAnalyser = this.audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 1024;
      this.micDest = this.audioCtx.createMediaStreamDestination();

      // gain → destination (持久, 之后不再断开)
      this.micGainNode.connect(this.micDest);

      // 包成 LiveKit LocalAudioTrack — 整个对象生命周期跟着 audioMixer 走
      const processedTrack = this.micDest.stream.getAudioTracks()[0];
      if (!processedTrack) {
        throw new Error("Web Audio destination 没有 audio track");
      }
      this.micLkTrack = new LocalAudioTrack(processedTrack);

      // 应用初始 mute 状态 (用户在权限申请前可能已经 setMicEnabled(false))
      if (!this.snap.micEnabled) {
        try {
          await this.micLkTrack.mute();
        } catch {}
      }
    }

    // ── 5. 把新的 raw stream 接到 graph 的入口 ──
    // source → gain → destination (gain 影响 LK 输出)
    // source → analyser (旁路, 显示原始电平不受 gain 影响)
    this.micSource = this.audioCtx.createMediaStreamSource(stream);
    this.micSource.connect(this.micGainNode);
    this.micSource.connect(this.micAnalyser);

    // ── 6. 如果是第一次 init 且已经在 room 里, 立即 publish ──
    // (情况: 先 attachToRoom, 然后才申请 mic 权限)
    if (firstInit && this.room && this.micLkTrack) {
      try {
        this.micPublication = await this.room.localParticipant.publishTrack(
          this.micLkTrack,
          {
            source: Track.Source.Microphone,
            name: "studio-mic",
          }
        );
      } catch (e) {
        console.error("[audio-mixer] late publish mic failed:", e);
      }
    }
  }

  /** 停 raw stream + 断 source 节点. 不动持久化的 gain/dest/lkTrack. */
  private disconnectMicSource() {
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }
    if (this.micRawStream) {
      const t = this.micRawStream.getAudioTracks()[0];
      if (t && this.micEndedHandler) {
        try {
          t.removeEventListener("ended", this.micEndedHandler);
        } catch {}
      }
      this.micRawStream.getTracks().forEach((tr) => {
        try {
          tr.stop();
        } catch {}
      });
      this.micRawStream = null;
    }
    this.micEndedHandler = null;
  }

  /** 完整释放整个 mic 图 — releaseMic / releaseAll 用. */
  private closeMicGraph() {
    this.disconnectMicSource();

    // 断持久化的节点
    if (this.micGainNode) {
      try {
        this.micGainNode.disconnect();
      } catch {}
      this.micGainNode = null;
    }
    if (this.micAnalyser) {
      try {
        this.micAnalyser.disconnect();
      } catch {}
      this.micAnalyser = null;
    }
    this.micDest = null; // MediaStreamAudioDestinationNode 没法 disconnect, 丢引用即可

    // LK track
    if (this.micLkTrack) {
      try {
        this.micLkTrack.stop();
      } catch {}
      this.micLkTrack = null;
    }
    // publication 引用清掉, 但 unpublish 是 detachFromRoom 的事
    this.micPublication = null;
  }

  private handleMicEnded() {
    // 设备拔出 / 浏览器撤销权限. 不重试, 让用户决定.
    this.closeMicGraph();
    this.setSnap({
      micReady: false,
      micPermission: "denied",
      micLevel: 0,
      error: "麦克风设备已断开或权限被撤销",
    });
  }

  private async reapplyMicConstraints(): Promise<void> {
    if (!this.snap.micReady) return;
    const track = this.micRawStream?.getAudioTracks()[0];
    if (!track) return;
    try {
      // 优先用 applyConstraints (不需要 re-getUserMedia)
      await track.applyConstraints({
        echoCancellation: this.snap.echoCancellation,
        noiseSuppression: this.snap.noiseSuppression,
        autoGainControl: this.snap.autoGainControl,
      });
    } catch (e) {
      // 部分浏览器对这些 constraint 不支持 applyConstraints, fallback 重开.
      // 因为 LK track 持久化, openMicStream 完了什么都不用做 — 直播继续.
      console.warn(
        "[audio-mixer] applyConstraints failed, fallback re-open:",
        e
      );
      try {
        await this.openMicStream();
      } catch (e2) {
        console.error("[audio-mixer] reapply via re-open failed:", e2);
      }
    }
  }

  // ── System ────────────────────────────────────────────────────

  /**
   * 申请系统声音 (浏览器分享音频). 必须在 user gesture (点击) 内调.
   * 用户没勾选"分享音频"会抛异常并清掉 systemEnabled.
   */
  async requestSystemAudio(): Promise<void> {
    if (!this.snap.systemSupported) {
      this.setSnap({ error: "当前浏览器不支持系统声音捕获" });
      return;
    }
    if (this.systemRawStream) return;

    try {
      // 必须 video: true 才能拿 audio (浏览器规范限制)
      // Chrome 只在用户共享 tab/window 时给 audio, 共享屏幕时不给
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const audioTracks = stream.getAudioTracks();
      // 立刻丢掉 video — 我们只要 audio
      stream.getVideoTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });

      if (audioTracks.length === 0) {
        // 用户没勾选"分享音频"
        throw new Error("没有获取到音频 — 分享时请勾选「同时分享音频」选项");
      }

      // 重组 stream 只含 audio
      this.systemRawStream = new MediaStream(audioTracks);

      const sysTrack = audioTracks[0];
      const handler = () => {
        console.warn("[audio-mixer] system audio track ended");
        this.handleSystemEnded();
      };
      this.systemEndedHandler = handler;
      sysTrack.addEventListener("ended", handler);

      // 建 AudioContext (跟 mic 共用)
      if (!this.audioCtx) {
        const Ctx = getAudioContextCtor();
        if (!Ctx) {
          throw new Error("浏览器不支持 Web Audio API");
        }
        this.audioCtx = new Ctx();
      }
      if (this.audioCtx.state === "suspended") {
        try {
          await this.audioCtx.resume();
        } catch {}
      }

      this.systemSource = this.audioCtx.createMediaStreamSource(
        this.systemRawStream
      );
      this.systemGainNode = this.audioCtx.createGain();
      this.systemGainNode.gain.value = this.snap.systemGain;
      this.systemAnalyser = this.audioCtx.createAnalyser();
      this.systemAnalyser.fftSize = 1024;
      this.systemDest = this.audioCtx.createMediaStreamDestination();

      this.systemSource.connect(this.systemGainNode);
      this.systemGainNode.connect(this.systemDest);
      this.systemSource.connect(this.systemAnalyser);

      const processedTrack = this.systemDest.stream.getAudioTracks()[0];
      if (!processedTrack) {
        throw new Error("system audio destination 没有 track");
      }
      this.systemLkTrack = new LocalAudioTrack(processedTrack);

      this.setSnap({
        systemReady: true,
        systemEnabled: true,
        error: null,
      });

      // 如果在直播, 立即 publish
      if (this.room && this.systemLkTrack) {
        try {
          this.systemPublication = await this.room.localParticipant.publishTrack(
            this.systemLkTrack,
            {
              source: Track.Source.ScreenShareAudio,
              name: "studio-sys",
            }
          );
        } catch (e) {
          console.error("[audio-mixer] publish system audio failed:", e);
        }
      }

      this.startMeterLoop();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn("[audio-mixer] requestSystemAudio failed:", err);
      this.setSnap({
        systemReady: false,
        systemEnabled: false,
        error: err.message,
      });
    }
  }

  /** 关掉系统声音, 释放资源. */
  releaseSystemAudio(): void {
    // unpublish from room — fire-and-forget (用户已经点了停止, 不等网络往返)
    if (this.room && this.systemPublication && this.systemLkTrack) {
      // unpublishTrack 第二个参数 stopOnUnpublish = false, 我们自己 stop
      this.room.localParticipant
        .unpublishTrack(this.systemLkTrack, false)
        .catch((e) => {
          console.warn("[audio-mixer] unpublish system audio failed:", e);
        });
    }
    this.systemPublication = null;

    try {
      this.systemSource?.disconnect();
    } catch {}
    try {
      this.systemGainNode?.disconnect();
    } catch {}
    try {
      this.systemAnalyser?.disconnect();
    } catch {}
    this.systemSource = null;
    this.systemGainNode = null;
    this.systemAnalyser = null;
    this.systemDest = null;

    if (this.systemRawStream) {
      const t = this.systemRawStream.getAudioTracks()[0];
      if (t && this.systemEndedHandler) {
        try {
          t.removeEventListener("ended", this.systemEndedHandler);
        } catch {}
      }
      this.systemRawStream.getTracks().forEach((tr) => {
        try {
          tr.stop();
        } catch {}
      });
      this.systemRawStream = null;
    }
    this.systemEndedHandler = null;

    if (this.systemLkTrack) {
      try {
        this.systemLkTrack.stop();
      } catch {}
      this.systemLkTrack = null;
    }

    this.setSnap({
      systemReady: false,
      systemEnabled: false,
      systemLevel: 0,
    });

    // 如果 mic 也不在跑, 停 meter loop
    if (!this.snap.micReady) {
      this.stopMeterLoop();
    }
  }

  private handleSystemEnded() {
    // 用户在浏览器原生 dialog 点了"停止分享"
    this.releaseSystemAudio();
  }

  /** 用户 toggle 系统声音开关. true 触发 dialog, false 直接释放. */
  setSystemEnabled(enabled: boolean): void {
    if (this.snap.systemEnabled === enabled) return;
    if (enabled) {
      // 注意: 这里返回的 promise 我们不 await, 因为 React onClick 不应该阻塞
      // 错误会在 setSnap 里反馈给 UI
      this.requestSystemAudio().catch(() => {});
    } else {
      this.releaseSystemAudio();
    }
  }

  setSystemGain(gain: number): void {
    const clamped = Math.max(0, Math.min(2, gain));
    this.setSnap({ systemGain: clamped });
    if (this.systemGainNode && this.audioCtx) {
      this.systemGainNode.gain.setTargetAtTime(
        clamped,
        this.audioCtx.currentTime,
        0.01
      );
    }
  }

  // ── Devices ───────────────────────────────────────────────────

  async refreshDevices(): Promise<void> {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.mediaDevices?.enumerateDevices !== "function"
    ) {
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          // permission 没给的时候 label 是空字符串
          label: d.label || `麦克风 ${i + 1}`,
        }));
      this.setSnap({ devices: inputs });
    } catch (e) {
      console.warn("[audio-mixer] enumerateDevices failed:", e);
    }
  }

  private attachDeviceChangeListener() {
    if (this.deviceChangeAttached) return;
    if (
      typeof navigator === "undefined" ||
      typeof navigator.mediaDevices?.addEventListener !== "function"
    ) {
      return;
    }
    navigator.mediaDevices.addEventListener("devicechange", () => {
      this.refreshDevices().catch(() => {});
    });
    this.deviceChangeAttached = true;
  }

  // ── Room integration ──────────────────────────────────────────

  /**
   * 由 StudioPublisher 在 LiveKit room.connect() 之后调用.
   * 策略: track 存在就 publish, mute 状态决定接收者听不听到. 这样直播中
   * toggle on/off 永远走 mute() 这条便宜路径, 不需要 publish/unpublish.
   * Muted 的 track 占的带宽几乎是 0 (LiveKit 服务端会停止转发).
   */
  async attachToRoom(room: Room): Promise<void> {
    this.room = room;
    // 清掉旧 error (上一次推流的残留), 让本次的失败状态可以干净写入
    this.setSnap({ attachedToRoom: true, error: null });

    // 收集所有 publish 错误, 最后一并写到 snap.error.
    // 设计选择: mic / system 是可选音轨, 单个失败不应该 throw 让 publisher
    // 整体进入 "error" 状态 (那样会导致视频流也被回滚). 但 UI 必须能看到
    // 失败原因, 不能像之前那样只 console.error 让用户上线后才发现没声音.
    const failures: string[] = [];

    // ── Mic ──
    if (this.micLkTrack) {
      try {
        this.micPublication = await room.localParticipant.publishTrack(
          this.micLkTrack,
          {
            source: Track.Source.Microphone,
            name: "studio-mic",
          }
        );
        // 应用 mute 状态
        if (this.snap.micEnabled) {
          await this.micLkTrack.unmute();
        } else {
          await this.micLkTrack.mute();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[audio-mixer] publish mic failed:", e);
        failures.push(`麦克风上传失败: ${msg}`);
      }
    }

    // ── System ──
    if (this.systemLkTrack) {
      try {
        this.systemPublication = await room.localParticipant.publishTrack(
          this.systemLkTrack,
          {
            source: Track.Source.ScreenShareAudio,
            name: "studio-sys",
          }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[audio-mixer] publish system audio failed:", e);
        failures.push(`系统声音上传失败: ${msg}`);
      }
    }

    if (failures.length > 0) {
      // 多条错误用换行连接, AudioMixerPanel 的 <p> 会自动换行显示
      this.setSnap({ error: failures.join(" · ") });
    }
  }

  /** 由 StudioPublisher.stop() 调用. unpublish 但不释放资源 (LK track 留着继续监听). */
  async detachFromRoom(): Promise<void> {
    if (!this.room) return;
    const room = this.room;

    if (this.micPublication && this.micLkTrack) {
      try {
        // stopOnUnpublish = false — 保留 track 给监听用
        await room.localParticipant.unpublishTrack(this.micLkTrack, false);
      } catch (e) {
        console.warn("[audio-mixer] unpublish mic failed:", e);
      }
      this.micPublication = null;
    }

    if (this.systemPublication && this.systemLkTrack) {
      try {
        await room.localParticipant.unpublishTrack(this.systemLkTrack, false);
      } catch (e) {
        console.warn("[audio-mixer] unpublish system audio failed:", e);
      }
      this.systemPublication = null;
    }

    this.room = null;
    this.setSnap({ attachedToRoom: false });
  }

  // ── Level meter loop ──────────────────────────────────────────

  private startMeterLoop() {
    if (this.meterTimerId !== null) return;
    if (typeof window === "undefined") return;
    this.meterTimerId = window.setInterval(() => {
      this.tickMeter();
    }, AudioMixerImpl.METER_INTERVAL_MS);
  }

  private stopMeterLoop() {
    if (this.meterTimerId !== null) {
      clearInterval(this.meterTimerId);
      this.meterTimerId = null;
    }
  }

  private tickMeter() {
    let micLevel = 0;
    let systemLevel = 0;

    if (this.micAnalyser) {
      micLevel = AudioMixerImpl.computeRMS(this.micAnalyser);
    }
    if (this.systemAnalyser) {
      systemLevel = AudioMixerImpl.computeRMS(this.systemAnalyser);
    }

    // 只在变化超过阈值时刷 snapshot, 避免 React re-render 风暴
    // (不动时电平接近 0, < 0.005 的抖动忽略)
    const micChanged = Math.abs(micLevel - this.snap.micLevel) > 0.005;
    const sysChanged =
      Math.abs(systemLevel - this.snap.systemLevel) > 0.005;
    if (micChanged || sysChanged) {
      this.setSnap({ micLevel, systemLevel });
    }
  }

  private static computeRMS(analyser: AnalyserNode): number {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i] * buf[i];
    }
    // Voice RMS 大致 0.01-0.3 范围, UI 可以 *3 放大显示
    return Math.sqrt(sum / buf.length);
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /** 完整清理 — 退出 studio 或者 hot-reload 时调. */
  releaseAll(): void {
    this.stopMeterLoop();
    this.closeMicGraph();
    this.releaseSystemAudio();
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }
    this.setSnap({
      micReady: false,
      micLevel: 0,
      systemReady: false,
      systemLevel: 0,
    });
  }
}

export const audioMixer = new AudioMixerImpl();
