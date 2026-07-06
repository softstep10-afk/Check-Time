"use client";

import { useCallback, useMemo } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import { useTranslation } from "@/lib/i18n";

const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1a1d27" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1d27" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#2a2d37" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#1e2333" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5a5e6b" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1a2420" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2a2d37" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1a1d27" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#333845" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#1e2333" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0e1218" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3a3e4b" }],
  },
];

const DEFAULT_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  styles: DARK_MAP_STYLE,
  backgroundColor: "#0f1117",
};

const CONTAINER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
};

const COPY = {
  en: {
    missingKey: "Map unavailable: NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set.",
    loadError: "Map failed to load. Check the Google Maps API key and billing.",
    offlineUnavailable: "Map unavailable while you're offline.",
    loading: "Loading map...",
  },
  ru: {
    missingKey: "Карта недоступна: NEXT_PUBLIC_GOOGLE_MAPS_KEY не задан.",
    loadError: "Карта не загрузилась. Проверьте Google Maps API key и billing.",
    offlineUnavailable: "Карта недоступна, пока вы офлайн.",
    loading: "Карта загружается...",
  },
} as const;

export function MapProvider({
  children,
  center,
  zoom,
  options,
  onLoad,
}: {
  children?: React.ReactNode;
  center: google.maps.LatLngLiteral;
  zoom: number;
  options?: google.maps.MapOptions;
  onLoad?: (map: google.maps.Map) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
  const { locale } = useTranslation();
  const text = COPY[locale];
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
  });
  const mergedOptions = useMemo(() => ({ ...DEFAULT_OPTIONS, ...options }), [options]);

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      onLoad?.(map);
    },
    [onLoad],
  );

  if (!apiKey) {
    return (
      <div
        className="flex h-full w-full items-center justify-center px-4 text-center text-sm"
        style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
      >
        {text.missingKey}
      </div>
    );
  }

  if (loadError) {
    // Offline is the common cause of a load failure in the field — don't blame
    // the API key/billing when the worker simply has no connection.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <div
        className="flex h-full w-full items-center justify-center px-4 text-center text-sm"
        style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
      >
        {offline ? text.offlineUnavailable : text.loadError}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm"
        style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
      >
        {text.loading}
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={CONTAINER_STYLE}
      center={center}
      zoom={zoom}
      options={mergedOptions}
      onLoad={handleLoad}
    >
      {children}
    </GoogleMap>
  );
}

export { DARK_MAP_STYLE };
