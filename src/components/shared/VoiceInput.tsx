"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { normalizeVoiceTranscript } from "@/lib/voice-transcript";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SAFETY_TIMEOUT_MS = 30_000;

function createRecognition(): any | null {
  if (typeof window === "undefined") return null;
  const SpeechRec =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  if (!SpeechRec) return null;
  return new SpeechRec();
}

function isSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

export function VoiceInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const { locale } = useTranslation();
  const supported = useSyncExternalStore(
    () => () => {},
    isSupported,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const emittedFinalsRef = useRef<Set<string>>(new Set());
  const lastFinalRef = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stopRecognition = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    // Stop if already listening
    if (listening) {
      stopRecognition();
      return;
    }

    const recognition = createRecognition();
    if (!recognition) {
      return;
    }

    const lang = locale === "ru" ? "ru-RU" : "en-US";
    emittedFinalsRef.current = new Set();
    lastFinalRef.current = null;
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      try {
        const results = event.results;
        const finalChunks: string[] = [];
        for (let i = event.resultIndex ?? 0; i < results.length; i++) {
          if (results[i].isFinal) {
            const transcript = String(results[i][0]?.transcript ?? "").trim();
            const key = normalizeVoiceTranscript(transcript);
            const now = Date.now();
            const recentDuplicate =
              lastFinalRef.current?.text === key && now - lastFinalRef.current.at < 4000;
            if (key && !emittedFinalsRef.current.has(key) && !recentDuplicate) {
              emittedFinalsRef.current.add(key);
              lastFinalRef.current = { text: key, at: now };
              finalChunks.push(transcript);
            }
          }
        }
        if (finalChunks.length > 0) {
          const finalText = finalChunks.join(" ").trim();
          onTranscriptRef.current(finalText);
        }
      } catch (err) {
        console.warn(
          "[VoiceInput] transcript extraction failed:",
          err instanceof Error ? err.name : "unknown",
        );
      }
    };

    recognition.onend = () => {
      // With continuous=true the browser may fire onend on its own
      // (e.g. network hiccup). Clean up state so the button resets.
      recognitionRef.current = null;
      setListening(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    recognition.onerror = (event: any) => {
      const errorType = event?.error ?? "unknown";
      // "no-speech" is normal — user just didn't say anything yet, not a real error
      if (errorType === "no-speech") return;
      if (errorType === "not-allowed" || errorType === "service-not-allowed") {
        alert(
          locale === "ru"
            ? "Доступ к микрофону заблокирован. Разрешите доступ в настройках браузера."
            : "Microphone access blocked. Allow microphone access in browser settings.",
        );
      }
      stopRecognition();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);

      // Safety timeout: auto-stop after 30 seconds
      timeoutRef.current = setTimeout(() => {
        stopRecognition();
      }, SAFETY_TIMEOUT_MS);
    } catch (err) {
      console.warn(
        "[VoiceInput] start failed:",
        err instanceof Error ? err.name : "unknown",
      );
      recognitionRef.current = null;
    }
  }, [listening, locale, stopRecognition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors"
      style={{
        background: listening ? "rgba(212, 81, 94, 0.22)" : "transparent",
        color: listening ? "var(--red)" : "var(--text-muted)",
      }}
      aria-label={listening ? "Stop listening" : "Voice input"}
    >
      {listening ? (
        <MicOff size={13} className="animate-pulse" />
      ) : (
        <Mic size={13} />
      )}
    </button>
  );
}
