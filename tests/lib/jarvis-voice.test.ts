import { describe, expect, it } from "vitest";
import {
  detectJarvisSpeechLocale,
  JARVIS_VOICE_PROFILE,
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
    expect(voice.speakingRate).toBe(1);
    expect(voice.pitch).toBe(-1);
  });

  it("documents the refined butler AI voice direction without actor cloning", () => {
    expect(JARVIS_VOICE_PROFILE).toContain("refined British butler AI assistant");
    expect(JARVIS_VOICE_PROFILE).toContain("Do not imitate any specific actor");
  });

  it("uses a Russian Google voice for Russian app mode", () => {
    const voice = resolveJarvisVoiceSelection("Hello", { locale: "ru", env: {} });

    expect(voice.languageCode).toBe("ru-RU");
    expect(voice.voiceName).toBe("ru-RU-Wavenet-D");
    expect(voice.speakingRate).toBe(1);
    expect(voice.pitch).toBe(-1);
  });

  it("ignores voice env overrides for fixed voice settings", () => {
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
    expect(voice.voiceName).toBe("ru-RU-Wavenet-D");
    expect(voice.speakingRate).toBe(1);
    expect(voice.pitch).toBe(-1);
  });
});
