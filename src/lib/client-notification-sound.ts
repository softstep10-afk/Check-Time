"use client";

let sharedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx) {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

function playTone(freq: number, duration: number, startAt: number, gain: number) {
  const ctx = getAudioCtx();
  if (!ctx) return;
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
}

export function unlockNotificationAudio(): void {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
}

export function playNotificationChime(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  playTone(988, 0.12, now, 0.075);
  playTone(1319, 0.14, now + 0.13, 0.07);
  playTone(988, 0.16, now + 0.31, 0.055);
}
