/**
 * A page's entry screen: its sections listed under a large preview, each
 * opening the Page Builder at that section.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * blocks field. Five sections, each tall enough that the fourth starts well
 * below the canvas's first screen, so "scrolled into view" is something the
 * editor did rather than where the page already was — the first case checks
 * exactly that.
 *
 * @module tests/builder-entry-view
 */
import { expect, type Page } from "@playwright/test";

import {
  block,
  openLayers,
  selectedLayers,
  selection,
} from "./canvas/editor-driver";
import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage] });

const HOMEPAGE_API = "/admin/api/singles/homepage";
const FORM_PATH = "/singles/homepage";
const FOURTH = "s4";
const AT_FOURTH =
  /\/admin\/singles\/homepage\/builder\?field=layout&section=s4$/;

/** A section holding a heading and enough prose to be taller than a screen. */
function section(id: string, title: string) {
  const prose = Array.from({ length: 8 }, (_, i) => ({
    id: `${id}-p${i}`,
    type: "core/text",
    version: 1,
    props: {
      text: `${title}, paragraph ${i + 1}. Enough words to wrap across a line or two at the canvas's width, so the section has real height.`,
    },
  }));
  return {
    id,
    type: "core/section",
    version: 1,
    props: {},
    slots: {
      children: [
        {
          id: `${id}-h`,
          type: "core/heading",
          version: 1,
          props: { text: title, level: "h2" },
        },
        ...prose,
      ],
    },
  };
}

const TITLES = ["Welcome", "What we do", "Our work", "Pricing", "Contact"];

async function seedFiveSections(page: Page): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: {
      layout: {
        formatVersion: 1,
        kind: "page",
        nodes: TITLES.map((title, i) => section(`s${i + 1}`, title)),
      },
    },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/** The editor, opened at the fourth section: selected, in Layers, on screen. */
async function expectOpenAtFourth(page: Page): Promise<void> {
  await expect(page).toHaveURL(AT_FOURTH);
  await expect(await block(page, FOURTH)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => selection(page)).toEqual([FOURTH]);
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
  await expect.poll(() => selectedLayers(page)).toEqual([FOURTH]);
  await expect(await block(page, `${FOURTH}-h`)).toBeInViewport();
}

test.describe("a page's entry screen", () => {
  test.beforeEach(async ({ page }) => {
    await seedFiveSections(page);
  });

  test("lists the page's sections under its preview, in page order", async ({
    page,
  }) => {
    await gotoAdmin(page, FORM_PATH);

    const rows = page.getByRole("list", { name: "Sections" }).getByRole("link");
    await expect(rows).toHaveText([
      /^1\s*Section\s*Welcome/,
      /^2\s*Section\s*What we do/,
      /^3\s*Section\s*Our work/,
      /^4\s*Section\s*Pricing/,
      /^5\s*Section\s*Contact/,
    ]);
  });

  test("opening the builder plainly leaves the fourth section off screen", async ({
    page,
  }) => {
    // The control for every case below: without a section in the address the
    // editor opens at the top, and the fourth section is below the fold.
    await gotoAdmin(page, FORM_PATH);
    await page.getByRole("link", { name: "Open Page Builder" }).click();
    await expect(await block(page, "s1")).toBeVisible({ timeout: 30_000 });

    await expect(await block(page, `${FOURTH}-h`)).not.toBeInViewport();
    await expect.poll(() => selection(page)).toEqual([]);
  });

  test("opens the builder at a section from the list", async ({ page }) => {
    await gotoAdmin(page, FORM_PATH);

    await page
      .getByRole("list", { name: "Sections" })
      .getByRole("link", { name: /^Edit section 4, Section: Pricing/ })
      .click();

    await expectOpenAtFourth(page);
  });

  test("opens the builder at a section from the preview", async ({ page }) => {
    await gotoAdmin(page, FORM_PATH);

    await page
      .getByRole("link", { name: /^Section 4, Section: Pricing/ })
      .click();

    await expectOpenAtFourth(page);
  });

  test("opens a section in a new tab on a middle click, leaving the form where it was", async ({
    page,
    context,
  }) => {
    await gotoAdmin(page, FORM_PATH);
    const formUrl = page.url();

    const opened = context.waitForEvent("page");
    await page
      .getByRole("list", { name: "Sections" })
      .getByRole("link", { name: /^Edit section 4/ })
      .click({ button: "middle" });
    const tab = await opened;
    await tab.waitForLoadState();

    await expectOpenAtFourth(tab);
    expect(page.url()).toBe(formUrl);
    await tab.close();
  });

  test("opens with nothing selected when the address names a section the page no longer has", async ({
    page,
  }) => {
    await gotoAdmin(page, `${FORM_PATH}/builder?field=layout&section=gone`);
    await expect(await block(page, "s1")).toBeVisible({ timeout: 30_000 });

    await expect.poll(() => selection(page)).toEqual([]);
    await openLayers(page);
    await expect.poll(() => selectedLayers(page)).toEqual([]);
  });
});
