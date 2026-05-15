# Jarvis AI Setup

Jarvis has two layers:

1. Fallback mode: no paid model required. It can answer from the app snapshot, saved rules, skills, tasks, payroll summaries, media metadata, and Washington-code reference snippets that are already loaded by the app.
2. Model mode: requires an API key. It sends the same app snapshot to the model and can inspect attached images directly.

## Environment

Set these in Vercel Project Settings -> Environment Variables and redeploy:

```txt
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REALTIME_MODEL=gpt-realtime-mini
OPENAI_REALTIME_VOICE=marin
```

`OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE` are optional for normal chat, but needed for the future live voice mode. The app keeps the OpenAI key server-side and exposes only short-lived realtime client secrets from `/api/ai/realtime/token`.

Anthropic is still supported as a fallback for older routes:

```txt
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=...
```

Jarvis chat now prefers OpenAI first because image attachments use the Responses API multimodal input format.

## What Jarvis Can Read

- active and archived project summaries available to the manager data loader;
- workers, roles, skills, assignments, on-site state, and task counts;
- open tasks, priorities, inferred required skills, and candidate crew matches;
- payroll and unpaid balances only when the logged-in user has finance access;
- recent media metadata and saved AI analysis/tags;
- saved owner rules from organization settings;
- attached text files and supported images: PNG, JPEG, WebP, GIF.

## Safety Rules

- Non-finance managers should never receive payroll, rates, receipt totals, costs, unpaid balances, profit, or finance summaries.
- If the supplied app snapshot does not contain a fact, Jarvis must say it is not recorded.
- Washington code answers are guidance/checklists only. The permit set, city/county, and AHJ inspector stay final.
- Images are only visually inspected when OpenAI model mode is configured. Without it, Jarvis sees filename/type only.

## Manual Smoke Test

1. Open any manager page and click the Jarvis button.
2. Ask: `what requires my attention right now?`
3. Attach a small JPG/PNG and ask what is visible in it.
4. Ask: `remember: Vasia needs supervisor review before tile work`.
5. Ask: `what do you remember from my rules?`
6. Ask: `who is best for frame work on Home?`
7. Open a non-finance manager account and ask about payroll; it should refuse financial details.
