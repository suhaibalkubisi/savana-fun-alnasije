import type { NextConfig } from "next";
import path from 'node:path';
const nextConfig: NextConfig = {
  webpack(config, {webpack}) {
    if(process.env.HR_NEXT_BUILD==='1')config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/,path.resolve('lib/server/runtime.node.ts')));
    return config;
  },
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
