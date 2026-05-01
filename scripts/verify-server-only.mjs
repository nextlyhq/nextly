#!/usr/bin/env node
/**
 * Audit C7 / T-004: verify that the Direct API throws when imported
 * with a browser-shaped global.
 *
 * Wired into CI alongside `pnpm check-types` / `pnpm test`. Exits 0 on
 * the throw (expected), non-zero if the import succeeds (regression).
 */

// Simulate a browser context BEFORE the import happens.
globalThis.window = /** @type {Window & typeof globalThis} */ ({});

let threw = false;
try {
  // Path is intentionally relative-from-repo-root so the script works
  // identically in the repo and inside any consumer that vendored the
  // built dist/ output.
  await import("../packages/nextly/dist/index.mjs");
} catch (err) {
  threw = true;
  const message = err instanceof Error ? err.message : String(err);
  if (!/server-only|browser context/i.test(message)) {
    console.error(
      "[verify-server-only] Direct API threw, but the message does NOT mention 'server-only' or 'browser context':"
    );
    console.error(message);
    process.exit(1);
  }
  console.log("[verify-server-only] OK — Direct API rejected browser context.");
}

if (!threw) {
  console.error(
    "[verify-server-only] FAIL — Direct API loaded successfully in a browser context. T-004 regressed."
  );
  process.exit(1);
}
