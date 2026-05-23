import { describe, expect, it } from "vitest";
import {
  buildAppleMapsDirectionsUrl,
  buildGoogleMapsDirectionsUrl,
  buildProjectNavigationShareText,
  getProjectNavigationDestination,
  isProjectNavigationApp,
  PROJECT_NAVIGATION_PREFERENCE_KEY,
} from "@/lib/project-navigation";

describe("project navigation actions", () => {
  it("prefers high-precision coordinates over address text", () => {
    const destination = getProjectNavigationDestination({
      address: "123 Main St",
      siteCoordinates: { lat: 47.799137872580424, lng: -122.24154212345678 },
    });

    expect(destination).toEqual({
      query: "47.799137872580424,-122.24154212345678",
      displayText: "47.799137872580424,-122.24154212345678",
      source: "coordinates",
    });
  });

  it("builds Apple and Google directions URLs from coordinates", () => {
    const destination = getProjectNavigationDestination({
      siteCoordinates: { lat: 47.307322, lng: -122.228453 },
    });

    expect(destination).not.toBeNull();
    expect(buildAppleMapsDirectionsUrl(destination!)).toBe(
      "https://maps.apple.com/?daddr=47.307322%2C-122.228453",
    );
    expect(buildGoogleMapsDirectionsUrl(destination!)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=47.307322%2C-122.228453",
    );
  });

  it("falls back to encoded address when coordinates are unavailable", () => {
    const destination = getProjectNavigationDestination({
      address: "1400 1st Ave, Seattle, WA",
      siteCoordinates: null,
    });

    expect(destination?.source).toBe("address");
    expect(buildGoogleMapsDirectionsUrl(destination!)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1400%201st%20Ave%2C%20Seattle%2C%20WA",
    );
  });

  it("returns null when neither coordinates nor address are available", () => {
    expect(getProjectNavigationDestination({ address: " ", siteCoordinates: null })).toBeNull();
  });

  it("builds Tesla-friendly copy text without tokens or external APIs", () => {
    const destination = getProjectNavigationDestination({
      address: "123 Main St",
      siteCoordinates: { lat: 47.799137872580424, lng: -122.24154212345678 },
    });

    expect(
      buildProjectNavigationShareText({
        projectName: "Kitchen Remodel",
        address: "123 Main St",
        destination: destination!,
      }),
    ).toBe("Kitchen Remodel\n47.799137872580424,-122.24154212345678\n123 Main St");
  });

  it("defines a local mobile navigation preference without server storage", () => {
    expect(PROJECT_NAVIGATION_PREFERENCE_KEY).toBe("projectNavigationPreferredApp");
    expect(isProjectNavigationApp("apple")).toBe(true);
    expect(isProjectNavigationApp("google")).toBe(true);
    expect(isProjectNavigationApp("tesla")).toBe(true);
    expect(isProjectNavigationApp("sanya")).toBe(false);
  });
});
