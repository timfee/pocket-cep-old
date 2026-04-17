import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Instrumentation uses child_process (Node-only). This tells Next.js
  // not to analyze it for Edge Runtime compatibility.
  serverExternalPackages: ["child_process"],
};

export default nextConfig;
