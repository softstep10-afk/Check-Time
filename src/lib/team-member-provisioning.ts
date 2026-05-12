const SYNTHETIC_TEAM_EMAIL_DOMAIN = "checktime.app";

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
  if (email && email.includes("@")) return email;

  const slug = slugifyTeamMemberName(name) || "team-member";
  const suffix =
    uniqueId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) || "member";

  return `${slug}-${suffix}@${SYNTHETIC_TEAM_EMAIL_DOMAIN}`;
}
