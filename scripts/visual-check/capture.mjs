/**
 * Capturing each route at each width and scheme, and reading each capture's
 * page for what the checks find.
 *
 * @module scripts/visual-check/capture
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { THEME_STORAGE_KEY } from "../../e2e/tests/support/theme.mjs";
import { settleTransitions } from "../../e2e/tests/support/axe-scan.mjs";

import { capturePlan } from "./options.mjs";
import {
  checkPage,
  describeFinding,
  routeFailure,
  SIGN_IN_PATH,
} from "./page-checks.mjs";

/**
 * How long a page may keep loading before it is captured as it stands. A
 * screen that polls never goes quiet, and waiting on it for good would capture
 * nothing.
 */
const NETWORK_QUIET_MS = 10_000;

/** How long the admin may take to draw a screen, as the suite's sign-in allows. */
const DRAWN_MS = 30_000;

/**
 * Waits until the page shows what a reader would see: loaded, quiet on the
 * network, and, on an admin screen, drawn in the scheme asked for.
 *
 * The admin is served empty and drawn after hydration, so its `main` appearing
 * is the sign it has drawn a screen; a redirect to sign-in has no such screen,
 * which ends the wait too. Its palette hangs off `.nextly-admin.dark`, applied
 * after mount, so that is awaited before the capture. Every wait is bounded and
 * a page that outlasts one is captured as it is: the capture then shows what is
 * wrong, which says more than a timeout.
 */
async function settle(page, scheme) {
  // The functions handed to the page run there, so they read the page's globals off
  // `globalThis` rather than from this node module's scope.
  await page
    .waitForLoadState("networkidle", { timeout: NETWORK_QUIET_MS })
    .catch(() => undefined);
  if ((await page.locator(".nextly-admin").count()) > 0) {
    await page
      .waitForFunction(
        signIn =>
          globalThis.location.pathname.startsWith(signIn) ||
          globalThis.document.querySelector("main")?.checkVisibility() === true,
        SIGN_IN_PATH,
        { timeout: DRAWN_MS }
      )
      .catch(() => undefined);
    await page
      .waitForFunction(
        dark =>
          globalThis.document
            .querySelector(".nextly-admin")
            ?.classList.contains("dark") === dark,
        scheme === "dark",
        {
          timeout: DRAWN_MS,
        }
      )
      .catch(() => undefined);
  }
  await page.evaluate(() =>
    globalThis.document.fonts.ready.then(() => undefined)
  );
  await settleTransitions(page);
}

/**
 * Captures every route of `routes` six ways into `outDir`, and reads each
 * view.
 *
 * Each view has a browser context of its own, opened with the stored session,
 * the viewport, and the scheme both as the system preference and as the
 * admin's stored choice. A route that fails any view keeps none of its
 * captures: half a set would read as the whole of it.
 *
 * @returns {Promise<{ captures: Array<{ route: string, width: number, scheme: string, file: string, path: string }>,
 *   failures: string[], findings: string[] }>}
 */
export async function captureRoutes({
  browser,
  baseURL,
  routes,
  full,
  outDir,
  storageState,
}) {
  const captures = [];
  const failures = [];
  const findings = [];
  for (const route of routes) {
    const made = [];
    const seen = [];
    let failure = null;
    for (const step of capturePlan([route])) {
      const context = await browser.newContext({
        baseURL,
        storageState,
        viewport: step.viewport,
        colorScheme: step.scheme,
      });
      try {
        await context.addInitScript(
          ([key, value]) => globalThis.localStorage.setItem(key, value),
          [THEME_STORAGE_KEY, step.scheme]
        );
        const page = await context.newPage();
        const response = await page.goto(route, { waitUntil: "load" });
        await settle(page, step.scheme);
        // No response is a same-document navigation, which answered by definition.
        failure = routeFailure({
          route,
          status: response?.status() ?? 200,
          finalUrl: page.url(),
        });
        if (failure) break;
        const file = path.join(outDir, step.file);
        await page.screenshot({ path: file, fullPage: full });
        made.push({
          route,
          width: step.width,
          scheme: step.scheme,
          file: step.file,
          path: file,
        });
        for (const finding of await checkPage(page)) {
          seen.push(
            describeFinding(`${route} ${step.width} ${step.scheme}`, finding)
          );
        }
      } finally {
        await context.close();
      }
    }
    if (failure) {
      for (const capture of made) rmSync(capture.path, { force: true });
      failures.push(failure);
      continue;
    }
    captures.push(...made);
    findings.push(...seen);
  }
  return { captures, failures, findings };
}
