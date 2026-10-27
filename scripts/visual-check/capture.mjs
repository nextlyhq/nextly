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
import { SESSION_MAX_AGE_MS } from "../../e2e/tests/support/session.mjs";

import { capturePlan } from "./options.mjs";
import {
  checkPage,
  describeFinding,
  isPublicRoute,
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
  // Outside the admin's root there is no palette of its own to wait for: the
  // emulated system scheme is already the page's.
  let schemeShown = true;
  if (drawn && (await page.locator(".nextly-admin").count()) > 0) {
    schemeShown = await page
      .waitForFunction(
        dark =>
          globalThis.document
            .querySelector(".nextly-admin")
            ?.classList.contains("dark") === dark,
        scheme === "dark",
        { timeout: drawnMs }
      )
      .then(
        () => true,
        () => false
      );
  }
  await page.evaluate(() =>
    globalThis.document.fonts.ready.then(() => undefined)
  );
  await settleTransitions(page);
  return { drawn, schemeShown };
}

/**
 * Why a view that answered cannot be captured, or null: no screen drawn, or
 * an admin that never showed the scheme asked for, which would publish a
 * light capture labelled dark, or the other way round.
 */
function settledFailure(
  { drawn, schemeShown },
  { route, scheme },
  where,
  drawnMs
) {
  const within = `within ${drawnMs / 1000}s`;
  if (!drawn) return `${route} answered, but drew no visible <main> ${within}`;
  if (!schemeShown)
    return `${where}: the admin did not show the ${scheme} scheme ${within}`;
  return null;
}

/**
 * Runs the author's `--prepare` on a settled view, to stage what the capture
 * should show (a dialog, a menu, a sheet), and lets what it opened settle.
 * Answers why it failed, or null.
 */
async function prepared(page, step, prepare, where) {
  if (!prepare) return null;
  try {
    await prepare(page, {
      route: step.route,
      width: step.width,
      scheme: step.scheme,
    });
    await settleTransitions(page);
    return null;
  } catch (error) {
    const said =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    return `${where}: --prepare failed: ${said}`;
  }
}

/**
 * One view of one route: opened, judged, staged by `--prepare`, captured into
 * `outDir` and read. Answers why the route cannot be captured, or the capture
 * and its findings.
 */
async function captureView(context, step, { full, outDir, drawnMs, prepare }) {
  const { route } = step;
  const where = `${route} ${step.width} ${step.scheme}`;
  await context.addInitScript(
    ([key, value]) => globalThis.localStorage.setItem(key, value),
    [THEME_STORAGE_KEY, step.scheme]
  );
  const page = await context.newPage();
  const response = await page.goto(route, { waitUntil: "load" });
  const settled = await settle(page, step.scheme, drawnMs);
  // No response is a same-document navigation, which answered by definition.
  const failure =
    routeFailure({
      route,
      status: response?.status() ?? 200,
      finalUrl: page.url(),
    }) ??
    settledFailure(settled, step, where, drawnMs) ??
    (await prepared(page, step, prepare, where));
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
  const { findings, unread } = await checkPage(page);
  if (unread) return { failure: `${where}: ${unread}`, capture };
  return {
    capture,
    seen: findings.map(finding => describeFinding(where, finding)),
  };
}

/**
 * Every view of one route, stopping at the first that fails. A public screen
 * (one the admin lists as reachable without a session) is opened signed out,
 * as its visitors see it; any other is opened with the session, renewed
 * first when it is old enough to expire.
 */
async function captureRoute(
  route,
  { browser, baseURL, storageState, renew, ...view }
) {
  const signedIn = !isPublicRoute(route);
  const made = [];
  const seen = [];
  for (const step of capturePlan([route])) {
    if (signedIn) await renew?.();
    const context = await browser.newContext({
      baseURL,
      storageState: signedIn ? storageState : undefined,
      viewport: step.viewport,
      colorScheme: step.scheme,
    });
    try {
      const result = await captureView(context, step, view);
      if (result.capture) made.push(result.capture);
      if (result.failure) return { made, seen, failure: result.failure };
      seen.push(...result.seen);
    } finally {
      await context.close();
    }
  }
  return { made, seen, failure: null };
}

/**
 * Captures every route of `routes` six ways into `outDir`, and reads each
 * view.
 *
 * Each view has a browser context of its own, opened with the viewport, the
 * scheme both as the system preference and as the admin's stored choice, and
 * the session unless the route is public. A route that fails any view (an
 * error status, a redirect to sign-in, no screen drawn, the scheme not shown,
 * a failed `--prepare`, or nothing axe could judge) keeps none of its
 * captures: half a set would read as the whole of it.
 *
 * @returns {Promise<{ captures: Array<{ route: string, width: number, scheme: string, file: string, path: string }>,
 *   failures: string[], findings: string[] }>}
 */
export async function captureRoutes({
  routes,
  drawnMs = DRAWN_MS,
  ...options
}) {
  const captures = [];
  const failures = [];
  const findings = [];
  for (const route of routes) {
    const { made, seen, failure } = await captureRoute(route, {
      ...options,
      drawnMs,
    });
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

/**
 * A check, run before each signed-in view, that signs in again once the
 * session is older than the e2e suite's safe age for it: its access token
 * lives fifteen minutes, and a long batch of views outlasts that. Starts
 * from a session signed in at the moment it is made.
 */
export function sessionRenewer({
  baseURL,
  file,
  signIn,
  now = Date.now,
  maxAgeMs = SESSION_MAX_AGE_MS,
}) {
  let signedInAt = now();
  return async () => {
    if (now() - signedInAt <= maxAgeMs) return;
    await signIn(baseURL, file);
    signedInAt = now();
  };
}
