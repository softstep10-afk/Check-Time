export function canConfirmGpsConsent(agreed: boolean, signedName: string): boolean {
  return agreed && signedName.trim().length > 0;
}
