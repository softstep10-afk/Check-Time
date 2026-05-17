import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import {
  FALLBACK_GOOGLE_TTS_RU_VOICE,
  resolveJarvisVoiceSelection,
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
        fallback: true,
        projectId: credentials.project_id,
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      })
    : new TextToSpeechClient({ fallback: true });

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

export function getGoogleTtsCredentialDiagnostics(): {
  hasAnyCredentialEnv: boolean;
  hasFileCredentialEnv: boolean;
  hasInlineCredentialEnv: boolean;
  inlineCredentialsValid: boolean;
  projectIdPresent: boolean;
  clientEmailPresent: boolean;
} {
  const inlineCredentials = readInlineCredentials();
  return {
    hasAnyCredentialEnv: hasGoogleTtsCredentials(),
    hasFileCredentialEnv: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    hasInlineCredentialEnv: Boolean(
      process.env.GOOGLE_CLOUD_CREDENTIALS ||
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    ),
    inlineCredentialsValid: Boolean(inlineCredentials),
    projectIdPresent: Boolean(inlineCredentials?.project_id),
    clientEmailPresent: Boolean(inlineCredentials?.client_email),
  };
}

export async function synthesizeJarvisSpeech(
  text: string,
  options: { locale?: string | null } = {},
): Promise<{
  base64: string;
  mimeType: "audio/mpeg";
  voiceName: string;
  languageCode: string;
}> {
  const selection = resolveJarvisVoiceSelection(text, options);
  const client = getTextToSpeechClient();

  async function synthesizeWithVoice(voiceName: string) {
    return client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: selection.languageCode,
        name: voiceName,
        ssmlGender: "MALE",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: selection.speakingRate,
        pitch: selection.pitch,
      },
    });
  }

  let response;
  let voiceName = selection.voiceName;
  try {
    [response] = await synthesizeWithVoice(voiceName);
  } catch (error) {
    if (selection.locale !== "ru" || voiceName === FALLBACK_GOOGLE_TTS_RU_VOICE) {
      throw error;
    }

    voiceName = FALLBACK_GOOGLE_TTS_RU_VOICE;
    [response] = await synthesizeWithVoice(voiceName);
  }

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
    languageCode: selection.languageCode,
  };
}
