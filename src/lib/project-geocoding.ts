import { isValidGeoPoint } from "@/lib/worker-utils";

export type ProjectAddressGeocodeResult = {
  formattedAddress: string | null;
  lat: number;
  lng: number;
};

export type ProjectAddressGeocodeParseResult =
  | {
      ok: true;
      result: ProjectAddressGeocodeResult;
    }
  | {
      ok: false;
      code:
        | "invalid_response"
        | "api_not_enabled"
        | "request_denied"
        | "zero_results"
        | "invalid_request"
        | "over_query_limit"
        | "invalid_coordinates";
      error: string;
      status: number;
    };

export function parseGoogleGeocodePayload(
  payload: unknown,
): ProjectAddressGeocodeParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      code: "invalid_response",
      error: "Address lookup returned an invalid response.",
      status: 502,
    };
  }

  const response = payload as {
    status?: unknown;
    error_message?: unknown;
    results?: unknown;
  };
  const status = typeof response.status === "string" ? response.status : "";
  const results = Array.isArray(response.results) ? response.results : [];

  if (status === "ZERO_RESULTS" || (status === "OK" && results.length === 0)) {
    return {
      ok: false,
      code: "zero_results",
      error: "No matching address was found.",
      status: 404,
    };
  }

  if (status !== "OK") {
    const errorMessage =
      typeof response.error_message === "string" && response.error_message.trim()
        ? response.error_message
        : "";

    if (
      status === "REQUEST_DENIED" &&
      /not activated on your api project/i.test(errorMessage)
    ) {
      return {
        ok: false,
        code: "api_not_enabled",
        error:
          "Google Geocoding API is not enabled for this Google Cloud project.",
        status: 502,
      };
    }

    if (status === "REQUEST_DENIED") {
      return {
        ok: false,
        code: "request_denied",
        error:
          errorMessage ||
          "Google denied address lookup. Check the API key restrictions.",
        status: 502,
      };
    }

    if (status === "INVALID_REQUEST") {
      return {
        ok: false,
        code: "invalid_request",
        error: errorMessage || "Google rejected this address lookup request.",
        status: 400,
      };
    }

    if (status === "OVER_QUERY_LIMIT") {
      return {
        ok: false,
        code: "over_query_limit",
        error:
          errorMessage || "Google geocoding quota was exceeded. Try again later.",
        status: 429,
      };
    }

    return {
      ok: false,
      code: "invalid_response",
      error: errorMessage || "Address lookup failed.",
      status: 502,
    };
  }

  const first = results[0] as
    | {
        formatted_address?: unknown;
        geometry?: {
          location?: {
            lat?: unknown;
            lng?: unknown;
          };
        };
      }
    | undefined;

  const lat =
    typeof first?.geometry?.location?.lat === "number"
      ? first.geometry.location.lat
      : Number.NaN;
  const lng =
    typeof first?.geometry?.location?.lng === "number"
      ? first.geometry.location.lng
      : Number.NaN;

  if (!isValidGeoPoint({ lat, lng })) {
    return {
      ok: false,
      code: "invalid_coordinates",
      error: "Address lookup returned invalid coordinates.",
      status: 502,
    };
  }

  return {
    ok: true,
    result: {
      formattedAddress:
        typeof first?.formatted_address === "string" && first.formatted_address.trim()
          ? first.formatted_address
          : null,
      lat,
      lng,
    },
  };
}
