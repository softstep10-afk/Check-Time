"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const THROTTLE_MS = 20_000; // send every 20 seconds

export type GpsTrackingState = "idle" | "active" | "denied" | "unsupported";

type Position = {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
};

export function useGpsTracking({
  enabled,
  onPosition,
}: {
  enabled: boolean;
  onPosition: (pos: Position) => void;
}) {
  const [state, setState] = useState<GpsTrackingState>("idle");
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);
  const onPositionRef = useRef(onPosition);

  useEffect(() => {
    onPositionRef.current = onPosition;
  }, [onPosition]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState("idle");
  }, []);

  useEffect(() => {
    if (!enabled) {
      // This effect intentionally mirrors the external GPS watch lifecycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stop();
      return;
    }

    if (!navigator.geolocation) {
      setState("unsupported");
      return;
    }

    setState("active");

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < THROTTLE_MS) return;
        lastSentRef.current = now;

        onPositionRef.current({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 30_000,
      },
    );

    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [enabled, stop]);

  return { state, stop };
}
