import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/api/context-handoff": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/context-preview": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  serverExternalPackages: ["@sparticuz/chromium"],
};

export default nextConfig;
