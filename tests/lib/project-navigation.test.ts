import { describe, expect, it } from "vitest";
import {
  buildAppleMapsDirectionsUrl,
  buildGeoNavigationUrl,
  buildProjectAddressCopyText,
  buildGoogleMapsDirectionsUrl,
  buildProjectNavigationShareText,
  getProjectNavigationDestination,
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

  it("copies the full stored address even when navigation prefers coordinates", () => {
    const destination = getProjectNavigationDestination({
      address: "123 Main St, Auburn, WA 98001",
      siteCoordinates: { lat: 47.307322, lng: -122.228453 },
    });

    expect(buildProjectAddressCopyText({
      address: "123 Main St, Auburn, WA 98001",
      destination: destination!,
    })).toBe("123 Main St, Auburn, WA 98001");
  });

  it("preserves ZIP+4, commas, and line breaks when copying an address", () => {
    const destination = getProjectNavigationDestination({
      address: "123 Main St\nSuite 4, Auburn, WA 98001-1234",
      siteCoordinates: null,
    });

    expect(buildProjectAddressCopyText({
      address: "123 Main St\nSuite 4, Auburn, WA 98001-1234",
      destination: destination!,
    })).toBe("123 Main St Suite 4, Auburn, WA 98001-1234");
  });

  it("falls back to coordinates for copy text only when no address exists", () => {
    const destination = getProjectNavigationDestination({
      address: null,
      siteCoordinates: { lat: 47.307322, lng: -122.228453 },
    });

    expect(buildProjectAddressCopyText({ address: null, destination: destination! })).toBe(
      "47.307322,-122.228453",
    );
  });

  it("builds Android geo navigation URLs from coordinates", () => {
    const destination = getProjectNavigationDestination({
      siteCoordinates: { lat: 47.307322, lng: -122.228453 },
    });

    expect(destination).not.toBeNull();
    expect(buildGeoNavigationUrl(destination!, {
      projectName: "Kitchen Remodel",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    })).toBe(
      "geo:47.307322,-122.228453?q=47.307322%2C-122.228453(Kitchen%20Remodel)",
    );
  });

  it("builds Android geo navigation URLs from addresses", () => {
    const destination = getProjectNavigationDestination({
      address: "1400 1st Ave, Seattle, WA",
      siteCoordinates: null,
    });

    expect(destination).not.toBeNull();
    expect(buildGeoNavigationUrl(destination!, {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    })).toBe("geo:0,0?q=1400%201st%20Ave%2C%20Seattle%2C%20WA");
  });

  it("uses universal Apple Maps links for iOS system navigation", () => {
    const destination = getProjectNavigationDestination({
      siteCoordinates: { lat: 47.307322, lng: -122.228453 },
    });

    expect(destination).not.toBeNull();
    expect(buildGeoNavigationUrl(destination!, {
      projectName: "Kitchen Remodel",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    })).toBe("https://maps.apple.com/?q=47.307322%2C-122.228453");
  });
});
