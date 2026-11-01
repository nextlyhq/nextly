import { expect, type Page } from "@playwright/test";

/** The dashboard's layout route, read, written and reset by the specs that place cards. */
const LAYOUT_PATH = "/admin/api/dashboard/layout";

/**
 * The helpers here that write the layout. A spec that calls one writes the dashboard as surely as
 * one that sends the request itself, so `locks-held.test.ts` reads this list to hold such a spec
 * to the dashboard lock. A writer added below without its name here is a write that check misses.
 */
export const LAYOUT_WRITERS = ["resetToDefault"] as const;

/**
 * Which requests are the dashboard's layout read, for a spec that passes it through changed.
 *
 * The admin sends the read the dashboard's width (`?width=`), for the server to judge each card
 * that hides while empty at the tier it is drawn at, so a glob naming the bare path no longer
 * matches it.
 */
export function isLayoutRead(url: URL): boolean {
  return (
    url.pathname.endsWith("/dashboard/layout") &&
    [...url.searchParams.keys()].every(key => key === "width")
  );
}

/**
 * Back to the default dashboard, through the guarded reset a reader uses: the saved layout is
 * dropped at the version just read. A reset that does not land fails the test that made the
 * layout, with the server's answer, rather than passing in silence and leaving that layout to
 * every spec after it on the same server. `origin` is for a spec whose app runs on a server of
 * its own; the suite's server is the default.
 */
export async function resetToDefault(page: Page, origin = ""): Promise<void> {
  const read = await page.request.get(`${origin}${LAYOUT_PATH}`);
  expect(read.ok(), await read.text()).toBe(true);
  const body = (await read.json()) as { version: number; scope: string };
  // Version 0 is no saved layout: the reader already sees the default.
  if (body.version === 0) return;
  const reset = await page.request.delete(
    `${origin}${LAYOUT_PATH}?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
  expect(reset.status(), await reset.text()).toBe(200);
}
