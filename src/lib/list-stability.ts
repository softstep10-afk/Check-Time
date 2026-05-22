export function areListsEqualByFingerprint<T>(
  current: readonly T[],
  next: readonly T[],
  fingerprint: (item: T) => string,
): boolean {
  if (current.length !== next.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (fingerprint(current[index]) !== fingerprint(next[index])) {
      return false;
    }
  }
  return true;
}

export function keepStableListIfUnchanged<T>(
  current: T[],
  next: T[],
  fingerprint: (item: T) => string,
): T[] {
  return areListsEqualByFingerprint(current, next, fingerprint) ? current : next;
}
