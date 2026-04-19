"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  LogIn,
  LogOut,
  ShieldOff,
  ClipboardCheck,
  Play,
  CheckCircle2,
  Camera,
  SlidersHorizontal,
  Clock,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

let cachedNow = 0;
const tickListeners = new Set<() => void>();
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

function subscribeNowTick(callback: () => void): () => void {
  if (tickListeners.size === 0) {
    cachedNow = Date.now();
    tickIntervalId = setInterval(() => {
      cachedNow = Date.now();
      for (const listener of tickListeners) listener();
    }, 60_000);
  }
  tickListeners.add(callback);
  // Initial sync — caller will pick up the freshly-cached value on first read.
  callback();
  return () => {
    tickListeners.delete(callback);
    if (tickListeners.size === 0 && tickIntervalId !== null) {
      clearInterval(tickIntervalId);
      tickIntervalId = null;
    }
  };
}

function getNowSnapshot(): number {
  return cachedNow;
}

function getNowServerSnapshot(): number {
  return 0;
}

export type FeedEvent = {
  id: string;
  kind:
    | "clock_in"
    | "clock_out"
    | "force_checkout"
    | "task_assigned"
    | "task_started"
    | "task_completed"
    | "media_uploaded"
    | "adjust";
  actorName: string;
  actorId: string;
  description: string;
  projectName: string | null;
  projectId: string | null;
  timestamp: string;
  href: string | null;
};

const KIND_CONFIG: Record<
  FeedEvent["kind"],
  { translationKey: string; color: string; Icon: typeof LogIn }
> = {
  clock_in: { translationKey: "feed.clockIn", color: "var(--green)", Icon: LogIn },
  clock_out: { translationKey: "feed.clockOut", color: "var(--red)", Icon: LogOut },
  force_checkout: { translationKey: "feed.forceCheckout", color: "var(--red)", Icon: ShieldOff },
  task_assigned: { translationKey: "feed.taskAssigned", color: "var(--blue)", Icon: ClipboardCheck },
  task_started: { translationKey: "feed.taskStarted", color: "var(--blue)", Icon: Play },
  task_completed: { translationKey: "feed.taskCompleted", color: "var(--green)", Icon: CheckCircle2 },
  media_uploaded: { translationKey: "feed.mediaUploaded", color: "var(--brand-yellow)", Icon: Camera },
  adjust: { translationKey: "feed.adjust", color: "var(--text-muted)", Icon: SlidersHorizontal },
};

function formatRelative(iso: string, now: number): string {
  const diffMin = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (diffMin < 1) return "<1m";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  return `${Math.floor(diffMin / 1440)}d`;
}

function RelativeTime({ iso }: { iso: string }) {
  const now = useSyncExternalStore(
    subscribeNowTick,
    getNowSnapshot,
    getNowServerSnapshot,
  );

  const absolute = new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <span
      className="whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]"
      title={absolute}
      suppressHydrationWarning
    >
      {now === 0 ? "" : formatRelative(iso, now)}
    </span>
  );
}

export function EventFeed({ events }: { events: FeedEvent[] }) {
  const { t } = useTranslation();

  return (
    <div
      className="max-h-[480px] space-y-0.5 overflow-y-auto"
      style={{ scrollbarWidth: "thin" }}
    >
      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-[var(--text-secondary)]">
          <Clock size={24} className="text-[var(--text-muted)]" />
          <span className="text-sm">{t("feed.empty")}</span>
        </div>
      ) : (
        events.map((event) => {
          const config = KIND_CONFIG[event.kind];
          const { Icon } = config;
          const verb = t(config.translationKey as Parameters<typeof t>[0]);

          const inner = (
            <div
              className="flex items-start gap-2.5 rounded-[var(--radius-md)] px-3 py-2 transition-colors"
              style={{ background: "var(--bg-primary)" }}
            >
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ background: `color-mix(in srgb, ${config.color} 16%, transparent)` }}
              >
                <Icon size={12} style={{ color: config.color }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1 text-sm">
                  <span className="font-semibold text-[var(--text-primary)]">{event.actorName}</span>
                  <span className="text-[var(--text-secondary)]">{verb}</span>
                </div>
                {event.description ? (
                  <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                    {event.description}
                    {event.projectName ? ` — ${event.projectName}` : ""}
                  </div>
                ) : event.projectName ? (
                  <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                    {event.projectName}
                  </div>
                ) : null}
              </div>
              <RelativeTime iso={event.timestamp} />
            </div>
          );

          if (event.href) {
            return (
              <Link key={event.id} href={event.href} className="block hover:opacity-80">
                {inner}
              </Link>
            );
          }

          return <div key={event.id}>{inner}</div>;
        })
      )}
    </div>
  );
}
