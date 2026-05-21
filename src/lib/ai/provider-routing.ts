export type JarvisRouteCategory =
  | "fast_command"
  | "general_chat"
  | "operations_reasoning"
  | "project_summary"
  | "document_or_media_analysis"
  | "voice_response"
  | "fallback";

export type JarvisProviderId =
  | "jarvis_deterministic"
  | "gemini"
  | "openai"
  | "anthropic"
  | "google_tts"
  | "none";

export type JarvisRoutingMode = "cheapest" | "balanced" | "best_quality";
export type JarvisCostTier = "free_app_logic" | "low" | "medium" | "high";

export type JarvisRouteModel = {
  provider: JarvisProviderId;
  model: string;
};

export type JarvisRouteConfig = {
  category: JarvisRouteCategory;
  label: string;
  preferred: JarvisRouteModel;
  fallbacks: JarvisRouteModel[];
  maxLatencyMs: number;
  costTier: JarvisCostTier;
  toolGenerationAllowed: boolean;
  ownerConfirmationRequired: boolean;
  notes: string;
};

export type JarvisProviderStatus = {
  provider: JarvisProviderId;
  label: string;
  configured: boolean;
  executable: boolean;
  model: string;
  notes: string;
};

export type JarvisResolvedRoute = JarvisRouteConfig & {
  selected: JarvisRouteModel;
  fallbackOrder: JarvisRouteModel[];
  providerStatuses: JarvisProviderStatus[];
  fallbackUsed: boolean;
  warning: string | null;
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_GOOGLE_TTS_MODEL = "Google Cloud TTS";

function hasAnyEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]));
}

export function getJarvisRoutingMode(env: NodeJS.ProcessEnv = process.env): JarvisRoutingMode {
  const value = env.JARVIS_ROUTING_MODE;
  return value === "cheapest" || value === "best_quality" ? value : "balanced";
}

export function getJarvisProviderStatuses(
  env: NodeJS.ProcessEnv = process.env,
): JarvisProviderStatus[] {
  const geminiModel = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const openAiModel = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const anthropicModel = env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;

  return [
    {
      provider: "jarvis_deterministic",
      label: "Jarvis deterministic parser",
      configured: true,
      executable: true,
      model: "app-code fast path",
      notes: "Used first for simple operational commands before any model call.",
    },
    {
      provider: "gemini",
      label: "Gemini",
      configured: hasAnyEnv(env, [
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_AI_API_KEY",
      ]),
      executable: true,
      model: geminiModel,
      notes: "Primary multimodal JSON-capable Jarvis route in this app build.",
    },
    {
      provider: "openai",
      label: "OpenAI",
      configured: hasAnyEnv(env, ["OPENAI_API_KEY"]),
      executable: true,
      model: openAiModel,
      notes: "Fast text fallback route for owner-side chat and summaries.",
    },
    {
      provider: "anthropic",
      label: "Anthropic",
      configured: hasAnyEnv(env, ["ANTHROPIC_API_KEY"]),
      executable: true,
      model: anthropicModel,
      notes: "Deep reasoning route for longer operational analysis when configured.",
    },
    {
      provider: "google_tts",
      label: "Google TTS",
      configured: hasAnyEnv(env, [
        "GOOGLE_CLOUD_CREDENTIALS",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ]),
      executable: true,
      model: DEFAULT_GOOGLE_TTS_MODEL,
      notes: "Voice synthesis only. It never generates write actions.",
    },
  ];
}

function model(provider: JarvisProviderId, modelName: string): JarvisRouteModel {
  return { provider, model: modelName };
}

