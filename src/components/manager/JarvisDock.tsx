"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { JarvisOrb, type JarvisOrbState } from "@/components/shared/JarvisOrb";
import { useTranslation } from "@/lib/i18n";
import type { AssistantConversationTurn } from "@/lib/ai/types";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";
type DockPosition = { x: number; y: number };
type SpeechAlternativeLike = { transcript?: string };
type SpeechResultLike = {
  isFinal?: boolean;
  length: number;
  [index: number]: SpeechAlternativeLike;
};
type SpeechResultsLike = {
  length: number;
  [index: number]: SpeechResultLike;
};
type BrowserSpeechRecognitionEvent = Event & { results: SpeechResultsLike };
type BrowserSpeechRecognitionErrorEvent = Event & { error?: string };
type BrowserSpeechRecognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type VoiceApiResponse = {
  ok?: boolean;
  assistant?: {
    answer?: string;
    bullets?: string[];
  };
  audio?: {
    base64?: string;
    mimeType?: string;
  } | null;
  audioError?: string | null;
  error?: string;
};

const DOCK_POSITION_KEY = "check-time.jarvisDock.position";
const DOCK_MARGIN = 10;
const MIN_LISTENING_VISIBLE_MS = 450;

function isVoiceActive(state: VoiceState): boolean {
  return state === "listening" || state === "thinking" || state === "speaking";
}

function mapJarvisState(state: VoiceState): JarvisOrbState {
  if (state === "error") return "error";
  if (state === "speaking") return "speaking";
  if (state === "thinking") return "thinking";
  if (state === "listening") return "listening";
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

function extractTranscript(results: SpeechResultsLike): string {
  const pieces: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result) continue;
    const alternative = result[0];
    const transcript = alternative?.transcript?.trim();
    if (transcript) pieces.push(transcript);
  }
  return pieces.join(" ").trim();
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function getSpeechLanguage(): string {
  const browserLanguage = navigator.language || "";
  if (browserLanguage.toLowerCase().startsWith("en")) return "en-US";
  return "ru-RU";
}

