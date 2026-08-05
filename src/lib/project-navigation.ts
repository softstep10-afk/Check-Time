import type { WorkerGeoPoint } from "@/lib/worker-types";

export type ProjectNavigationDestination = {
  query: string;
  displayText: string;
  source: "coordinates" | "address";
};

export function getProjectNavigationDestination(input: {
  address?: string | null;
  siteCoordinates?: WorkerGeoPoint | null;
}): ProjectNavigationDestination | null {
  const point = input.siteCoordinates;
  if (
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng)
  ) {
    const query = `${point.lat},${point.lng}`;
    return {
      query,
      displayText: query,
      source: "coordinates",
    };
  }

  const address = input.address?.trim();
  if (!address) return null;

  return {
    query: address,
    displayText: address,
    source: "address",
  };
}

export function normalizeProjectAddressForCopy(address: string | null | undefined): string | null {
  const normalized = address?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

export function buildProjectAddressCopyText(input: {
  address?: string | null;
  destination: ProjectNavigationDestination;
}): string {
  return normalizeProjectAddressForCopy(input.address) ?? input.destination.displayText;
}

export function buildGoogleMapsDirectionsUrl(destination: ProjectNavigationDestination): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination.query)}`;
}

export function buildAppleMapsDirectionsUrl(destination: ProjectNavigationDestination): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(destination.query)}`;
}

export function buildGeoNavigationUrl(
  destination: ProjectNavigationDestination,
  options: {
    projectName?: string | null;
    address?: string | null;
    userAgent?: string | null;
  } = {},
): string {
  const userAgent =
    options.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const isIos =
    /\b(iPad|iPhone|iPod)\b/i.test(userAgent) ||
    (/\bMacintosh\b/i.test(userAgent) && /\bMobile\b/i.test(userAgent));

  if (isIos) {
    return `https://maps.apple.com/?q=${encodeURIComponent(destination.query)}`;
  }

  // Android/Tesla: a street address geocodes to a routable road on the vehicle
  // side, whereas a raw coordinate pin can land where the car cannot route.
  const navAddress = options.address?.trim();
  if (navAddress) {
    return `geo:0,0?q=${encodeURIComponent(navAddress)}`;
  }

  if (destination.source === "coordinates") {
    return `geo:${destination.query}?q=${encodeURIComponent(destination.query)}`;
  }

  return `geo:0,0?q=${encodeURIComponent(destination.query)}`;
}

export function buildProjectNavigationShareText(input: {
  projectName: string;
  destination: ProjectNavigationDestination;
  address?: string | null;
}): string {
  const lines = [input.projectName, input.destination.displayText];
  const address = normalizeProjectAddressForCopy(input.address);
  if (address && address !== input.destination.displayText) {
    lines.push(address);
  }
  return lines.join("\n");
}

const TESLA_ANDROID_PACKAGE = "com.teslamotors.tesla";

export function isAndroidUserAgent(userAgent?: string | null): boolean {
  const ua = userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  return /\bAndroid\b/i.test(ua);
}

/**
 * Launches the Tesla Android app straight to its launcher activity.
 *
 * The vehicle falls asleep after a short idle window. A geo: intent handed to
 * a cold Tesla app cannot reach a sleeping car, which the app surfaces as
 * "Error" - the same address then works once the app has been foregrounded
 * and has re-established the link with the vehicle. This URL automates that
 * step so the driver does not have to remember it.
 */
export function buildTeslaAppLaunchUrl(): string {
  return `intent://#Intent;package=${TESLA_ANDROID_PACKAGE};action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end`;
}
