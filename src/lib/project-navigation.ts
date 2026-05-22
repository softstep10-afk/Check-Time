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
  const address = input.address?.trim();
  if (address && address !== input.destination.displayText) {
    lines.push(address);
  }
  return lines.join("\n");
}
