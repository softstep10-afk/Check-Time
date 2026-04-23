"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

/**
 * Subscribes to public.time_events / public.tasks / public.media INSERTs
 * (the three tables feeding overview stats + event feed) and calls
 * router.refresh() when anything new arrives so the server-rendered
 * overview page picks up the change without the manager pressing
 * reload. Visible rendering is a small green dot next to the page
 * title that says "Live" while the realtime channel is SUBSCRIBED —
 * the dot fades to muted if the channel drops.
 *
 * Refreshes are coalesced to 1000ms so a burst of clock-in events
 * during a crew shift change doesn't hammer the server on every row.
 */
export function OverviewLiveIndicator() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function schedule() {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 1000);
    }

    const channel = supabase
      .channel("overview-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_events" },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        schedule,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "media" },
        schedule,
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: connected ? "var(--green)" : "var(--text-muted)" }}
      title={connected ? t("overview.realtimeConnected") : t("overview.realtimeOffline")}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background: connected ? "var(--green)" : "var(--text-muted)",
          boxShadow: connected ? "0 0 6px var(--green)" : undefined,
        }}
      />
      {connected ? t("overview.live") : t("overview.offline")}
    </span>
  );
}
