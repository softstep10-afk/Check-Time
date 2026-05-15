"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Mic, MicOff } from "lucide-react";
import { JarvisOrb, type JarvisOrbState } from "@/components/shared/JarvisOrb";
import { useTranslation } from "@/lib/i18n";

type RealtimeState = "idle" | "connecting" | "connected" | "speaking" | "error";
type DockPosition = { x: number; y: number };

const DOCK_POSITION_KEY = "check-time.jarvisDock.position";
const DOCK_MARGIN = 10;

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

export function JarvisDock() {
  const { t } = useTranslation();
  const dockRef = useRef<HTMLDivElement | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
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
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("idle");
  const [realtimeMessage, setRealtimeMessage] = useState("");
  const [dockPosition, setDockPosition] = useState<DockPosition>({ x: 16, y: 420 });
  const [positionReady, setPositionReady] = useState(false);

  const stopRealtime = useCallback((nextState: RealtimeState = "idle", nextMessage = "") => {
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
    setRealtimeState(nextState);
    setRealtimeMessage(nextMessage);
  }, []);

  useEffect(() => () => stopRealtime(), [stopRealtime]);

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
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
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
    }
  }

  function handleDockClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    void startRealtime();
  }

  async function startRealtime() {
    if (isVoiceActive(realtimeState)) {
      stopRealtime();
      return;
    }
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setRealtimeState("error");
      setRealtimeMessage(t("jarvisDock.voiceUnsupported"));
      return;
    }

    setRealtimeState("connecting");
    setRealtimeMessage(t("jarvisDock.voiceConnecting"));
    try {
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

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      realtimeStreamRef.current = stream;
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
      }

      const channel = peer.createDataChannel("oai-events");
      realtimeChannelRef.current = channel;
      channel.onopen = () => {
        setRealtimeState("connected");
        setRealtimeMessage(t("jarvisDock.voiceConnected"));
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
        if (typeof event.data !== "string") return;
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "response.audio.delta" || payload.type === "response.output_audio.delta") {
            setRealtimeState("speaking");
          }
          if (
            payload.type === "response.done" ||
            payload.type === "response.audio.done" ||
            payload.type === "output_audio_buffer.stopped" ||
            payload.type === "input_audio_buffer.speech_started"
          ) {
            setRealtimeState("connected");
          }
        } catch {
          // Realtime occasionally emits transport messages we do not need for UI state.
        }
      };
      channel.onclose = () => {
        if (realtimePeerRef.current) {
          stopRealtime();
        }
      };
      channel.onerror = () => {
        stopRealtime("error", t("jarvisDock.voiceFailed"));
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      const sdpResponse = await fetch("/api/ai/realtime/connect", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp ?? "",
        cache: "no-store",
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (!sdpResponse.ok) {
        const contentType = sdpResponse.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await sdpResponse.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? t("jarvisDock.voiceFailed"));
        }
        throw new Error(await sdpResponse.text());
      }
      const answer = await sdpResponse.text();
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
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
    >
      <button
        type="button"
        onClick={handleDockClick}
        className="group relative flex h-[68px] w-[68px] cursor-grab items-center justify-center rounded-full border transition hover:scale-[1.04] active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ai-cyan-bright)]"
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
      <button
        type="button"
        onClick={handleDockClick}
        className="hidden cursor-grab rounded-[var(--radius-pill)] border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition active:cursor-grabbing md:flex md:items-center md:gap-2"
        style={{
          background:
            realtimeState === "error"
              ? "linear-gradient(135deg, rgba(30, 8, 14, 0.94), rgba(9, 14, 22, 0.92))"
              : "linear-gradient(135deg, rgba(9, 17, 28, 0.94), rgba(6, 12, 20, 0.9))",
          borderColor:
            realtimeState === "error"
              ? "rgba(229, 72, 77, 0.5)"
              : active
                ? "rgba(185, 248, 255, 0.62)"
                : "rgba(130, 240, 255, 0.38)",
          boxShadow:
            realtimeState === "error"
              ? "0 0 28px rgba(229, 72, 77, 0.16)"
              : "0 0 0 1px rgba(255,255,255,0.05) inset, 0 0 24px rgba(91, 231, 255, 0.18)",
          color: active ? "rgba(224, 252, 255, 0.98)" : "rgba(218, 241, 247, 0.94)",
        }}
        aria-label={label}
        title={statusText}
      >
        {active ? (
          <MicOff size={13} className={realtimeState === "error" ? "text-[var(--danger)]" : "text-[var(--ai-cyan-bright)]"} />
        ) : (
          <Mic size={13} className="text-[var(--ai-cyan-bright)]" />
        )}
        {active ? t("jarvisDock.voiceStop") : "Jarvis"}
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
