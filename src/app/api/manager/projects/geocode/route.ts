import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import { parseGoogleGeocodePayload } from "@/lib/project-geocoding";
import { createClient } from "@/lib/supabase/server";
import { isValidGeoPoint } from "@/lib/worker-utils";

function getGeocodingApiKey(): { key: string; source: "server" | "public" | "missing" } {
  const serverKey =
    process.env.GOOGLE_GEOCODING_API_KEY ??
    process.env.GOOGLE_MAPS_SERVER_API_KEY ??
    "";
  if (serverKey) {
    return { key: serverKey, source: "server" };
  }

  const publicKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
  if (publicKey) {
    return { key: publicKey, source: "public" };
  }

  return { key: "", source: "missing" };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await requireManagerContext(supabase);

    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const reverse = body.reverse === true;
    const address = reverse ? "" : body.address?.toString().trim() ?? "";

    let lat = Number.NaN;
    let lng = Number.NaN;
    if (reverse) {
      lat = typeof body.lat === "number" ? body.lat : Number.NaN;
      lng = typeof body.lng === "number" ? body.lng : Number.NaN;
      if (!isValidGeoPoint({ lat, lng })) {
        return NextResponse.json(
          {
            error: "Latitude must be between -90 and 90, and longitude must be between -180 and 180.",
            code: "invalid_coordinates",
          },
          { status: 400 },
        );
      }
    } else if (!address) {
      return NextResponse.json(
        {
          error: "Type an address before looking up GPS coordinates.",
          code: "missing_address",
        },
        { status: 400 },
      );
    }

    const geocodingKey = getGeocodingApiKey();
    if (!geocodingKey.key) {
      return NextResponse.json(
        {
          error:
            "Address geocoding needs GOOGLE_GEOCODING_API_KEY or GOOGLE_MAPS_SERVER_API_KEY on the server.",
          code: "api_key_missing",
        },
        { status: 503 },
      );
    }

    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    if (reverse) {
      geocodeUrl.searchParams.set("latlng", `${lat},${lng}`);
    } else {
      geocodeUrl.searchParams.set("address", address);
    }
    geocodeUrl.searchParams.set("key", geocodingKey.key);

    const response = await fetch(geocodeUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Address lookup failed (${response.status}).`,
          code: "server_error",
        },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as unknown;
    const parsed = parseGoogleGeocodePayload(payload);

    if (!parsed.ok) {
      return NextResponse.json(
        {
          error: parsed.error,
          code: parsed.code,
          keySource: geocodingKey.source,
        },
        { status: parsed.status },
      );
    }

    return NextResponse.json({
      ok: true,
      formattedAddress: parsed.result.formattedAddress,
      lat: parsed.result.lat,
      lng: parsed.result.lng,
      keySource: geocodingKey.source,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message, code: "server_error" }, { status: 500 });
  }
}
