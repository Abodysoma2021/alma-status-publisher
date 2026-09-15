import type { NextConfig } from "next";

/**
 * The renderer is exported as a static SPA bundle (`out/`) that the Electron
 * main process serves over a localhost-only HTTP server. No server features
 * are used — all data flows through the typed IPC bridge.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  devIndicators: false,
};

export default nextConfig;
