import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/api/context-handoff": ["./node_modules/playwright-core/.local-browsers/**/*"],
    "/api/context-preview": ["./node_modules/playwright-core/.local-browsers/**/*"],
  },
};

export default nextConfig;
