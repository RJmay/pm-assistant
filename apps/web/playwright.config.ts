import { defineConfig } from "@playwright/test";

// E2E runs only when RUN_E2E_TESTS=1 (the specs self-skip otherwise) against
// a locally running app + seeded Supabase. CI runs unit tests only; e2e is a
// manual / pre-release gate until Phase B (hosted Supabase) is up.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4173",
  },
});
