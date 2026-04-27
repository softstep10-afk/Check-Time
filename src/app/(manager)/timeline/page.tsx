import Link from "next/link";
import { DateRangePresets } from "@/components/shared/DateRangePresets";
import { getTimelinePageData } from "@/lib/manager-data";
import { buildTimelineItems } from "@/lib/manager-utils";

export const revalidate = 30;
import { formatDateTime } from "@/lib/worker-utils";
import { getServerLocale, serverT } from "@/lib/i18n/server";

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function endOfDayPlusOne(isoDate: string): string {
  // Treat 'end' as inclusive — bump to the start of the next day so the
  // string compare against ISO timestamps catches everything on that day.
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function eventTypeLabel(
  eventType: string,
  t: (key: Parameters<typeof serverT>[1]) => string,
): string {
  switch (eventType) {
    case "clock_in":
      return t("timeline.clockIn");
    case "clock_out":
      return t("timeline.clockOut");
    case "auto_out":
      return t("timeline.autoOut");
    case "adjust":
      return t("timeline.adjust");
    case "break_start":
      return t("timeline.breakStart");
    case "break_end":
      return t("timeline.breakEnd");
    default:
      return eventType.replace(/_/g, " ");
  }
}

function videoStatusLabel(
  status: string | null | undefined,
  t: (key: Parameters<typeof serverT>[1]) => string,
): string | null {
  // not_required is the default — noise on the timeline, hide it.
  if (!status || status === "not_required") return null;
  switch (status) {
    case "pending":
      return t("timeline.videoPending");
    case "uploaded":
      return t("timeline.videoUploaded");
    case "verified":
      return t("timeline.videoVerified");
    default:
      return status;
  }
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const params = await searchParams;
  const worker = readParam(params.worker);
  const project = readParam(params.project);
  const type = readParam(params.type);
  const startRaw = readParam(params.start);
  const endRaw = readParam(params.end);
  const range = readParam(params.range);
  // Defensive: ignore garbage date params instead of crashing endOfDayPlusOne
  // or skewing string compares. Only YYYY-MM-DD is accepted.
  const start = isValidDateString(startRaw) ? startRaw : "";
  const end = isValidDateString(endRaw) ? endRaw : "";
  const endExclusive = end ? endOfDayPlusOne(end) : "";
  const hasFilters = Boolean(worker || project || type || start || end);
  const data = await getTimelinePageData();
  const timeline = buildTimelineItems(data).filter((item) => {
    if (worker && item.profile_id !== worker) {
      return false;
    }

    if (project && item.project_id !== project) {
      return false;
    }

    if (type && item.event_type !== type) {
      return false;
    }

    if (start && item.event_time < start) {
      return false;
    }

    if (endExclusive && item.event_time >= endExclusive) {
      return false;
    }

    return true;
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("timeline.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("timeline.subtitle")}
        </h1>
        <p className="max-w-[62ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("timeline.description")}
        </p>
      </section>

      <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <DateRangePresets defaultPreset="week" />
        <form className="grid gap-3 md:grid-cols-3 xl:grid-cols-4" method="GET">
          {/* Preserve the date range across worker/project/type filter
              submits — the form replaces all params on submit otherwise. */}
          {start ? <input type="hidden" name="start" value={start} /> : null}
          {end ? <input type="hidden" name="end" value={end} /> : null}
          {range ? <input type="hidden" name="range" value={range} /> : null}
          <select
            name="worker"
            defaultValue={worker}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("timeline.allWorkers")}</option>
            {data.profiles
              .filter((profile) => !profile.deleted_at)
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
          </select>
          <select
            name="project"
            defaultValue={project}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("timeline.allProjects")}</option>
            {data.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            name="type"
            defaultValue={type}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("timeline.allEventTypes")}</option>
            <option value="clock_in">{t("timeline.clockIn")}</option>
            <option value="clock_out">{t("timeline.clockOut")}</option>
            <option value="auto_out">{t("timeline.autoOut")}</option>
            <option value="adjust">{t("timeline.adjust")}</option>
            <option value="break_start">{t("timeline.breakStart")}</option>
            <option value="break_end">{t("timeline.breakEnd")}</option>
          </select>
          <button
            type="submit"
            className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
            style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
          >
            {t("common.filter")}
          </button>
        </form>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("timeline.events")}</h2>
          <div className="flex items-center gap-3">
            {hasFilters ? (
              <Link href="/timeline" className="text-sm font-semibold text-[var(--brand-yellow)]">
                {t("timeline.clearFilters")}
              </Link>
            ) : null}
            <div className="text-sm text-[var(--text-secondary)]">{timeline.length} {t("timeline.rows")}</div>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {timeline.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
              {t("timeline.noEvents")}
            </div>
          ) : (
            timeline.map((item) => (
              <div
                key={item.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {item.profileName} •{" "}
                      <Link href={`/projects/${item.project_id}`} className="text-[var(--brand-yellow)]">
                        {item.projectName}
                      </Link>
                    </div>
                    <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {eventTypeLabel(item.event_type, t)}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--text-secondary)]">
                    <div>{formatDateTime(item.event_time)}</div>
                    {videoStatusLabel(item.video_status, t) ? (
                      <div>{videoStatusLabel(item.video_status, t)}</div>
                    ) : null}
                  </div>
                </div>
                {item.notes ? (
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">{item.notes}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