export function getJarvisRouteConfigs(
  env: NodeJS.ProcessEnv = process.env,
  mode: JarvisRoutingMode = getJarvisRoutingMode(env),
): JarvisRouteConfig[] {
  const geminiModel = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const openAiModel = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const anthropicModel = env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const preferQuality = mode === "best_quality";
  const preferCheap = mode === "cheapest";

  return [
    {
      category: "fast_command",
      label: "Fast command / Быстрая команда",
      preferred: model("jarvis_deterministic", "app-code fast path"),
      fallbacks: [model("gemini", geminiModel), model("openai", openAiModel)],
      maxLatencyMs: 900,
      costTier: "free_app_logic",
      toolGenerationAllowed: true,
      ownerConfirmationRequired: true,
      notes: "Task/message/project intent extraction should stay deterministic when safe.",
    },
    {
      category: "general_chat",
      label: "General chat / Общий разговор",
      preferred: model(preferCheap ? "gemini" : "openai", preferCheap ? geminiModel : openAiModel),
      fallbacks: [model("gemini", geminiModel), model("openai", openAiModel)],
      maxLatencyMs: 2400,
      costTier: preferCheap ? "low" : "medium",
      toolGenerationAllowed: false,
      ownerConfirmationRequired: true,
      notes: "Short app-grounded answers and follow-up conversation.",
    },
    {
      category: "operations_reasoning",
      label: "Operations reasoning / Операционный анализ",
      preferred: model(preferCheap ? "gemini" : "anthropic", preferCheap ? geminiModel : anthropicModel),
      fallbacks: [
        model("anthropic", anthropicModel),
        model("gemini", geminiModel),
        model("openai", openAiModel),
      ],
      maxLatencyMs: 6000,
      costTier: preferCheap ? "medium" : preferQuality ? "high" : "medium",
      toolGenerationAllowed: false,
      ownerConfirmationRequired: true,
      notes: "Company/project analysis, dispatch reasoning, and longer owner questions.",
    },
    {
      category: "project_summary",
      label: "Project summary / Сводка проекта",
      preferred: model("gemini", geminiModel),
      fallbacks: [model("openai", openAiModel), model("anthropic", anthropicModel)],
      maxLatencyMs: 4200,
      costTier: "medium",
      toolGenerationAllowed: false,
      ownerConfirmationRequired: true,
      notes: "Daily reports, project summaries, and operational status snapshots.",
    },
    {
      category: "document_or_media_analysis",
      label: "Document/media analysis / Документы и медиа",
      preferred: model("gemini", geminiModel),
      fallbacks: [model("openai", openAiModel), model("anthropic", anthropicModel)],
      maxLatencyMs: 6500,
      costTier: "medium",
      toolGenerationAllowed: false,
      ownerConfirmationRequired: true,
      notes: "Uses multimodal-capable route first; text-only providers are skipped for binary attachments.",
    },
    {
      category: "voice_response",
      label: "Voice response / Голосовой ответ",
      preferred: model("google_tts", DEFAULT_GOOGLE_TTS_MODEL),
      fallbacks: [model("none", "text-only Jarvis response")],
      maxLatencyMs: 2200,
      costTier: "low",
      toolGenerationAllowed: false,
      ownerConfirmationRequired: true,
      notes: "Speech output only; write actions still require owner confirmation.",
    },
    {
      category: "fallback",
      label: "Fallback / Резерв",
      preferred: model("gemini", geminiModel),
      fallbacks: [model("openai", openAiModel), model("anthropic", anthropicModel)],
      maxLatencyMs: 3200,
      costTier: "low",
      toolGenerationAllowed: false,
      ownerConfirmationRequired: true,
      notes: "Last safe model route before Jarvis returns a branded unavailable message.",
    },
  ];
}

function isConfigured(provider: JarvisProviderId, statuses: JarvisProviderStatus[]): boolean {
  if (provider === "none") return true;
  const status = statuses.find((item) => item.provider === provider);
  return Boolean(status?.configured && status.executable);
}

export function resolveJarvisRoute(
  category: JarvisRouteCategory,
  options: {
    env?: NodeJS.ProcessEnv;
    mode?: JarvisRoutingMode;
    hasBinaryAttachments?: boolean;
  } = {},
): JarvisResolvedRoute {
  const env = options.env ?? process.env;
  const mode = options.mode ?? getJarvisRoutingMode(env);
  const statuses = getJarvisProviderStatuses(env);
  const config =
    getJarvisRouteConfigs(env, mode).find((item) => item.category === category) ??
    getJarvisRouteConfigs(env, mode).find((item) => item.category === "fallback")!;

  const seenProviders = new Set<JarvisProviderId>();
  const candidates = [config.preferred, ...config.fallbacks].filter((candidate) => {
    if (seenProviders.has(candidate.provider)) return false;
    seenProviders.add(candidate.provider);
    if (
      options.hasBinaryAttachments &&
      (candidate.provider === "openai" || candidate.provider === "anthropic")
    ) {
      return false;
    }
    return isConfigured(candidate.provider, statuses);
  });
  const selected = candidates[0] ?? model("none", "no configured Jarvis provider");

  return {
    ...config,
    selected,
    fallbackOrder: candidates.slice(1),
    providerStatuses: statuses,
    fallbackUsed: selected.provider !== config.preferred.provider,
    warning:
      selected.provider === "none"
        ? "No configured Jarvis provider is available for this route."
        : config.preferred.provider !== selected.provider
          ? "Preferred provider is not configured or not safe for this request; Jarvis selected a fallback."
          : null,
  };
}

export function formatJarvisRouteModel(value: JarvisRouteModel): string {
  if (value.provider === "none") return value.model;
  if (value.provider === "jarvis_deterministic") return value.model;
  return `${value.provider}:${value.model}`;
}

export function getJarvisRoutingDiagnostics(env: NodeJS.ProcessEnv = process.env): Array<{
  label: string;
  value: string;
}> {
  const mode = getJarvisRoutingMode(env);
  const routes = getJarvisRouteConfigs(env, mode);
  const statuses = getJarvisProviderStatuses(env);

  return [
    { label: "Routing mode / Режим маршрутизации", value: mode },
    ...statuses.map((status) => ({
      label: `${status.label} / ${status.model}`,
      value: status.configured ? "configured" : "not configured",
    })),
    ...routes.map((route) => {
      const resolved = resolveJarvisRoute(route.category, { env, mode });
      return {
        label: route.label,
        value: `${formatJarvisRouteModel(resolved.selected)}${
          resolved.fallbackOrder.length > 0
            ? ` -> fallback ${resolved.fallbackOrder.map(formatJarvisRouteModel).join(" -> ")}`
            : ""
        }`,
      };
    }),
  ];
}
