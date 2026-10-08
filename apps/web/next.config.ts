import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The deterministic engine lives at ../../src/klynge (TypeScript source, server-only).
  experimental: { externalDir: true },
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  serverExternalPackages: ["sharp"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
