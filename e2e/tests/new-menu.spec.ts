/**
 * The "+ New" menu in a browser: one flat list of every type the reader may
 * create, with a search and no headings; and on a 390 px phone, with a type
 * whose name is far longer than the screen, the button stays on screen and
 * the menu opens inside it without scrolling the page sideways.
 *
 * The long name is the collections list's answer rewritten in flight, every
 * collection's singular label made long. The menu's options are checked to
 * carry it, so a run whose rewrite never reached the menu cannot pass as one
 * that fits.
 *
 * @module tests/new-menu.spec
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

test("lists every creatable type once, flat, with a search that narrows it", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const trigger = page.getByTestId("new-menu-trigger");
  await expect(trigger).toHaveAccessibleName("New");
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Create" });
  await expect(menu).toBeVisible();
  const search = menu.getByRole("combobox", { name: "Search what to create" });
  await expect(search).toBeFocused();
  const options = menu.getByRole("option");
  const all = await options.allTextContents();
  expect(all.length).toBeGreaterThan(1);
  expect(new Set(all).size).toBe(all.length);
  // No group headings and no Recent section: one list.
  await expect(menu.locator("[cmdk-group-heading]")).toHaveCount(0);
  await search.fill(all[0]!.slice(0, 3));
  await expect.poll(() => options.count()).toBeLessThanOrEqual(all.length);
  for (const text of await options.allTextContents()) {
    expect(text.toLowerCase()).toContain(all[0]!.slice(0, 3).toLowerCase());
  }
});

test("on a 390 px phone, the button stays on screen and the menu widens nothing, even with a long type name", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await lengthenTypeNames(page);
  await gotoAdmin(page, "/");

  const trigger = page.getByTestId("new-menu-trigger");
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await sideways(page)).toEqual({ room: 0, at: 0 });

  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Create" });
  await expect(menu).toBeVisible();
  // The control: the long name reached the menu. Every type now shares that
  // singular label, so each option also carries its telling-apart label.
  await expect(menu.getByRole("option").first()).toContainText(LONG_NAME);
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  expect(await sideways(page)).toEqual({ room: 0, at: 0 });
});
