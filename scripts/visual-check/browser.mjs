/**
 * The browser the visual check drives: the e2e package's own Playwright, and
 * the browser that package already installs.
 *
 * Resolved from `e2e/package.json` rather than declared again at the root, so
 * there is one Playwright version in the repository and the check can never
 * ask for a browser build the suite has not downloaded.
 *
 * @module scripts/visual-check/browser
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, two levels above this file. */
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

const fromE2e = createRequire(path.join(ROOT, "e2e", "package.json"));

/**
 * Playwright's Chromium launcher, as the e2e suite uses it. Required rather
 * than imported: the package's entry it resolves to is CommonJS, and node's
 * import of that path yields only a default export, so a named one would be
 * undefined outside the test runner.
 */
export const { chromium } = fromE2e("@playwright/test");
