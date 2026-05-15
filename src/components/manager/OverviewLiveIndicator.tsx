"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { isLiveRefreshBlocked } from "@/lib/client-interaction";

/**
 * Subscribes to public.time_events / public.tasks / public.media INSERTs
 * (the three tables feeding overview stats + event feed) and calls
 * router.refresh() when anything new arrives so the server-rendered
 * overview page picks up the change without the manager pressing
 * reload. Visible rendering is a small green dot next to the page
 * title that says "Live" while the realtime channel is SUBSCRIBED —
 * the dot fades to muted if the channel drops.
 *
 * Refreshes are coalesced so a burst of clock-in events
 * during a crew shift change doesn't hammer the server on every row.
 */
export function OverviewLiveIndicator() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWhileHiddenRef = useRef(false);
  const lastRefreshRef = useRef(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function schedule() {
      if (document.visibilityState !== "visible") {
        pendingWhileHiddenRef.current = true;
        return;
      }
      if (refreshTimerRef.current) return;
      if (isLiveRefreshBlocked()) {
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          schedule();
        }, 2500);
        return;
      }
      const elapsed = Date.now() - lastRefreshRef.current;
      const delay = Math.max(2200, 5000 - elapsed);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        lastRefreshRef.current = Date.now();
        startTransition(() => router.refresh());
      }, delay);
    }

    const channel = supabase
      .channel("overview-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_events" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "media" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "payroll_closures" }, schedule)
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible" || !pendingWhileHiddenRef.current) return;
      pendingWhileHiddenRef.current = false;
      schedule();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      pendingWhileHiddenRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [supabase, router, startTransition]);

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