export function JarvisDock() {
  const { t } = useTranslation();
  const dockRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceStateRef = useRef<VoiceState>("idle");
  const voiceAttemptRef = useRef(0);
  const voiceHistoryRef = useRef<AssistantConversationTurn[]>([]);
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
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [dockPosition, setDockPosition] = useState<DockPosition>({ x: 16, y: 420 });
  const [positionReady, setPositionReady] = useState(false);

  const setVoiceStatus = useCallback((state: VoiceState, message = "") => {
    voiceStateRef.current = state;
    setVoiceState(state);
    setVoiceMessage(message);
  }, []);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (audioUrlRef.current) {
      window.URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopVoice = useCallback((nextState: VoiceState = "idle", nextMessage = "") => {
    voiceAttemptRef.current += 1;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopAudio();
    setVoiceStatus(nextState, nextMessage);
  }, [setVoiceStatus, stopAudio]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
  }, []);

  useEffect(() => {
    dockPositionRef.current = dockPosition;
  }, [dockPosition]);

  useEffect(() => {
    function fitToViewport(position: DockPosition): DockPosition {
      const rect = dockRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 74;
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
      // Dragging still works for this session if localStorage is unavailable.
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
    const width = rect?.width ?? 74;
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
    if (isVoiceActive(voiceStateRef.current)) {
      stopVoice();
      return;
    }
    startVoice();
  }

  function startVoice() {
    if (isVoiceActive(voiceStateRef.current)) return;
    if (typeof window === "undefined") return;

    const speechWindow = window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognitionConstructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      setVoiceStatus("error", t("jarvisDock.voiceUnsupported"));
      return;
    }

    stopAudio();
    const attempt = voiceAttemptRef.current + 1;
    voiceAttemptRef.current = attempt;
    const startedAt = performance.now();
    const recognition = new SpeechRecognitionConstructor();
    recognitionRef.current = recognition;
    recognition.lang = getSpeechLanguage();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setVoiceStatus("listening", t("jarvisDock.voiceConnecting"));

    recognition.onresult = (event) => {
      const transcript = extractTranscript(event.results);
      if (!transcript || voiceAttemptRef.current !== attempt) return;
      recognitionRef.current = null;
      setVoiceStatus("thinking", t("jarvisDock.voiceConnected"));
      void completeVoiceRequest(transcript, attempt, startedAt);
    };

    recognition.onerror = (event) => {
      if (voiceAttemptRef.current !== attempt) return;
      recognitionRef.current = null;
      const error = event.error ? `${t("jarvisDock.voiceFailed")} ${event.error}` : t("jarvisDock.voiceFailed");
      stopVoice("error", error);
    };

    recognition.onend = () => {
      if (voiceAttemptRef.current !== attempt) return;
      recognitionRef.current = null;
      if (voiceStateRef.current === "listening") {
        setVoiceStatus("idle");
      }
    };

    try {
      recognition.start();
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t("jarvisDock.voiceFailed");
      stopVoice("error", message);
    }
  }

  async function completeVoiceRequest(transcript: string, attempt: number, startedAt: number) {
    try {
      const elapsed = performance.now() - startedAt;
      if (elapsed < MIN_LISTENING_VISIBLE_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, MIN_LISTENING_VISIBLE_MS - elapsed));
      }
      if (voiceAttemptRef.current !== attempt) return;

      const response = await fetch("/api/ai/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          question: transcript,
          history: voiceHistoryRef.current.slice(-8),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || t("jarvisDock.voiceFailed"));
      }

      const assistantAnswer = payload.assistant?.answer?.trim() || "";
      if (assistantAnswer) {
        const nextHistory: AssistantConversationTurn[] = voiceHistoryRef.current.slice(-8);
        nextHistory.push(
          { role: "user", text: transcript },
          { role: "assistant", text: assistantAnswer },
        );
        voiceHistoryRef.current = nextHistory.slice(-10);
      }

      const audioBase64 = payload.audio?.base64;
      if (!audioBase64) {
        throw new Error(payload.audioError || t("jarvisDock.voiceNeedsKey"));
      }

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      stopAudio();
      const blob = base64ToBlob(audioBase64, payload.audio?.mimeType || "audio/mpeg");
      const url = window.URL.createObjectURL(blob);
      audioUrlRef.current = url;
      audio.src = url;
      audio.onended = () => {
        if (voiceAttemptRef.current === attempt) {
          stopAudio();
          setVoiceStatus("idle");
        }
      };
      audio.onerror = () => {
        if (voiceAttemptRef.current === attempt) {
          stopVoice("error", t("jarvisDock.voiceFailed"));
        }
      };
      setVoiceStatus("speaking", t("jarvisDock.voiceSpeaking"));
      await audio.play();
    } catch (error) {
      if (voiceAttemptRef.current !== attempt) return;
      const text = error instanceof Error && error.message ? error.message : t("jarvisDock.voiceFailed");
      stopVoice("error", text);
    }
  }

  const active = isVoiceActive(voiceState);
  const label = active ? t("jarvisDock.voiceStop") : t("jarvisDock.voiceStart");
  const statusText = voiceMessage || (active ? t("jarvisDock.voiceConnected") : "Jarvis");

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
        className="jarvis-dock-orb-button group relative flex h-[68px] w-[68px] cursor-grab items-center justify-center rounded-full border transition hover:scale-[1.04] active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ai-cyan-bright)]"
        data-voice-state={voiceState}
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
        <JarvisOrb size="sm" state={mapJarvisState(voiceState)} />
      </button>
      {voiceState !== "idle" ? (
        <div
          className="pointer-events-none absolute bottom-[78px] left-0 max-w-[280px] rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-5 text-[var(--text-secondary)] shadow-[0_18px_50px_rgba(0,0,0,0.45)] md:bottom-[76px]"
          style={{
            background: "rgba(5, 10, 19, 0.94)",
            borderColor: voiceState === "error" ? "rgba(229, 72, 77, 0.5)" : "rgba(101, 229, 255, 0.28)",
          }}
        >
          {statusText}
        </div>
      ) : null}
    </div>
  );
}
