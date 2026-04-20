import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  // Phones on the same Wi-Fi hit the dev server at http://10.0.0.55:3000.
  // Next 16 blocks cross-origin dev requests (HMR, RSC, assets) unless the
  // origin is whitelisted here.
  allowedDevOrigins: ["10.0.0.55", "10.0.0.55:3000"],
};

export default nextConfig;
