import type { NextConfig } from "next";

const API_BASE = process.env.AGNOST_API_BASE ?? "http://localhost:3000";

const config: NextConfig = {
  async rewrites() {
    return [
      // Proxy /api/v1/* to the Elysia backend. Avoids CORS entirely — the
      // browser only ever talks to localhost:3001.
      { source: "/api/v1/:path*", destination: `${API_BASE}/v1/:path*` },
    ];
  },
};

export default config;
