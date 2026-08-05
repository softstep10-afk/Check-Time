"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Copy, MapPin, Navigation, Share2, Zap } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  buildAppleMapsDirectionsUrl,
  buildGeoNavigationUrl,
  buildGoogleMapsDirectionsUrl,
  buildProjectAddressCopyText,
  buildProjectNavigationShareText,
  buildTeslaAppLaunchUrl,
  getProjectNavigationDestination,
  isAndroidUserAgent,
} from "@/lib/project-navigation";
import type { WorkerGeoPoint } from "@/lib/worker-types";

const subscribeToNothing = () => () => {};

export function ProjectNavigationActions({
  projectName,
  address,
  siteCoordinates,
  compact = false,
}: {
  projectName: string;
  address?: string | null;
  siteCoordinates?: WorkerGeoPoint | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<"destination" | "tesla" | null>(null);
  const isAndroid = useSyncExternalStore(
    subscribeToNothing,
    () => isAndroidUserAgent(window.navigator.userAgent),
    () => false,
  );
  const [teslaAwake, setTeslaAwake] = useState(false);
  const wakeRequested = useRef(false);

  // The Tesla app is launched in its own task, so this page goes hidden. When
  // the driver comes back the vehicle link is warm and the destination sends.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible" && wakeRequested.current) {
        wakeRequested.current = false;
        setTeslaAwake(true);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const destination = getProjectNavigationDestination({ address, siteCoordinates });

  if (!destination) return null;

  const navigationDestination = destination;
  const googleUrl = buildGoogleMapsDirectionsUrl(navigationDestination);
  const appleUrl = buildAppleMapsDirectionsUrl(navigationDestination);
  const shareText = buildProjectNavigationShareText({
    projectName,
    destination: navigationDestination,
    address,
  });
  const addressCopyText = buildProjectAddressCopyText({ address, destination: navigationDestination });

  async function copyDestination(kind: "destination" | "tesla") {
    try {
      await navigator.clipboard.writeText(kind === "tesla" ? shareText : addressCopyText);
      setCopied(kind);
      window.setTimeout(() => {
        setCopied((current) => (current === kind ? null : current));
      }, 1500);
    } catch {
      // Clipboard failures are non-fatal; the map links remain available.
    }
  }

  async function shareForTesla() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: projectName,
          text: shareText,
          url: googleUrl,
        });
        return;
      } catch {
        // User cancelled or the platform refused the share sheet. Fall
        // back to copying the exact destination for Tesla app/manual nav.
      }
    }
    await copyDestination("tesla");
  }

  function handleWakeTesla() {
    wakeRequested.current = true;
    setTeslaAwake(false);
    window.location.href = buildTeslaAppLaunchUrl();
  }

  function handleMobileGo() {
    window.location.href = buildGeoNavigationUrl(navigationDestination, {
      projectName,
      address,
      userAgent: window.navigator.userAgent,
    });
  }

  const buttonClass =
    "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[11px] font-semibold";
  const linkClass = `${buttonClass} no-underline`;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${compact ? "text-[10px]" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={t("projects.navigationActions")}
    >
      <div className="nav-touch-only w-full flex-wrap items-center gap-1.5">
        {isAndroid ? (
          <button
            type="button"
            onClick={handleWakeTesla}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 py-2 text-sm font-semibold"
            style={{
              borderColor: teslaAwake ? "rgba(15, 168, 120, 0.45)" : "rgba(59, 130, 246, 0.45)",
              color: teslaAwake ? "var(--green)" : "var(--blue)",
            }}
          >
            {teslaAwake ? <Check size={14} /> : <Zap size={14} />}
            {teslaAwake ? t("projects.teslaAwake") : t("projects.wakeTesla")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleMobileGo}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-2 text-sm font-bold"
          style={{
            background: "var(--brand-yellow)",
            color: "var(--text-inverse)",
          }}
        >
          <Navigation size={16} />
          {t("projects.goMobile")}
        </button>
        <button
          type="button"
          onClick={() => void copyDestination("destination")}
          className={`${buttonClass} min-h-11 flex-1 justify-center px-3 py-2 text-sm`}
          style={{
            borderColor:
              copied === "destination" ? "rgba(15, 168, 120, 0.4)" : "var(--border-default)",
            color: copied === "destination" ? "var(--green)" : "var(--text-secondary)",
          }}
        >
          {copied === "destination" ? <Check size={12} /> : <Copy size={12} />}
          {copied === "destination" ? t("projects.copied") : t("projects.copyDestination")}
        </button>
        {isAndroid && !teslaAwake ? (
          <p className="w-full text-[10px] leading-snug" style={{ color: "var(--text-secondary)" }}>
            {t("projects.teslaWakeHint")}
          </p>
        ) : null}
      </div>
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${linkClass} nav-pointer-only`}
        style={{
          borderColor: "rgba(191, 162, 52, 0.55)",
          background: "rgba(191, 162, 52, 0.16)",
          color: "var(--brand-yellow)",
        }}
      >
        <Navigation size={12} />
        {t("projects.goNow")}
      </a>
      <a
        href={appleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${linkClass} nav-pointer-only`}
        style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
      >
        <MapPin size={12} />
        {t("projects.appleMaps")}
      </a>
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${linkClass} nav-pointer-only`}
        style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
      >
        <MapPin size={12} />
        {t("projects.googleMaps")}
      </a>
      <button
        type="button"
        onClick={() => void shareForTesla()}
        className={`${buttonClass} nav-pointer-only`}
        style={{ borderColor: "rgba(59, 130, 246, 0.4)", color: "var(--blue)" }}
      >
        {copied === "tesla" ? <Check size={12} /> : <Share2 size={12} />}
        {copied === "tesla" ? t("projects.copied") : t("projects.teslaShare")}
      </button>
      <button
        type="button"
        onClick={() => void copyDestination("destination")}
        className={`${buttonClass} nav-pointer-only`}
        style={{
          borderColor: copied === "destination" ? "rgba(15, 168, 120, 0.4)" : "var(--border-default)",
          color: copied === "destination" ? "var(--green)" : "var(--text-secondary)",
        }}
      >
        {copied === "destination" ? <Check size={12} /> : <Copy size={12} />}
        {copied === "destination" ? t("projects.copied") : t("projects.copyDestination")}
      </button>
    </div>
  );
}
