export interface WashingtonCodeReference {
  topic: string;
  summary: string;
  sourceLabel: string;
  url: string;
  keywords: string[];
}

export const WASHINGTON_CODE_REFERENCES: WashingtonCodeReference[] = [
  {
    topic: "Washington State Building Code",
    summary:
      "Start with the Washington State Building Code Council code pages, then confirm the exact adopted code and local amendments with the city/county AHJ before field direction or estimating.",
    sourceLabel: "Washington State Building Code Council",
    url: "https://sbcc.wa.gov/state-codes-regulations-guidelines/state-building-code",
    keywords: ["building code", "permit", "inspection", "ahj", "code", "ibc", "irc", "строительный код", "разрешение", "инспекция"],
  },
  {
    topic: "WAC Title 51",
    summary:
      "Washington amendments to adopted building codes live under WAC Title 51. Use this as the legal source for chapter-level code lookups.",
    sourceLabel: "Washington State Legislature - WAC Title 51",
    url: "https://app.leg.wa.gov/WAC/default.aspx?cite=51",
    keywords: ["wac 51", "title 51", "state building code", "washington amendment", "поправки", "код штата"],
  },
  {
    topic: "Construction Safety",
    summary:
      "Construction safety rules are under Washington DOSH/L&I, especially WAC 296-155 for construction work. Fall protection may also require WAC 296-880 review.",
    sourceLabel: "Washington L&I construction safety rules",
    url: "https://www.lni.wa.gov/safety-health/safety-rules/rules-by-chapter/?chapter=155",
    keywords: ["safety", "fall protection", "ladder", "scaffold", "ppe", "wac 296-155", "wac 296-880", "безопасность", "лестница", "лес", "страховка"],
  },
  {
    topic: "Washington Energy Code",
    summary:
      "Energy-code questions should be checked against the Washington State Energy Code pages and the project jurisdiction's permit notes.",
    sourceLabel: "Washington State Building Code Council - Energy Code",
    url: "https://sbcc.wa.gov/state-codes-regulations-guidelines/state-building-code/energy-code",
    keywords: ["energy code", "insulation", "air sealing", "wsec", "mechanical", "энергокод", "изоляция", "утепление"],
  },
  {
    topic: "Local AHJ",
    summary:
      "Seattle, Tacoma, King County, Pierce County, and other jurisdictions can add local requirements. Treat Jarvis as a checklist builder, not the final inspector.",
    sourceLabel: "Local authority having jurisdiction",
    url: "https://sbcc.wa.gov/state-codes-regulations-guidelines/state-building-code",
    keywords: ["seattle", "tacoma", "king county", "pierce county", "auburn", "local amendment", "jurisdiction", "город", "округ"],
  },
];

export function findWashingtonCodeReferences(question: string): WashingtonCodeReference[] {
  const normalized = question.toLowerCase();
  const matches = WASHINGTON_CODE_REFERENCES.filter((reference) =>
    reference.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );

  return matches.length > 0 ? matches : WASHINGTON_CODE_REFERENCES.slice(0, 3);
}
