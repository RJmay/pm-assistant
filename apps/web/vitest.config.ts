import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

// Standalone Vitest config (not the SvelteKit vite config) so unit + component
// tests run under jsdom without booting the full Kit pipeline. Playwright e2e
// lives separately under playwright.config.ts.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest-setup.ts"],
    include: ["src/**/*.{test,spec}.ts"],
  },
});
