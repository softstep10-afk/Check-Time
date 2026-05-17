"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, LanguageSwitcher } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { isLiveRefreshBlocked } from "@/lib/client-interaction";
import { TopProgressBar } from "@/components/shared/TopProgressBar";
import { JarvisDock } from "@/components/manager/JarvisDock";
import { JarvisIcon, type JarvisIconName } from "@/components/shared/JarvisIcons";
import { JarvisOrb } from "@/components/shared/JarvisOrb";

type SidebarItem =
  | { section: string; sectionKey: TranslationKey; ownerOnly?: boolean }
  | { href: string; icon: JarvisIconName; label: string; labelKey: TranslationKey; ownerOnly?: boolean; financeOnly?: boolean };

const sidebarItems: SidebarItem[] = [
  { section: "Main", sectionKey: "manager.sectionMain" },
  { href: "/overview", icon: "overview", label: "Overview", labelKey: "manager.navOverview" },
  { href: "/command-center", icon: "command", label: "Command Center", labelKey: "manager.navCommandCenter" },
  { href: "/projects", icon: "projects", label: "Projects", labelKey: "manager.navProjects" },
  { href: "/team", icon: "team", label: "Team", labelKey: "manager.navTeam" },
  { section: "Work", sectionKey: "manager.sectionWork" },
  { href: "/schedule", icon: "schedule", label: "Schedule", labelKey: "nav.schedule" },
  { href: "/ai", icon: "jarvis", label: "Jarvis", labelKey: "manager.navAi" },
  { section: "Admin", sectionKey: "manager.sectionAdmin" },
  { href: "/archive", icon: "archive", label: "Archive", labelKey: "nav.archive" },
  { href: "/payroll", icon: "payroll", label: "Payroll", labelKey: "manager.navPayroll", financeOnly: true },
  { href: "/admin/audit", icon: "audit", label: "Audit Log", labelKey: "audit.title", ownerOnly: true },
  { href: "/admin/settings", icon: "admin", label: "Admin Settings", labelKey: "admin.settings.title", ownerOnly: true },
  { href: "/trash", icon: "trash", label: "Trash", labelKey: "nav.trash" },
];

const mobileNav: Array<{ href: string; icon: JarvisIconName; labelKey: TranslationKey; financeOnly?: boolean }> = [
  { href: "/overview", icon: "overview", labelKey: "manager.navOverview" },
  { href: "/command-center", icon: "command", labelKey: "manager.navCommandCenter" },
  { href: "/projects", icon: "projects", labelKey: "manager.navProjects" },
  { href: "/team", icon: "team", labelKey: "manager.navTeam" },
  { href: "/schedule", icon: "schedule", labelKey: "nav.schedule" },
  { href: "/ai", icon: "jarvis", labelKey: "manager.navAi" },
  { href: "/payroll", icon: "payroll", labelKey: "manager.navPayroll", financeOnly: true },
];

const managerRefreshTables = {
  command: ["tasks", "projects", "time_events", "media", "messages", "project_assignments"],
  projects: ["projects", "tasks", "time_events", "media", "project_assignments", "project_exclusions"],
  team: [
    "profiles",
    "tasks",
    "time_events",
    "media",
    "projects",
    "project_assignments",
    "project_exclusions",
    "payroll_closures",
    "worker_location_consents",
  ],
  payroll: ["time_events", "profiles", "payroll_runs", "payroll_line_items", "payroll_closures", "pay_periods", "pay_period_items"],
  settings: ["profiles", "user_capabilities", "organizations"],
} as const;

