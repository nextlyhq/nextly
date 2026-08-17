import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suite boots no app, but the scan tests hit the real filesystem and
    // the vendor step copies a ~3.6MB asset on Windows; 30s keeps both clear
    // of vitest's 5s default without slowing the fast unit cases.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
