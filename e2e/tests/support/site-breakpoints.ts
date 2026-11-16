/**
 * Store the site's breakpoints the one way they change: the page builder's
 * Settings route. The `site-style` Single refuses a write that changes them
 * any other way, so a spec seeding a site's devices goes where Settings does.
 *
 * @module tests/support/site-breakpoints
 */
import { expect, type APIRequestContext } from "@playwright/test";

const ROUTE =
  "/admin/api/plugins/@nextlyhq/plugin-page-builder/site/breakpoints";

/** A breakpoint set as the route takes it, or `null` to clear the stored one. */
export type SiteBreakpoints = {
  viewport: { id: string; label: string; maxWidth?: number }[];
  container: { id: string; label: string; maxWidth?: number }[];
} | null;

/** Store the set, signed in as the request's session, and fail loudly if refused. */
export async function storeSiteBreakpoints(
  request: APIRequestContext,
  breakpoints: SiteBreakpoints
): Promise<void> {
  const csrf = await request.get("/admin/api/auth/csrf");
  const { token } = (await csrf.json()) as { token: string };
  // A plugin route checks a cookie-authenticated write's origin, which a
  // browser sends and an API request does not: named here as the site's own.
  const origin = new URL(csrf.url()).origin;
  const stored = await request.post(ROUTE, {
    data: { breakpoints },
    headers: { "x-csrf-token": token, origin },
  });
  expect(
    stored.ok(),
    `storing the site's breakpoints: ${stored.status()} ${await stored.text()}`
  ).toBe(true);
}
