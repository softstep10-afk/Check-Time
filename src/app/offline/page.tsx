import type { Metadata } from "next";
import { OfflineShell } from "@/components/pwa/OfflineShell";

// PWA Task 4 — the offline boot shell route.
//
// Fully static and self-contained (no server data, no cookies), so it prerenders
// to a plain document. Combined with the browser-cache header in next.config and
// OfflineBoot's online prefetch, the browser can serve this document from its HTTP
// cache when offline — WITHOUT the service worker intercepting the navigation
// (the Task 2.1 guardrail forbids that). The shell itself reads the device's
// offline queues client-side.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline · Check-Time",
};

export default function OfflinePage() {
  return <OfflineShell />;
}
