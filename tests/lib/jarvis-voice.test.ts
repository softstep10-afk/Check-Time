import { describe, expect, it } from "vitest";
import {
  detectJarvisSpeechLocale,
  resolveJarvisVoiceSelection,
} from "@/lib/ai/jarvis-voice";

describe("Jarvis voice selection", () => {
  it("uses the app locale before text detection", () => {
    expect(detectJarvisSpeechLocale("Hello", "ru")).toBe("ru");
    expect(detectJarvisSpeechLocale("Привет", "en")).toBe("en");
  });

  it("uses British Google voice for English by default", () => {
    const voice = resolveJarvisVoiceSelection("Hello", { env: {} });

    expect(voice.languageCode).toBe("en-GB");
    expect(voice.voiceName).toBe("en-GB-Neural2-B");
    expect(voice.speakingRate).toBe(0.9);
    expect(voice.pitch).toBe(-3);
  });

  it("uses a Russian Google voice for Russian app mode", () => {
    const voice = resolveJarvisVoiceSelection("Hello", { locale: "ru", env: {} });

    expect(voice.languageCode).toBe("ru-RU");
    expect(voice.voiceName).toBe("ru-RU-Wavenet-D");
  });

  it("allows Russian voice env overrides without touching English settings", () => {
    const voice = resolveJarvisVoiceSelection("Привет", {
      env: {
        GOOGLE_TTS_LANGUAGE: "en-GB",
        GOOGLE_TTS_VOICE: "en-GB-Neural2-B",
        GOOGLE_TTS_RU_LANGUAGE: "ru-RU",
        GOOGLE_TTS_RU_VOICE: "ru-RU-Standard-D",
        GOOGLE_TTS_RU_SPEAKING_RATE: "0.85",
        GOOGLE_TTS_RU_PITCH: "-4",
      },
    });

    expect(voice.languageCode).toBe("ru-RU");
    expect(voice.voiceName).toBe("ru-RU-Standard-D");
    expect(voice.speakingRate).toBe(0.85);
    expect(voice.pitch).toBe(-4);
  });
});
