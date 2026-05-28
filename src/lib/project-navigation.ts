import type { WorkerGeoPoint } from "@/lib/worker-types";

export type ProjectNavigationDestination = {
  query: string;
  displayText: string;
  source: "coordinates" | "address";
};

export const PROJECT_NAVIGATION_PREFERENCE_KEY = "projectNavigationPreferredApp";

export const PROJECT_NAVIGATION_APPS = ["apple", "google", "tesla", "copy"] as const;

export type ProjectNavigationApp = (typeof PROJECT_NAVIGATION_APPS)[number];

export function isProjectNavigationApp(value: unknown): value is ProjectNavigationApp {
  return (
    typeof value === "string" &&
    (PROJECT_NAVIGATION_APPS as readonly string[]).includes(value)
  );
}

type NavigationPreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readProjectNavigationPreference(
  storage: NavigationPreferenceStorage | null | undefined,
): ProjectNavigationApp | null {
  if (!storage) return null;
  const stored = storage.getItem(PROJECT_NAVIGATION_PREFERENCE_KEY);
  return isProjectNavigationApp(stored) ? stored : null;
}

export function writeProjectNavigationPreference(
  storage: NavigationPreferenceStorage | null | undefined,
  app: ProjectNavigationApp,
): void {
  if (!storage) return;
  storage.setItem(PROJECT_NAVIGATION_PREFERENCE_KEY, app);
}

export function clearProjectNavigationPreference(
  storage: NavigationPreferenceStorage | null | undefined,
): void {
  if (!storage) return;
  storage.removeItem(PROJECT_NAVIGATION_PREFERENCE_KEY);
}

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
