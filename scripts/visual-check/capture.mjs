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
 * network, drawn, and, on an admin screen, in the scheme asked for. Answers
 * whether a screen was drawn at all.
 *
 * The admin is served empty and drawn after hydration, so a visible `main` is
 * the sign it has drawn a screen; a redirect to sign-in ends the wait too, and
 * is judged as such afterwards. A page with no visible `main` by `drawnMs` drew
 * nothing, and is not captured: a capture of it would pass every check, since
 * a blank page has nothing past the edge and nothing for axe to fault. The
 * admin's palette hangs off `.nextly-admin.dark`, applied after mount, so that
 * is awaited too; a page still loading or easing its colours by then is
 * captured as it stands.
 */
async function settle(page, scheme, drawnMs) {
  // The functions handed to the page run there, so they read the page's globals off
  // `globalThis` rather than from this node module's scope.
  await page
    .waitForLoadState("networkidle", { timeout: NETWORK_QUIET_MS })
    .catch(() => undefined);
  const drawn = await page
    .waitForFunction(
      signIn =>
        globalThis.location.pathname.startsWith(signIn) ||
        globalThis.document.querySelector("main")?.checkVisibility() === true,
      SIGN_IN_PATH,
      { timeout: drawnMs }
    )
    .then(
      () => true,
      () => false
    );
  if (drawn && (await page.locator(".nextly-admin").count()) > 0) {
    await page
      .waitForFunction(
        dark =>
          globalThis.document
            .querySelector(".nextly-admin")
            ?.classList.contains("dark") === dark,
        scheme === "dark",
        { timeout: drawnMs }
      )
      .catch(() => undefined);
  }
  await page.evaluate(() =>
    globalThis.document.fonts.ready.then(() => undefined)
  );
  await settleTransitions(page);
  return drawn;
}

/**
 * One view of one route: opened, judged, captured into `outDir` and read.
 * Answers why the route cannot be captured, or the capture and its findings.
 */
async function captureView(context, step, { full, outDir, drawnMs }) {
  const { route } = step;
  await context.addInitScript(
    ([key, value]) => globalThis.localStorage.setItem(key, value),
    [THEME_STORAGE_KEY, step.scheme]
  );
  const page = await context.newPage();
  const response = await page.goto(route, { waitUntil: "load" });
  const drawn = await settle(page, step.scheme, drawnMs);
  // No response is a same-document navigation, which answered by definition.
  const failure =
    routeFailure({
      route,
      status: response?.status() ?? 200,
      finalUrl: page.url(),
    }) ??
    (drawn
      ? null
      : `${route} answered, but drew no visible <main> within ${drawnMs / 1000}s`);
  if (failure) return { failure };
  const file = path.join(outDir, step.file);
  await page.screenshot({ path: file, fullPage: full });
  const capture = {
    route,
    width: step.width,
    scheme: step.scheme,
    file: step.file,
    path: file,
  };
  const where = `${route} ${step.width} ${step.scheme}`;
  const { findings, unread } = await checkPage(page);
  if (unread) return { failure: `${where}: ${unread}`, capture };
  return {
    capture,
    seen: findings.map(finding => describeFinding(where, finding)),
  };
}

/**
 * Captures every route of `routes` six ways into `outDir`, and reads each
 * view.
 *
 * Each view has a browser context of its own, opened with the stored session,
 * the viewport, and the scheme both as the system preference and as the
 * admin's stored choice. A route that fails any view (an error status, a
 * redirect to sign-in, no screen drawn, or nothing axe could judge) keeps none
 * of its captures: half a set would read as the whole of it.
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
  drawnMs = DRAWN_MS,
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
        const view = await captureView(context, step, {
          full,
          outDir,
          drawnMs,
        });
        if (view.capture) made.push(view.capture);
        failure = view.failure ?? null;
        if (failure) break;
        seen.push(...view.seen);
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
