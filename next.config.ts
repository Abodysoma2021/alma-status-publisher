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
  // Electron loads the renderer from http://127.0.0.1:<port> — without this,
  // Next 16 blocks dev resources (HMR/RSC) as cross-origin and hydration
  // silently never runs (UI renders but nothing responds).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
