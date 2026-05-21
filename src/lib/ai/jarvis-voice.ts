export const DEFAULT_GOOGLE_TTS_LANGUAGE = "en-GB";
export const DEFAULT_GOOGLE_TTS_VOICE = "en-GB-Neural2-B";
export const DEFAULT_GOOGLE_TTS_SPEAKING_RATE = 1.0;
export const DEFAULT_GOOGLE_TTS_PITCH = -1.0;
export const DEFAULT_GOOGLE_TTS_RU_LANGUAGE = "ru-RU";
export const DEFAULT_GOOGLE_TTS_RU_VOICE = "ru-RU-Wavenet-D";
export const FALLBACK_GOOGLE_TTS_RU_VOICE = "ru-RU-Wavenet-D";
export const DEFAULT_GOOGLE_TTS_RU_SPEAKING_RATE = 1.0;
export const DEFAULT_GOOGLE_TTS_RU_PITCH = -1.0;

export type JarvisSpeechLocale = "en" | "ru";

export interface JarvisVoiceSelection {
  locale: JarvisSpeechLocale;
  languageCode: string;
  voiceName: string;
  speakingRate: number;
  pitch: number;
}

type JarvisVoiceEnv = Record<string, string | undefined>;

export const JARVIS_VOICE_PROFILE = [
  "Voice profile: refined British butler AI assistant for an internal construction command app.",
  "Delivery: calm, intelligent, composed, concise, and confident, with subtle synthetic processing.",
  "Do not imitate any specific actor, film character, or copyrighted voice.",
  "Speak in the language selected by the application unless the user requests otherwise.",
].join(" ");

export function detectJarvisSpeechLocale(text: string, requestedLocale?: string | null): JarvisSpeechLocale {
  if (requestedLocale === "ru" || requestedLocale === "en") return requestedLocale;
  return /[а-яё]/i.test(text) ? "ru" : "en";
}

export function resolveJarvisVoiceSelection(
  text: string,
  options: { locale?: string | null; env?: JarvisVoiceEnv } = {},
): JarvisVoiceSelection {
  const locale = detectJarvisSpeechLocale(text, options.locale);

  if (locale === "ru") {
    return {
      locale,
      languageCode: DEFAULT_GOOGLE_TTS_RU_LANGUAGE,
      voiceName: DEFAULT_GOOGLE_TTS_RU_VOICE,
      speakingRate: DEFAULT_GOOGLE_TTS_RU_SPEAKING_RATE,
      pitch: DEFAULT_GOOGLE_TTS_RU_PITCH,
    };
  }

  return {
    locale,
    languageCode: DEFAULT_GOOGLE_TTS_LANGUAGE,
    voiceName: DEFAULT_GOOGLE_TTS_VOICE,
    speakingRate: DEFAULT_GOOGLE_TTS_SPEAKING_RATE,
    pitch: DEFAULT_GOOGLE_TTS_PITCH,
  };
}
