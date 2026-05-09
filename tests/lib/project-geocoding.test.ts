import { describe, expect, it } from "vitest";
import { parseGoogleGeocodePayload } from "@/lib/project-geocoding";

describe("parseGoogleGeocodePayload", () => {
  it("returns a normalized address match with valid coordinates", () => {
    expect(
      parseGoogleGeocodePayload({
        status: "OK",
        results: [
          {
            formatted_address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
            geometry: {
              location: {
                lat: 37.422,
                lng: -122.084,
              },
            },
          },
        ],
      }),
    ).toEqual({
      ok: true,
      result: {
        formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
        lat: 37.422,
        lng: -122.084,
      },
    });
  });

  it("treats zero-result lookups as a not-found response", () => {
    expect(
      parseGoogleGeocodePayload({
        status: "ZERO_RESULTS",
        results: [],
      }),
    ).toEqual({
      ok: false,
      code: "zero_results",
      error: "No matching address was found.",
      status: 404,
    });
  });

  it("surfaces the Google API-disabled case clearly", () => {
    expect(
      parseGoogleGeocodePayload({
        status: "REQUEST_DENIED",
        error_message:
          "This API is not activated on your API project. You may need to enable this API in the Google Cloud Console.",
        results: [],
      }),
    ).toEqual({
      ok: false,
      code: "api_not_enabled",
      error: "Google Geocoding API is not enabled for this Google Cloud project.",
      status: 502,
    });
  });

  it("surfaces generic request denial clearly", () => {
    expect(
      parseGoogleGeocodePayload({
        status: "REQUEST_DENIED",
        error_message: "This IP, site or mobile application is not authorized to use this API key.",
        results: [],
      }),
    ).toEqual({
      ok: false,
      code: "request_denied",
      error: "This IP, site or mobile application is not authorized to use this API key.",
      status: 502,
    });
  });

  it("rejects out-of-range coordinates from the provider", () => {
    expect(
      parseGoogleGeocodePayload({
        status: "OK",
        results: [
          {
            formatted_address: "Broken provider result",
            geometry: {
              location: {
                lat: 95,
                lng: -181,
              },
            },
          },
        ],
      }),
    ).toEqual({
      ok: false,
      code: "invalid_coordinates",
      error: "Address lookup returned invalid coordinates.",
      status: 502,
    });
  });
});