function getManagerRealtimeTables(pathname: string | null): string[] {
  if (!pathname) return [];

  // These pages already own their own data refresh. A second global
  // router.refresh() is expensive and was the main cause of page stutter.
  if (
    pathname.startsWith("/overview") ||
    pathname.startsWith("/schedule") ||
    pathname.startsWith("/archive") ||
    pathname.startsWith("/admin/audit") ||
    pathname.startsWith("/ai")
  ) {
    return [];
  }

  if (pathname.startsWith("/command-center")) return [...managerRefreshTables.command];
  if (pathname.startsWith("/projects") || pathname.startsWith("/tasks")) return [...managerRefreshTables.projects];
  if (pathname.startsWith("/team")) return [...managerRefreshTables.team];
  if (pathname.startsWith("/payroll") || pathname.startsWith("/reports/annual")) return [...managerRefreshTables.payroll];
  if (pathname.startsWith("/admin/settings") || pathname.startsWith("/settings")) return [...managerRefreshTables.settings];

  return [];
}

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();

  // In auth-bypass/preview mode, owner is the default role
  const [userRole, setUserRole] = useState<string>(AUTH_BYPASS_ENABLED ? "owner" : "manager");
  const [userName, setUserName] = useState<string>(AUTH_BYPASS_ENABLED ? "Preview Owner" : "");
  const [hasFinanceMenu, setHasFinanceMenu] = useState(AUTH_BYPASS_ENABLED);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRefreshPendingWhileHiddenRef = useRef(false);
  const liveRefreshLastRunRef = useRef(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (AUTH_BYPASS_ENABLED) return;
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role, name")
        .eq("id", user.id)
        .single();
      if (data) {
        const profile = data as { role: string; name: string | null };
        setUserRole(profile.role);
        setUserName(profile.name ?? "");
        let canSeeFinance = profile.role === "owner" || profile.role === "admin";
        if (!canSeeFinance) {
          const { data: capability } = await supabase
            .from("user_capabilities")
            .select("granted")
            .eq("user_id", user.id)
            .eq("capability", "finance_access")
            .eq("granted", true)
            .maybeSingle<{ granted: boolean }>();
          canSeeFinance = capability?.granted === true;
        }
        setHasFinanceMenu(canSeeFinance);
      }
    }
    void loadProfile();
  }, [supabase]);

  useEffect(() => {
    if (AUTH_BYPASS_ENABLED) return;
    const tables = getManagerRealtimeTables(pathname);
    if (tables.length === 0) return;

    function scheduleRefresh() {
      if (document.visibilityState !== "visible") {
        liveRefreshPendingWhileHiddenRef.current = true;
        return;
      }
      if (liveRefreshTimerRef.current) return;
      if (isLiveRefreshBlocked()) {
        liveRefreshTimerRef.current = setTimeout(() => {
          liveRefreshTimerRef.current = null;
          scheduleRefresh();
        }, 2500);
        return;
      }
      const elapsed = Date.now() - liveRefreshLastRunRef.current;
      const delay = Math.max(1800, 4500 - elapsed);
      liveRefreshTimerRef.current = setTimeout(() => {
        liveRefreshTimerRef.current = null;
        liveRefreshLastRunRef.current = Date.now();
        startTransition(() => router.refresh());
      }, delay);
    }

    let channel = supabase.channel(`manager-refresh-${pathname}`);
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
    }
    channel.subscribe();

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible" || !liveRefreshPendingWhileHiddenRef.current) return;
      liveRefreshPendingWhileHiddenRef.current = false;
      scheduleRefresh();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (liveRefreshTimerRef.current) {
        clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      liveRefreshPendingWhileHiddenRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [pathname, supabase, router, startTransition]);

  const isOwnerUser = userRole === "owner" || userRole === "admin";
  const isManagerUser = isOwnerUser || userRole === "manager" || userRole === "supervisor";
  const scheduleOnlyUser = userRole === "worker" || userRole === "driver" || userRole === "subcontractor";

  const visibleSidebar = sidebarItems.filter((item) => {
    if ("href" in item && userRole === "sales" && item.href !== "/schedule" && item.href !== "/settings") return false;
    if ("href" in item && scheduleOnlyUser && item.href !== "/schedule" && item.href !== "/settings") return false;
    if ("ownerOnly" in item && item.ownerOnly && !isOwnerUser) return false;
    if ("financeOnly" in item && item.financeOnly && !hasFinanceMenu) return false;
    return true;
  });
  const visibleMobileNav = mobileNav.filter((item) => {
    if (userRole === "sales") return item.href === "/schedule";
    if (scheduleOnlyUser) return item.href === "/schedule";
    return !item.financeOnly || hasFinanceMenu;
  });

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <TopProgressBar />
      <aside
        className="app-sidebar hidden w-[244px] flex-shrink-0 flex-col overflow-y-auto md:flex"
      >
        <div
          className="px-4 py-4"
          style={{ borderBottom: "1px solid rgba(105, 231, 255, 0.13)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <JarvisOrb size="sm" state="idle" className="shrink-0" />
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-bold">
                  Check-<span className="text-brand">Time</span>
                </h1>
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--ai-cyan)]">
                  Jarvis core
                </div>
              </div>
            </div>
            <LanguageSwitcher />
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {t("manager.dashboard")}
            </p>
            {isOwnerUser ? (
              <span
                className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em]"
                style={{ background: "rgba(191, 162, 52, 0.2)", color: "var(--brand-yellow)" }}
              >
                {t("owner.badge")}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex-1 px-3 py-3">
          {visibleSidebar.map((item, i) => {
            if ("section" in item) {
              return (
                <div
                  key={i}
                  className={`px-3 pb-2 ${i === 0 ? "" : "mt-4"} sidebar-section`}
                >
                  {t(item.sectionKey)}
                </div>
              );
            }

            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active}
                className="sidebar-nav-item mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-xs font-medium"
                style={{
                  background: active ? "rgba(105, 231, 255, 0.08)" : "transparent",
                  color: active ? "var(--ai-cyan-bright)" : "var(--text-secondary)",
                  border: "none",
                }}
              >
                {item.icon === "jarvis" ? (
                  <JarvisOrb size="xs" state={active ? "notification" : "idle"} className="shrink-0" />
                ) : (
                  <JarvisIcon name={item.icon} size={17} active={active} className="shrink-0" />
                )}
                <span className="relative z-[1]">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>

        <div
          className="px-3 py-3"
          style={{ borderTop: "1px solid var(--border-default)" }}
        >
          <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-[rgba(105,231,255,0.12)] bg-[rgba(7,11,18,0.72)] px-2.5 py-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-[var(--text-inverse)]"
              style={{
                background: "linear-gradient(135deg, var(--ai-cyan-bright), var(--ai-cyan))",
                boxShadow: "0 0 18px rgba(105, 231, 255, 0.28)",
              }}
              aria-hidden
            >
              {(userName || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                {userName || t("sidebar.signedInAs")}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="uppercase tracking-[0.12em]">{userRole}</span>
                <span
                  className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em]"
                  style={{
                    background: isOwnerUser
                      ? "rgba(15, 168, 120, 0.16)"
                      : "rgba(107, 114, 128, 0.18)",
                    color: isOwnerUser ? "var(--green)" : "var(--text-muted)",
                  }}
                >
                  {isOwnerUser ? t("sidebar.fullAccess") : t("sidebar.limitedAccess")}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="button-base button-danger-ghost w-full justify-start"
          >
            {t("common.signOut")}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header
          className="app-topbar sticky top-0 z-10 flex items-center justify-between px-5 py-4 md:hidden"
        >
          <div className="flex items-center gap-2">
            <JarvisOrb size="xs" state="idle" />
            <h2 className="text-[15px] font-bold">
              Check-<span className="text-brand">Time</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <button
              onClick={handleLogout}
              className="button-base button-danger-ghost px-3 py-2 text-xs"
            >
              {t("common.signOut")}
            </button>
          </div>
        </header>

        {AUTH_BYPASS_ENABLED && isOwnerUser ? (
          <div
            className="px-5 py-2 text-center text-xs font-semibold"
            style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
          >
            {t("owner.demoBanner")}
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
            {children}
        </main>
      </div>

      {isManagerUser ? <JarvisDock /> : null}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: "linear-gradient(180deg, rgba(18,28,44,0.98), rgba(8,13,22,0.98))",
          borderTop: "1px solid rgba(105, 231, 255, 0.14)",
        }}
      >
        <div className="flex justify-around items-center py-1.5 pb-3">
          {visibleMobileNav.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-w-[48px] flex-col items-center gap-0.5 rounded-[var(--radius-md)] px-2 py-1.5"
                style={{
                  color: active ? "var(--ai-cyan-bright)" : "var(--text-muted)",
                  background: active ? "rgba(105, 231, 255, 0.08)" : "none",
                  border: "none",
                }}
              >
                {item.icon === "jarvis" ? (
                  <JarvisOrb size="xs" state={active ? "notification" : "idle"} />
                ) : (
                  <JarvisIcon name={item.icon} size={22} active={active} />
                )}
                <span className="text-[9px] font-semibold uppercase tracking-wide">
                  {t(item.labelKey)}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
