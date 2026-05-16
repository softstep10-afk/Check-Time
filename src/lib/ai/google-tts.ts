import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import {
  DEFAULT_GOOGLE_TTS_LANGUAGE,
  DEFAULT_GOOGLE_TTS_PITCH,
  DEFAULT_GOOGLE_TTS_SPEAKING_RATE,
  DEFAULT_GOOGLE_TTS_VOICE,
} from "@/lib/ai/jarvis-voice";

type GoogleCredentials = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

let cachedClient: TextToSpeechClient | null = null;

function readInlineCredentials(): GoogleCredentials | null {
  const raw =
    process.env.GOOGLE_CLOUD_CREDENTIALS ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    null;

  if (!raw) return null;

  try {
    const trimmed = raw.trim();
    const jsonText = trimmed.startsWith("{")
      ? trimmed
      : Buffer.from(trimmed, "base64").toString("utf8");
    const parsed = JSON.parse(jsonText) as Partial<GoogleCredentials>;
    if (!parsed.client_email || !parsed.private_key) return null;

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      project_id: parsed.project_id,
    };
  } catch {
    return null;
  }
}

function getTextToSpeechClient(): TextToSpeechClient {
  if (cachedClient) return cachedClient;

  const credentials = readInlineCredentials();
  cachedClient = credentials
    ? new TextToSpeechClient({
        projectId: credentials.project_id,
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      })
    : new TextToSpeechClient();

  return cachedClient;
}

export function hasGoogleTtsCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_CREDENTIALS ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
  );
}

export async function synthesizeJarvisSpeech(text: string): Promise<{
  base64: string;
  mimeType: "audio/mpeg";
  voiceName: string;
}> {
  const voiceName = process.env.GOOGLE_TTS_VOICE || DEFAULT_GOOGLE_TTS_VOICE;
  const languageCode = process.env.GOOGLE_TTS_LANGUAGE || DEFAULT_GOOGLE_TTS_LANGUAGE;
  const speakingRate = Number(process.env.GOOGLE_TTS_SPEAKING_RATE || DEFAULT_GOOGLE_TTS_SPEAKING_RATE);
  const pitch = Number(process.env.GOOGLE_TTS_PITCH || DEFAULT_GOOGLE_TTS_PITCH);
  const client = getTextToSpeechClient();

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode,
      name: voiceName,
      ssmlGender: "MALE",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: Number.isFinite(speakingRate) ? speakingRate : DEFAULT_GOOGLE_TTS_SPEAKING_RATE,
      pitch: Number.isFinite(pitch) ? pitch : DEFAULT_GOOGLE_TTS_PITCH,
    },
  });

  if (!response.audioContent) {
    throw new Error("Google TTS returned no audio.");
  }

  const buffer = Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent);

  return {
    base64: buffer.toString("base64"),
    mimeType: "audio/mpeg",
    voiceName,
  };
}
