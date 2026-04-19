"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, FolderKanban, Users, Clock, CalendarDays, Sparkles, Wallet, Settings as SettingsIcon, ShieldCheck, Trash2, MapPin, Store, FileBarChart, ScrollText, Sliders, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, LanguageSwitcher } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";

type SidebarItem =
  | { section: string; sectionKey: TranslationKey; ownerOnly?: boolean }
  | { href: string; icon: typeof BarChart3; label: string; labelKey: TranslationKey; ownerOnly?: boolean };

const sidebarItems: SidebarItem[] = [
  { section: "Main", sectionKey: "manager.sectionMain" },
  { href: "/overview", icon: BarChart3, label: "Overview", labelKey: "manager.navOverview" },
  { href: "/projects", icon: FolderKanban, label: "Projects", labelKey: "manager.navProjects" },
  { href: "/team", icon: Users, label: "Team", labelKey: "manager.navTeam" },
  { section: "Work", sectionKey: "manager.sectionWork" },
  { href: "/tasks", icon: ClipboardCheck, label: "Tasks", labelKey: "common.tasks" },
  { href: "/timeline", icon: Clock, label: "Timeline", labelKey: "manager.navTimeline" },
  { href: "/schedule", icon: CalendarDays, label: "Schedule", labelKey: "nav.schedule" },
  { href: "/ai", icon: Sparkles, label: "AI", labelKey: "manager.navAi" },
  { section: "Admin", sectionKey: "manager.sectionAdmin" },
  { href: "/payroll", icon: Wallet, label: "Payroll", labelKey: "manager.navPayroll" },
  { href: "/reports/annual", icon: FileBarChart, label: "Annual Report", labelKey: "report.title" },
  { href: "/managers", icon: ShieldCheck, label: "Managers", labelKey: "nav.managers", ownerOnly: true },
  { href: "/stores", icon: Store, label: "Stores", labelKey: "stores.title", ownerOnly: true },
  { href: "/location-data", icon: MapPin, label: "Location Data", labelKey: "gps.adminTitle", ownerOnly: true },
  { href: "/admin/audit", icon: ScrollText, label: "Audit Log", labelKey: "audit.title", ownerOnly: true },
  { href: "/admin/settings", icon: Sliders, label: "Admin Settings", labelKey: "admin.settings.title", ownerOnly: true },
  { href: "/settings", icon: SettingsIcon, label: "Settings", labelKey: "manager.navSettings" },
  { href: "/trash", icon: Trash2, label: "Trash", labelKey: "nav.trash" },
];

const mobileNav = [
  { href: "/overview", icon: BarChart3, labelKey: "manager.navOverview" as TranslationKey },
  { href: "/projects", icon: FolderKanban, labelKey: "manager.navProjects" as TranslationKey },
  { href: "/team", icon: Users, labelKey: "manager.navTeam" as TranslationKey },
  { href: "/timeline", icon: Clock, labelKey: "manager.navTimeline" as TranslationKey },
  { href: "/ai", icon: Sparkles, labelKey: "manager.navAi" as TranslationKey },
  { href: "/payroll", icon: Wallet, labelKey: "manager.navPayroll" as TranslationKey },
];

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { t } = useTranslation();

  // In auth-bypass/preview mode, owner is the default role
  const [userRole, setUserRole] = useState<string>(AUTH_BYPASS_ENABLED ? "owner" : "manager");
  const [userName, setUserName] = useState<string>(AUTH_BYPASS_ENABLED ? "Preview Owner" : "");

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
      }
    }
    void loadProfile();
  }, [supabase]);

  const isOwnerUser = userRole === "owner" || userRole === "admin";

  const visibleSidebar = sidebarItems.filter((item) => {
    if ("ownerOnly" in item && item.ownerOnly && !isOwnerUser) return false;
    return true;
  });

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <aside
        className="hidden w-[232px] flex-shrink-0 flex-col overflow-y-auto md:flex"
        style={{
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-default)",
        }}
      >
        <div
          className="px-4 py-4"
          style={{ borderBottom: "1px solid var(--border-default)" }}
        >
          <div className="flex items-center justify-between">
            <h1 className="text-[15px] font-bold">
              Check-<span className="text-brand">Time</span>
            </h1>
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
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                data-active={active}
                className="sidebar-nav-item mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-xs font-medium"
                style={{
                  background: active ? "rgba(191, 162, 52, 0.1)" : "transparent",
                  color: active ? "var(--brand-yellow)" : "var(--text-secondary)",
                  border: "none",
                }}
              >
                <item.icon size={16} strokeWidth={1.9} className="shrink-0" />
                <span className="relative z-[1]">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>

        <div
          className="px-3 py-3"
          style={{ borderTop: "1px solid var(--border-default)" }}
        >
          <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-2.5 py-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-black"
              style={{ background: "var(--brand-yellow)" }}
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
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 md:hidden"
          style={{
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border-default)",
          }}
        >
          <h2 className="text-[15px] font-bold">
            Check-<span className="text-brand">Time</span>
          </h2>
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

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: "var(--bg-surface)",
          borderTop: "1px solid var(--border-default)",
        }}
      >
        <div className="flex justify-around items-center py-1.5 pb-3">
          {mobileNav.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className="flex min-w-[48px] flex-col items-center gap-0.5 rounded-[var(--radius-md)] px-2 py-1.5"
                style={{
                  color: active ? "var(--brand-yellow)" : "var(--text-muted)",
                  background: active ? "rgba(191, 162, 52, 0.1)" : "none",
                  border: "none",
                }}
              >
                <item.icon size={22} strokeWidth={1.8} />
                <span className="text-[9px] font-semibold uppercase tracking-wide">
                  {t(item.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
