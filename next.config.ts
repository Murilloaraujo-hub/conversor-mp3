import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large file uploads for video conversion
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
