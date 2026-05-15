import type { Profile } from "@/types/database";

export interface ProfileSkillSettings {
  skills: string[];
  note: string;
}

export interface WorkerSkillMatch {
  profileId: string;
  name: string;
  role: Profile["role"];
  skills: string[];
  matchedSkills: string[];
  score: number;
  note: string;
}

type SkillAlias = {
  tag: string;
  keywords: string[];
};

const SKILL_ALIASES: SkillAlias[] = [
  { tag: "framing", keywords: ["frame", "framing", "framer", "каркас", "фрейм", "фреймер"] },
  { tag: "drywall", keywords: ["drywall", "sheetrock", "гипсокартон", "гкл"] },
  { tag: "mudding", keywords: ["mud", "mudding", "spackle", "шпаклев", "шпаклёв", "шпакл", "путти"] },
  { tag: "painting", keywords: ["paint", "painting", "краск", "покраск", "маляр"] },
  { tag: "tile", keywords: ["tile", "tiles", "плитк", "кафель"] },
  { tag: "flooring", keywords: ["floor", "flooring", "пол", "ламинат", "паркет"] },
  { tag: "plumbing", keywords: ["plumb", "plumbing", "pipe", "сантех", "труб"] },
  { tag: "electrical", keywords: ["electric", "wiring", "wire", "электр", "провод"] },
  { tag: "demo", keywords: ["demo", "demolition", "tear out", "демо", "демонтаж", "снос"] },
  { tag: "concrete", keywords: ["concrete", "cement", "бетон", "цемент"] },
  { tag: "roofing", keywords: ["roof", "roofing", "крыш", "кровл"] },
  { tag: "trim", keywords: ["trim", "baseboard", "molding", "плинтус", "молдинг"] },
  { tag: "finish", keywords: ["finish", "finishing", "отделк", "финиш"] },
  { tag: "cleanup", keywords: ["clean", "cleanup", "уборк", "мусор"] },
  { tag: "delivery", keywords: ["delivery", "deliver", "pickup", "достав", "привез", "забрать"] },
  { tag: "inspection", keywords: ["inspection", "inspect", "провер", "инспек"] },
  { tag: "driving", keywords: ["drive", "driver", "truck", "водит", "машин", "тракт"] },
  { tag: "sales", keywords: ["sales", "client", "estimate", "продаж", "клиент", "смет"] },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function unique(values: string[], limit = 20): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }

  return output;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(/[,;\n]/);
  }
  return [];
}

export function inferSkillTagsFromText(text: string): string[] {
  const normalized = normalizeToken(text);
  if (!normalized) return [];

  return SKILL_ALIASES
    .filter((alias) => alias.keywords.some((keyword) => normalized.includes(keyword)))
    .map((alias) => alias.tag);
}

export function parseSkillInput(text: string): string[] {
  const manual = text.split(/[,;\n]/).map((item) => item.trim());
  return unique([...manual, ...inferSkillTagsFromText(text)]);
}

export function readProfileSkillSettings(settings: unknown): ProfileSkillSettings {
  const record = asRecord(settings);
  const explicitSkills = [
    ...stringArray(record.worker_skills),
    ...stringArray(record.skills),
    ...stringArray(record.capabilities),
  ];
  const note =
    typeof record.worker_capabilities_note === "string"
      ? record.worker_capabilities_note.trim()
      : typeof record.capabilities_note === "string"
        ? record.capabilities_note.trim()
        : "";

  return {
    skills: unique([...explicitSkills, ...inferSkillTagsFromText(note)]),
    note,
  };
}

export function formatProfileSkillInput(settings: unknown): string {
  return readProfileSkillSettings(settings).skills.join(", ");
}

export function mergeProfileSkillSettings(
  settings: unknown,
  skillsText: string,
  note: string,
): Record<string, unknown> {
  const current = { ...asRecord(settings) };
  const skills = parseSkillInput(skillsText);
  const trimmedNote = note.trim().slice(0, 1200);

  return {
    ...current,
    worker_skills: skills,
    worker_capabilities_note: trimmedNote,
  };
}

export function scoreWorkerForSkills(
  profile: Pick<Profile, "id" | "name" | "role" | "settings">,
  requiredSkills: string[],
): WorkerSkillMatch {
  const skillSettings = readProfileSkillSettings(profile.settings);
  const skillSet = new Set(skillSettings.skills);
  const matchedSkills = requiredSkills.filter((skill) => skillSet.has(skill));
  const roleBoost =
    profile.role === "supervisor"
      ? 0.4
      : profile.role === "worker" || profile.role === "subcontractor"
        ? 0.25
        : profile.role === "driver" && requiredSkills.includes("delivery")
          ? 0.3
          : profile.role === "sales" && requiredSkills.includes("sales")
            ? 0.3
            : 0;

  return {
    profileId: profile.id,
    name: profile.name,
    role: profile.role,
    skills: skillSettings.skills,
    matchedSkills,
    score: matchedSkills.length + roleBoost,
    note: skillSettings.note,
  };
}
