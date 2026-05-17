export const DEFAULT_GOOGLE_TTS_LANGUAGE = "en-GB";
export const DEFAULT_GOOGLE_TTS_VOICE = "en-GB-Neural2-B";
export const DEFAULT_GOOGLE_TTS_SPEAKING_RATE = 0.85;
export const DEFAULT_GOOGLE_TTS_PITCH = -6.0;
export const DEFAULT_GOOGLE_TTS_RU_LANGUAGE = "ru-RU";
export const DEFAULT_GOOGLE_TTS_RU_VOICE = "ru-RU-Neural2-D";
export const FALLBACK_GOOGLE_TTS_RU_VOICE = "ru-RU-Wavenet-D";
export const DEFAULT_GOOGLE_TTS_RU_SPEAKING_RATE = 0.85;
export const DEFAULT_GOOGLE_TTS_RU_PITCH = -6.0;

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
  "Voice identity: an original premium British AI assistant for an internal construction command app.",
  "Core persona: a classic hyper-competent British butler combined with an advanced operations supercomputer.",
  "Tone: formal, refined, calm, unflappable, and clinically precise.",
  "Audio direction: medium-low British male tone, smooth pacing, crisp consonants, and restrained authority.",
  "Delivery: concise and operational. Avoid theatrical drama, robotic monotone, exaggerated accent, and playful character acting.",
  "Do not imitate any real person, actor, celebrity, copyrighted movie character, Marvel, Iron Man, Tony Stark, MCU, J.A.R.V.I.S. as a character, or any movie/TV AI by name.",
  "Speak Russian when the owner speaks Russian. Switch to English only when the owner asks in English.",
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
