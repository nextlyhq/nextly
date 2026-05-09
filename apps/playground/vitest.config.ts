import { defineConfig } from "vitest/config";

// Vitest config for playground-internal tooling (doctor, seed, reset).
// The playground itself is a Next.js app and isn't unit-tested at this
// layer; what lives under scripts/__tests__/ tests the dev-experience
// helpers that ship alongside it.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["scripts/__tests__/**/*.test.ts"],
  },
});
