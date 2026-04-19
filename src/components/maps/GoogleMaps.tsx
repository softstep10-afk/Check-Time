"use client";

import { useCallback, useState } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";

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
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "",
  });

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      onLoad?.(map);
    },
    [onLoad],
  );

  if (!isLoaded) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-sm"
        style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
      >
        Loading map...
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={CONTAINER_STYLE}
      center={center}
      zoom={zoom}
      options={{ ...DEFAULT_OPTIONS, ...options }}
      onLoad={handleLoad}
    >
      {children}
    </GoogleMap>
  );
}

export { DARK_MAP_STYLE };
