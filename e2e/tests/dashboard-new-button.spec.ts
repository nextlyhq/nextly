/**
 * The dashboard header's New split button on a phone, in a browser: with a type whose name is
 * far longer than a 390 px header, the button stays inside the header, its label cut short and
 * its caret whole and on screen, and opening its menu neither runs off the screen nor scrolls
 * the page sideways.
 *
 * The long name is the collections list's answer rewritten in flight, every collection's
 * singular label made long, so whichever type the button leads with has it. The label is checked
 * to be cut short, so a run whose rewrite never reached the button cannot pass as one that fits.
 *
 * @module tests/dashboard-new-button.spec
 */
import { expect, type Page, type Route } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Reads the dashboard and its header only, but beside the specs that rearrange it.
test.describe.configure({ lock: [LOCK.dashboard] });

const LONG_NAME =
  "Quarterly regional distributor compliance attestation record";

/** Rewrites every collections list the admin reads so each type's singular label is long. */
async function lengthenTypeNames(page: Page): Promise<void> {
  await page.route(/\/admin\/api\/collections(\?|$)/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // A read still in flight when the test ends fails its fetch. Aborted rather than thrown: a
    // throw out of the handler fails a test that had passed, and its message prints the
    // request, session cookie included.
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => {});
      return;
    }
    const body = (await response.json()) as {
      items?: Array<{ labels?: { singular?: string; plural?: string } }>;
    };
    for (const item of body.items ?? []) {
      item.labels = { ...item.labels, singular: LONG_NAME };
    }
    await route.fulfill({ response, json: body });
  });
}

/** How far the page can scroll sideways, and how far it has. */
async function sideways(page: Page): Promise<{ room: number; at: number }> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { room: root.scrollWidth - root.clientWidth, at: window.scrollX };
  });
}

test("on a 390 px phone, a long type name is cut short, the caret stays on screen, and the menu widens nothing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await lengthenTypeNames(page);
  await gotoAdmin(page, "/");

  const label = page.getByTestId("dashboard-new-primary-label");
  const caret = page.getByTestId("dashboard-new-more");
  await expect(caret).toBeVisible();
  // The control: the long name reached the button, and the button cut it short.
  await expect(page.getByTestId("dashboard-new-primary")).toHaveAttribute(
    "title",
    `New ${LONG_NAME}`
  );
  expect(
    await label.evaluate(element => element.scrollWidth > element.clientWidth)
  ).toBe(true);

  // Inside the header, and the header inside the screen.
  const header = await page.getByTestId("dashboard-header").boundingBox();
  const caretBox = await caret.boundingBox();
  expect(header).not.toBeNull();
  expect(caretBox).not.toBeNull();
  expect(caretBox!.x + caretBox!.width).toBeLessThanOrEqual(
    header!.x + header!.width + 0.5
  );
  expect(caretBox!.x + caretBox!.width).toBeLessThanOrEqual(390);
  expect(await sideways(page)).toEqual({ room: 0, at: 0 });

  // The menu opens inside the screen, and the page has still nowhere to scroll sideways.
  await caret.click();
  const menu = page.locator('[data-slot="popover-content"]');
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  expect(await sideways(page)).toEqual({ room: 0, at: 0 });
});
