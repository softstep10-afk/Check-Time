"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { JarvisOrb, type JarvisOrbState } from "@/components/shared/JarvisOrb";
import { useTranslation } from "@/lib/i18n";

type RealtimeState = "idle" | "connecting" | "connected" | "speaking" | "error";
type DockPosition = { x: number; y: number };

const DOCK_POSITION_KEY = "check-time.jarvisDock.position";
const DOCK_MARGIN = 10;
const REALTIME_TOKEN_MIN_TTL_MS = 10_000;
const REALTIME_TOKEN_FALLBACK_TTL_MS = 45_000;
const MIN_VISIBLE_CONNECTING_MS = 650;

function isVoiceActive(state: RealtimeState): boolean {
  return state === "connecting" || state === "connected" || state === "speaking";
}

function mapJarvisState(state: RealtimeState): JarvisOrbState {
  if (state === "error") return "error";
  if (state === "speaking") return "speaking";
  if (state === "connecting") return "thinking";
  if (state === "connected") return "listening";
  return "idle";
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getDefaultDockPosition(): DockPosition {
  if (typeof window === "undefined") return { x: 16, y: 420 };
  const left = window.innerWidth >= 768 ? 248 : 16;
  return {
    x: clamp(left, DOCK_MARGIN, window.innerWidth - 92),
    y: clamp(window.innerHeight - (window.innerWidth >= 768 ? 92 : 156), DOCK_MARGIN, window.innerHeight - 82),
  };
}

function readDockPosition(): DockPosition {
  if (typeof window === "undefined") return { x: 16, y: 420 };
  const fallback = getDefaultDockPosition();
  try {
    const stored = window.localStorage.getItem(DOCK_POSITION_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<DockPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return fallback;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractRealtimeClientSecret(payload: unknown): { secret: string; expiresAtMs: number } | null {
  const candidates: unknown[] = [payload];
  if (isRecord(payload)) {
    candidates.push(payload.realtime);
  }

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const directValue = candidate.value;
    if (typeof directValue === "string" && directValue.trim()) {
      const expiresAt = typeof candidate.expires_at === "number" ? candidate.expires_at * 1000 : 0;
      return {
        secret: directValue,
        expiresAtMs: expiresAt || Date.now() + REALTIME_TOKEN_FALLBACK_TTL_MS,
      };
    }

    const nested = candidate.client_secret;
    if (isRecord(nested) && typeof nested.value === "string" && nested.value.trim()) {
      const expiresAt = typeof nested.expires_at === "number" ? nested.expires_at * 1000 : 0;
      return {
        secret: nested.value,
        expiresAtMs: expiresAt || Date.now() + REALTIME_TOKEN_FALLBACK_TTL_MS,
      };
    }
  }

  return null;
}

export function JarvisDock() {
  const { t } = useTranslation();
  const dockRef = useRef<HTMLDivElement | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeStateRef = useRef<RealtimeState>("idle");
  const realtimeTokenRef = useRef<{ secret: string; expiresAtMs: number } | null>(null);
  const realtimeTokenPromiseRef = useRef<Promise<string> | null>(null);
  const realtimeAttemptRef = useRef(0);
  const dockPositionRef = useRef<DockPosition>({ x: 16, y: 420 });
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const pointerActivatedRef = useRef(false);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("idle");
  const [realtimeMessage, setRealtimeMessage] = useState("");
  const [dockPosition, setDockPosition] = useState<DockPosition>({ x: 16, y: 420 });
  const [positionReady, setPositionReady] = useState(false);

  const setRealtimeStatus = useCallback((state: RealtimeState, message = "") => {
    realtimeStateRef.current = state;
    setRealtimeState(state);
    setRealtimeMessage(message);
  }, []);

  const getRealtimeClientSecret = useCallback(async () => {
    const cached = realtimeTokenRef.current;
    if (cached && cached.expiresAtMs - Date.now() > REALTIME_TOKEN_MIN_TTL_MS) {
      return cached.secret;
    }
    if (realtimeTokenPromiseRef.current) {
      return realtimeTokenPromiseRef.current;
    }

    const promise = (async () => {
      const response = await fetch("/api/ai/realtime/token", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : t("jarvisDock.voiceTokenFailed");
        throw new Error(message);
      }
      const token = extractRealtimeClientSecret(payload);
      if (!token) {
        throw new Error(t("jarvisDock.voiceTokenFailed"));
      }
      realtimeTokenRef.current = token;
      return token.secret;
    })();

    realtimeTokenPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      realtimeTokenPromiseRef.current = null;
    }
  }, [t]);

  const stopRealtime = useCallback((nextState: RealtimeState = "idle", nextMessage = "") => {
    realtimeAttemptRef.current += 1;
    realtimeChannelRef.current?.close();
    realtimeChannelRef.current = null;
    realtimePeerRef.current?.close();
    realtimePeerRef.current = null;
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeStreamRef.current = null;
    if (realtimeAudioRef.current) {
      realtimeAudioRef.current.srcObject = null;
      realtimeAudioRef.current.remove();
      realtimeAudioRef.current = null;
    }
    realtimeStateRef.current = nextState;
    setRealtimeState(nextState);
    setRealtimeMessage(nextMessage);
  }, []);

  useEffect(() => () => stopRealtime(), [stopRealtime]);

  useEffect(() => {
    realtimeStateRef.current = realtimeState;
  }, [realtimeState]);

  useEffect(() => {
    if (!positionReady) return;
    const timer = window.setTimeout(() => {
      void getRealtimeClientSecret().catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [getRealtimeClientSecret, positionReady]);

  useEffect(() => {
    dockPositionRef.current = dockPosition;
  }, [dockPosition]);

  useEffect(() => {
    function fitToViewport(position: DockPosition): DockPosition {
      const rect = dockRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 172;
      const height = rect?.height ?? 74;
      return {
        x: clamp(position.x, DOCK_MARGIN, window.innerWidth - width - DOCK_MARGIN),
        y: clamp(position.y, DOCK_MARGIN, window.innerHeight - height - DOCK_MARGIN),
      };
    }

    const initialPosition = fitToViewport(readDockPosition());
    dockPositionRef.current = initialPosition;
    setDockPosition(initialPosition);
    setPositionReady(true);

    function handleResize() {
      setDockPosition((current) => {
        const next = fitToViewport(current);
        dockPositionRef.current = next;
        window.localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(next));
        return next;
      });
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function persistDockPosition(position: DockPosition) {
    try {
      window.localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(position));
    } catch {
      // If localStorage is unavailable, dragging still works for this session.
    }
  }

  function handleDockPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dockPosition.x,
      originY: dockPosition.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDockPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    if (!drag.moved) return;
    const rect = dockRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 172;
    const height = rect?.height ?? 74;
    const next = {
      x: clamp(drag.originX + dx, DOCK_MARGIN, window.innerWidth - width - DOCK_MARGIN),
      y: clamp(drag.originY + dy, DOCK_MARGIN, window.innerHeight - height - DOCK_MARGIN),
    };
    dockPositionRef.current = next;
    setDockPosition(next);
  }

  function handleDockPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    persistDockPosition(dockPositionRef.current);
    if (drag.moved) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      return;
    }
    pointerActivatedRef.current = true;
    window.setTimeout(() => {
      pointerActivatedRef.current = false;
    }, 350);
    activateDockVoice();
  }

  function handleDockClick() {
    if (pointerActivatedRef.current) {
      pointerActivatedRef.current = false;
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    activateDockVoice();
  }

  function activateDockVoice() {
    if (isVoiceActive(realtimeStateRef.current)) {
      stopRealtime();
      return;
    }
    void startRealtime();
  }

  async function startRealtime() {
    if (isVoiceActive(realtimeStateRef.current)) {
      return;
    }
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setRealtimeStatus("error", t("jarvisDock.voiceUnsupported"));
      return;
    }

    const attempt = realtimeAttemptRef.current + 1;
    realtimeAttemptRef.current = attempt;
    const startedAt = performance.now();
    setRealtimeStatus("connecting", t("jarvisDock.voiceConnecting"));
    try {
      const realtimeClientSecretPromise = getRealtimeClientSecret();
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const [realtimeClientSecret, stream] = await Promise.all([realtimeClientSecretPromise, streamPromise]);
      if (realtimeAttemptRef.current !== attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const peer = new RTCPeerConnection();
      realtimePeerRef.current = peer;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.controls = false;
      audio.volume = 1;
      audio.style.display = "none";
      audio.setAttribute("playsinline", "true");
      document.body.appendChild(audio);
      realtimeAudioRef.current = audio;
      peer.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        audio.srcObject = stream;
        void audio.play().catch(() => undefined);
      };

      realtimeStreamRef.current = stream;
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
      }

      const channel = peer.createDataChannel("oai-events");
      realtimeChannelRef.current = channel;
      channel.onopen = () => {
        if (realtimeAttemptRef.current !== attempt) return;
        setRealtimeStatus("connected", t("jarvisDock.voiceConnected"));
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions:
                "Скажи по-русски коротко: Джарвис на связи. Я слушаю.",
            },
          }),
        );
      };
      channel.onmessage = (event) => {
        if (realtimeAttemptRef.current !== attempt) return;
        if (typeof event.data !== "string") return;
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "response.audio.delta" || payload.type === "response.output_audio.delta") {
            setRealtimeStatus("speaking", t("jarvisDock.voiceConnected"));
          }
          if (payload.type === "input_audio_buffer.speech_started") {
            setRealtimeStatus("connected", t("jarvisDock.voiceConnected"));
          }
          if (
            payload.type === "response.done" ||
            payload.type === "response.audio.done" ||
            payload.type === "output_audio_buffer.stopped"
          ) {
            setRealtimeStatus("connected", t("jarvisDock.voiceConnected"));
          }
        } catch {
          // Realtime occasionally emits transport messages we do not need for UI state.
        }
      };
      channel.onclose = () => {
        if (realtimePeerRef.current && realtimeAttemptRef.current === attempt) {
          stopRealtime();
        }
      };
      channel.onerror = () => {
        if (realtimeAttemptRef.current === attempt) {
          stopRealtime("error", t("jarvisDock.voiceFailed"));
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      let sdpResponse: Response;
      try {
        sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${realtimeClientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!sdpResponse.ok) {
        const contentType = sdpResponse.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await sdpResponse.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? t("jarvisDock.voiceFailed"));
        }
        throw new Error(await sdpResponse.text());
      }
      const answer = await sdpResponse.text();
      if (realtimeAttemptRef.current !== attempt) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      if (realtimeAttemptRef.current !== attempt) return;
      const elapsed = performance.now() - startedAt;
      if (elapsed < MIN_VISIBLE_CONNECTING_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, MIN_VISIBLE_CONNECTING_MS - elapsed));
      }
      if (realtimeAttemptRef.current !== attempt) return;
      const text =
        error instanceof DOMException && error.name === "AbortError"
          ? t("jarvisDock.voiceTimeout")
          : error instanceof Error && error.message
            ? error.message
            : t("jarvisDock.voiceFailed");
      stopRealtime("error", text);
    }
  }

  const active = isVoiceActive(realtimeState);
  const label = active ? t("jarvisDock.voiceStop") : t("jarvisDock.voiceStart");
  const statusText = realtimeMessage || (active ? t("jarvisDock.voiceConnected") : "Jarvis");

  return (
    <div
      ref={dockRef}
      className={`fixed z-[70] flex touch-none select-none items-center gap-2 transition-opacity ${
        positionReady ? "opacity-100" : "opacity-0"
      }`}
      style={{ left: dockPosition.x, top: dockPosition.y }}
      onPointerDown={handleDockPointerDown}
      onPointerMove={handleDockPointerMove}
      onPointerUp={handleDockPointerUp}
      onPointerCancel={handleDockPointerUp}
      onPointerEnter={() => void getRealtimeClientSecret().catch(() => undefined)}
    >
      <button
        type="button"
        onClick={handleDockClick}
        className="jarvis-dock-orb-button group relative flex h-[68px] w-[68px] cursor-grab items-center justify-center rounded-full border transition hover:scale-[1.04] active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ai-cyan-bright)]"
        data-voice-state={realtimeState}
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(214, 252, 255, 0.98) 0 8%, rgba(91, 231, 255, 0.92) 9% 22%, rgba(7, 35, 62, 0.98) 23% 58%, rgba(3, 8, 18, 0.98) 59% 100%)",
          borderColor: active ? "rgba(130, 240, 255, 0.92)" : "rgba(130, 240, 255, 0.66)",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.18) inset, 0 0 26px rgba(91, 231, 255, 0.58), 0 0 54px rgba(14, 114, 170, 0.38), 0 18px 50px rgba(0,0,0,0.5)",
          color: "#dffbff",
        }}
        aria-label={label}
        title={label}
      >
        <span
          className="absolute inset-[6px] rounded-full border"
          style={{
            borderColor: "rgba(201, 248, 255, 0.4)",
            boxShadow: "0 0 18px rgba(91, 231, 255, 0.36) inset",
          }}
          aria-hidden
        />
        <span
          className="absolute inset-[14px] rounded-full border"
          style={{
            borderColor: "rgba(101, 229, 255, 0.62)",
            background: "rgba(8, 24, 35, 0.38)",
            boxShadow: "0 0 18px rgba(101, 229, 255, 0.5)",
          }}
          aria-hidden
        />
        <JarvisOrb size="sm" state={mapJarvisState(realtimeState)} />
      </button>
      {realtimeState !== "idle" ? (
        <div
          className="pointer-events-none absolute bottom-[78px] left-0 max-w-[280px] rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-5 text-[var(--text-secondary)] shadow-[0_18px_50px_rgba(0,0,0,0.45)] md:bottom-[76px]"
          style={{
            background: "rgba(5, 10, 19, 0.94)",
            borderColor: realtimeState === "error" ? "rgba(229, 72, 77, 0.5)" : "rgba(101, 229, 255, 0.28)",
          }}
        >
          {statusText}
        </div>
      ) : null}
    </div>
  );
}
