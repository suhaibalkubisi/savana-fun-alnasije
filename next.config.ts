import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  turbopack: process.env.HR_NEXT_BUILD === "1" ? {
    resolveAlias: { "cloudflare:workers": "./lib/server/runtime.node.ts" },
  } : {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
