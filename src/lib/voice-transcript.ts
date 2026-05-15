export function normalizeVoiceTranscript(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .toLowerCase();
}

export function appendVoiceTranscript(currentValue: string, transcript: string): string {
  const cleanTranscript = transcript.trim().replace(/\s+/g, " ");
  if (!cleanTranscript) return currentValue;

  const normalizedCurrent = normalizeVoiceTranscript(currentValue);
  const normalizedTranscript = normalizeVoiceTranscript(cleanTranscript);
  if (!normalizedTranscript) return currentValue;

  if (normalizedCurrent === normalizedTranscript || normalizedCurrent.endsWith(` ${normalizedTranscript}`)) {
    return currentValue;
  }

  return currentValue.trim() ? `${currentValue.trimEnd()} ${cleanTranscript}` : cleanTranscript;
}
