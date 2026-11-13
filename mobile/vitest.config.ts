import { defineConfig } from "vitest/config";

// Only the platform-free logic in src/core is unit tested; screens are covered by tsc and the e2e suite.
export default defineConfig({ test: { environment: "node", include: ["src/core/**/*.test.ts"] } });
