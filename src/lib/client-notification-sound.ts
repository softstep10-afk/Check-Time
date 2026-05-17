"use client";

type AudioContextConstructor = typeof AudioContext;

type WebAudioWindow = Window & {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
};

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const audioWindow = window as WebAudioWindow;
  const Ctor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Ctor) return null;

  try {
    sharedCtx ??= new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

function playTone(freq: number, duration: number, startAt: number, gain: number) {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    vol.gain.setValueAtTime(gain, startAt);
    vol.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration);
  } catch {
    // Audio is best-effort. Browser autoplay policy must never break UI.
  }
}

export function unlockNotificationAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
}

export function playNotificationChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  const now = ctx.currentTime;
  playTone(988, 0.12, now, 0.075);
  playTone(1319, 0.14, now + 0.13, 0.07);
  playTone(988, 0.16, now + 0.31, 0.055);
}
