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

  const currentTokens = normalizedCurrent ? normalizedCurrent.split(" ") : [];
  const transcriptTokens = normalizedTranscript.split(" ");
  const cleanTranscriptTokens = cleanTranscript.split(" ");

  if (
    currentTokens.length > 0 &&
    transcriptTokens.length > currentTokens.length &&
    currentTokens.every((token, index) => transcriptTokens[index] === token)
  ) {
    return cleanTranscript;
  }

  const maxOverlap = Math.min(currentTokens.length, transcriptTokens.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const currentTail = currentTokens.slice(currentTokens.length - overlap);
    const transcriptHead = transcriptTokens.slice(0, overlap);
    if (currentTail.every((token, index) => transcriptHead[index] === token)) {
      const remainder = cleanTranscriptTokens.slice(overlap).join(" ");
      if (!remainder) return currentValue;
      return currentValue.trim() ? `${currentValue.trimEnd()} ${remainder}` : remainder;
    }
  }

  return currentValue.trim() ? `${currentValue.trimEnd()} ${cleanTranscript}` : cleanTranscript;
}
