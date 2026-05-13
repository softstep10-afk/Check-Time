const SYNTHETIC_TEAM_EMAIL_DOMAIN = "checktime.app";
const PROVIDED_EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const TEAM_PASSCODE_PATTERN = /^[A-Za-z0-9]{4,12}$/;

export function slugifyTeamMemberName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export function buildTeamMemberEmail(
  rawEmail: string,
  name: string,
  uniqueId: string = crypto.randomUUID(),
): string {
  const email = rawEmail.trim().toLowerCase();
  if (email && PROVIDED_EMAIL_PATTERN.test(email)) return email;

  const slug = slugifyTeamMemberName(name) || "team-member";
  const suffix =
    uniqueId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) || "member";

  return `${slug}-${suffix}@${SYNTHETIC_TEAM_EMAIL_DOMAIN}`;
}

export function generateTeamMemberPin(random: () => number = Math.random): string {
  return String(Math.floor(1000 + random() * 9000));
}

export function isValidTeamPasscode(value: string): boolean {
  return TEAM_PASSCODE_PATTERN.test(value);
}
