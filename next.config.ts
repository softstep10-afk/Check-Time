import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  // Next 16's dev server blocks cross-origin requests for HMR, RSC
  // payloads, and static assets unless the origin is on this list.
  // When the browser opens the app at 127.0.0.1 (or `localhost`) but
  // `next dev` binds 0.0.0.0, the host header (127.0.0.1) is "cross
  // origin" relative to the bind address — the RSC stream gets cut,
  // hydration never finishes, and every click looks dead.
  //
  // Listing all the loopback aliases plus the LAN IP for phones on
  // the same Wi-Fi covers desktop, mobile, and headless-Chrome
  // testing without further opt-in.
  allowedDevOrigins: [
    "127.0.0.1",
    "127.0.0.1:3000",
    "localhost",
    "localhost:3000",
    "10.0.0.55",
    "10.0.0.55:3000",
  ],
};

export default nextConfig;
