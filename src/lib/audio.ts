"use client";

/**
 * Web Audio API synthesizer & Haptic feedback helper.
 * Generates pleasant, non-intrusive sound chimes directly in the browser
 * without relying on external MP3 assets, guaranteeing 100% reliability.
 */

class SoundEffects {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  constructor() {
    // AudioContext will lazy-initialize on user interaction or first play
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("habesha_sound_enabled");
      this.enabled = stored !== "false";
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(val: boolean) {
    this.enabled = val;
    if (typeof window !== "undefined") {
      localStorage.setItem("habesha_sound_enabled", val ? "true" : "false");
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /** Subtle pop/ping chime for incoming chat messages */
  public playChatChime() {
    if (!this.enabled) return;
    this.triggerHaptic([25]);

    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08); // A5

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      /* ignore audio context restrictions */
    }
  }

  /** Triumphant, repeated ring for money received / a completed trade. */
  public playSuccessChime() {
    if (!this.enabled) return;
    this.triggerHaptic(SoundEffects.TRANSACTION_VIBRATION);
    this.ringThrice(1046.5, 783.99, "triangle", 0.22); // C6 ↔ G5, warm bell
  }

  /** Urgent, repeated ring for an action-needed / problem event. */
  public playAlertChime() {
    if (!this.enabled) return;
    this.triggerHaptic(SoundEffects.TRANSACTION_VIBRATION);
    this.ringThrice(880, 587.33, "sawtooth", 0.18); // A5 ↔ D5, sharp
  }

  // A long, attention-grabbing vibration (~3.3 s of firm pulses) for money & order
  // events — like a food-delivery app alerting a driver, so it isn't missed on an
  // idle phone. (Android/Chrome honour this; iOS Safari ignores the Vibration API.)
  private static readonly TRANSACTION_VIBRATION = [
    700, 250, 700, 250, 700, 250, 700,
  ];

  /** One warbling "ring" (bell-like, ~0.5 s) scheduled at `at` on the audio clock. */
  private ring(
    ctx: AudioContext,
    at: number,
    hi: number,
    lo: number,
    type: OscillatorType,
    vol: number,
  ) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    // Alternate the two tones so it reads as a "rrring", not a flat beep.
    [hi, lo, hi, lo, hi].forEach((f, i) =>
      osc.frequency.setValueAtTime(f, at + i * 0.08),
    );
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    gain.gain.setValueAtTime(vol, at + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.5);
  }

  /** Ring 3 times with a short gap — the "you have a transaction" alert. */
  private ringThrice(hi: number, lo: number, type: OscillatorType, vol: number) {
    const ctx = this.getContext();
    if (!ctx) return;
    const base = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      try {
        this.ring(ctx, base + i * 0.62, hi, lo, type, vol);
      } catch {
        /* ignore audio context restrictions */
      }
    }
  }

  private triggerHaptic(pattern: number[]) {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* haptics unsupported or blocked */
      }
    }
  }
}

export const soundEffects = new SoundEffects();
