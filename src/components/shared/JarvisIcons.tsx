"use client";

import type { ReactNode, SVGProps } from "react";

export type JarvisIconName =
  | "overview"
  | "command"
  | "projects"
  | "tasks"
  | "team"
  | "schedule"
  | "jarvis"
  | "archive"
  | "payroll"
  | "audit"
  | "admin"
  | "settings"
  | "trash"
  | "search"
  | "profile"
  | "report"
  | "alert";

const glyphs: Record<JarvisIconName, ReactNode> = {
  overview: (
    <>
      <path d="M6 17V10" />
      <path d="M12 17V7" />
      <path d="M18 17v-5" />
      <path d="M4 19h16" />
    </>
  ),
  command: (
    <>
      <path d="M5 12h14" />
      <path d="m13.5 6 5 6-5 6" />
      <path d="M5 7.5h4" />
      <path d="M5 16.5h4" />
    </>
  ),
  projects: (
    <>
      <path d="M4 8.5h6l1.5 2H20v7.5H4z" />
      <path d="M7 14h10" />
    </>
  ),
  tasks: (
    <>
      <path d="M8 5h8" />
      <path d="M9 3h6v4H9z" />
      <path d="M6 6h12v14H6z" />
      <path d="M9 12h1.5M13 12h3" />
      <path d="M9 16h1.5M13 16h3" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="2.5" />
      <circle cx="16" cy="10" r="2" />
      <path d="M4.5 18c.8-3 2.4-4.5 4.5-4.5S12.7 15 13.5 18" />
      <path d="M13.2 17.8c.5-2 1.6-3.1 3.1-3.1 1.4 0 2.5 1 3.2 3.1" />
    </>
  ),
  schedule: (
    <>
      <path d="M6 5v3M18 5v3" />
      <rect x="4" y="7" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M8 15h2M13 15h3" />
    </>
  ),
  jarvis: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 5v3M12 16v3M5 12h3M16 12h3" />
      <path d="M12 9.2 14.4 10.6v2.8L12 14.8l-2.4-1.4v-2.8z" />
    </>
  ),
  archive: (
    <>
      <path d="M5 8h14" />
      <path d="M7 8v11h10V8" />
      <path d="M9 12h6" />
      <path d="M8 5h8l1 3H7z" />
    </>
  ),
  payroll: (
    <>
      <path d="M5 7h14v10H5z" />
      <path d="M8 11h4M8 14h2" />
      <circle cx="16" cy="12" r="1.8" />
    </>
  ),
  audit: (
    <>
      <path d="M7 4h8l3 3v13H7z" />
      <path d="M15 4v4h4" />
      <path d="M10 12h5M10 16h6" />
    </>
  ),
  admin: (
    <>
      <path d="M12 4 19 7v5c0 4-2.6 6.6-7 8-4.4-1.4-7-4-7-8V7z" />
      <path d="M9.5 12h5M12 9.5v5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
      <path d="m6.4 6.4 2.1 2.1M15.5 15.5l2.1 2.1M17.6 6.4l-2.1 2.1M8.5 15.5l-2.1 2.1" />
    </>
  ),
  trash: (
    <>
      <path d="M6 8h12" />
      <path d="M9 8V5h6v3" />
      <path d="M8 8l1 12h6l1-12" />
      <path d="M11 12v4M14 12v4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4 4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c1-3.3 3-5 6-5s5 1.7 6 5" />
    </>
  ),
  report: (
    <>
      <path d="M6 19V5h12v14z" />
      <path d="M9 15v-3M12 15V9M15 15v-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 5 21 19H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
};

export function JarvisIcon({
  name,
  size = 18,
  active = false,
  className = "",
  ...props
}: {
  name: JarvisIconName;
  size?: number;
  active?: boolean;
  className?: string;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-active={active}
      className={`jarvis-icon ${className}`}
      aria-hidden="true"
      {...props}
    >
      <circle className="jarvis-icon__ring" cx="12" cy="12" r="10" />
      <g className="jarvis-icon__glyph">{glyphs[name]}</g>
    </svg>
  );
}
