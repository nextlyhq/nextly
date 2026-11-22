/**
 * "Clean up unused…" on the Colours tab, in the browser.
 *
 * - Every colour the site made that nothing uses is listed, ticked, with
 *   "Remove 2 colours", and no built-in colour; confirming removes both in
 *   one step, which Undo and Redo reverse.
 * - A colour a page starts using while the dialog is open is kept, named
 *   with where it is used, and the rest are removed.
 * - The clean-up is reached and used with the keyboard alone.
 * - At the panel's narrowest the control fits and the dialog stays in the
 *   window, in light and dark; the Colours tab passes the accessibility scan.
 * - A role that may read Design but not change it is offered no clean-up,
 *   and the route refuses it.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  OPEN_BUILDER_ACTION,
  openEditorWith,
  PAGE_BUILDER_CARD,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const PAGES = "/admin/api/collections/pages/entries";
const CLEAN_UP =
  "/admin/api/plugins/@nextlyhq/plugin-page-builder/variables/clean-up";

/** A colour the site made, which nothing uses. */
const colour = (name: string, label: string, light: string) => ({
  name: `color.${name}`,
  label,
  kind: "color",
  values: { light },
});
const SPARE_ONE = colour("spare-one", "Spare one", "#3a7d44");
const SPARE_TWO = colour("spare-two", "Spare two", "#9b2c6f");

const NODES = [
  {
    id: "cleanup-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the colour clean-up" },
  },
];

interface StoredSet {
  tokens?: { name: string }[];
}

async function storedTokens(api: APIRequestContext): Promise<StoredSet | null> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredSet | null;
}

/** The names of the colours the site stores, as the server reads them. */
async function storedNames(api: APIRequestContext): Promise<string[]> {
  return ((await storedTokens(api))?.tokens ?? []).map(token => token.name);
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** The Design panel's Colours tab, opened. */
async function openColours(page: Page) {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Colours/ }).click();
  return panel;
}

/** The colour rows the Colours tab lists, by the name shown. */
function listed(panel: ReturnType<Page["getByRole"]>): Promise<string[]> {
  return panel
    .locator('[data-group="colours"] .nx-vars__row .nx-vars__name')
    .allTextContents();
}

/** The clean-up's dialog, opened once both spare colours are listed in it. */
async function openCleanUp(page: Page) {
  const panel = await openColours(page);
  await panel.getByRole("button", { name: "Clean up unused…" }).click();
  const dialog = page.getByRole("dialog", { name: "Clean up unused colours" });
  await expect(dialog.getByRole("checkbox", { name: "Spare two" })).toBeVisible(
    { timeout: 30_000 }
  );
  return { panel, dialog };
}

test("lists the colours the site made that nothing uses, removes them in one step, and Undo and Redo reverse it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: [SPARE_ONE, SPARE_TWO] });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "cleanup-text");
    // The control: Primary is a colour the list holds, read before the
    // dialog, which hides the panel from role queries while it is open.
    await expect
      .poll(async () => listed(await openColours(page)))
      .toContain("Primary");
    const { panel, dialog } = await openCleanUp(page);

    const boxes = dialog.getByRole("checkbox");
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toHaveAccessibleName("Spare one");
    await expect(boxes.nth(1)).toHaveAccessibleName("Spare two");
    for (const box of await boxes.all()) {
      await expect(box).toHaveAttribute("aria-checked", "true");
    }
    // ... and never offered.
    await expect(dialog.getByRole("checkbox", { name: "Primary" })).toHaveCount(
      0
    );

    await dialog.getByRole("button", { name: "Remove 2 colours" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => storedNames(page.request))
      .not.toEqual(expect.arrayContaining(["color.spare-one"]));
    expect(await storedNames(page.request)).not.toContain("color.spare-two");
    await expect.poll(() => listed(panel)).not.toContain("Spare one");
    expect(await listed(panel)).not.toContain("Spare two");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(() => storedNames(page.request))
      .toEqual(expect.arrayContaining(["color.spare-one", "color.spare-two"]));
    await expect.poll(() => listed(panel)).toContain("Spare one");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(() => storedNames(page.request))
      .not.toContain("color.spare-one");
    expect(await storedNames(page.request)).not.toContain("color.spare-two");
  } finally {
    await seed(page, before);
  }
});

test("keeps a colour a page started using while the dialog was open, naming where, and removes the rest", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page.request);
  let created: string | undefined;
  try {
    await seed(page, { tokens: [SPARE_ONE, SPARE_TWO] });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "cleanup-text");
    const { dialog } = await openCleanUp(page);

    // Another author's page starts using Spare two meanwhile.
    const title = `Uses spare two ${Date.now()}`;
    const saved = await page.request.post(PAGES, {
      data: {
        title,
        slug: `uses-spare-two-${Date.now()}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "uses",
              type: "core/text",
              version: 1,
              props: { text: "Coloured" },
              styles: {
                base: { base: { color: { $token: "color.spare-two" } } },
              },
            },
          ],
        },
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    created = ((await saved.json()) as { item: { id: string } }).item.id;

    await dialog.getByRole("button", { name: "Remove 2 colours" }).click();
    await expect(dialog.getByText("Removed 1 colour.")).toBeVisible();
    await expect(dialog.getByText("Kept, as it's in use now:")).toBeVisible();
    await expect(
      dialog.getByText(`Spare two is used on ${title}.`)
    ).toBeVisible();
    const names = await storedNames(page.request);
    expect(names).toContain("color.spare-two");
    expect(names).not.toContain("color.spare-one");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
  } finally {
    if (created !== undefined) await page.request.delete(`${PAGES}/${created}`);
    await seed(page, before);
  }
});

test("is reached and used with the keyboard alone", async ({ page }) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: [SPARE_ONE, SPARE_TWO] });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "cleanup-text");
    const panel = await openColours(page);
    // From the filter, the next stop is the clean-up.
    await panel.getByRole("radio", { name: "All" }).focus();
    await page.keyboard.press("Tab");
    const open = panel.getByRole("button", { name: "Clean up unused…" });
    await expect(open).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Clean up unused colours",
    });
    const spareOne = dialog.getByRole("checkbox", { name: "Spare one" });
    await expect(spareOne).toBeVisible({ timeout: 30_000 });
    // Escape closes it and hands focus back.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(spareOne).toBeVisible({ timeout: 30_000 });
    for (let step = 0; step < 10; step += 1) {
      if (await spareOne.evaluate(box => box === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(spareOne).toBeFocused();
    await page.keyboard.press("Space");
    await expect(spareOne).toHaveAttribute("aria-checked", "false");
    const remove = dialog.getByRole("button", { name: "Remove 1 colour" });
    for (let step = 0; step < 10; step += 1) {
      if (await remove.evaluate(button => button === document.activeElement)) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(remove).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => storedNames(page.request))
      .not.toContain("color.spare-two");
    expect(await storedNames(page.request)).toContain("color.spare-one");
  } finally {
    await seed(page, before);
  }
});

test("at the panel's narrowest the control fits and the dialog stays in the window, in light and dark", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: [SPARE_ONE, SPARE_TWO] });
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openEditorWith(page, NODES, "cleanup-text");
      if (theme === "dark") {
        await gotoAdmin(page, "/singles/homepage", "dark");
        await page
          .locator(PAGE_BUILDER_CARD)
          .getByRole("link", { name: OPEN_BUILDER_ACTION })
          .click();
      }
      const panel = await openColours(page);
      const divider = page.getByRole("separator", { name: "Panel and canvas" });
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
        .toBeLessThanOrEqual(240);
      const open = panel.getByRole("button", { name: "Clean up unused…" });
      await expect(open).toBeVisible();
      const sideways = await panel.evaluate(element => {
        const scrolled = [element, ...element.querySelectorAll("*")].find(
          each =>
            each.scrollWidth > each.clientWidth + 1 &&
            getComputedStyle(each).overflowX !== "visible" &&
            getComputedStyle(each).textOverflow !== "ellipsis" &&
            // Text only a screen reader reads sits in a 1px box that is never
            // drawn, so nobody can scroll it; anything drawn is still checked.
            !(each.clientWidth <= 1 && each.clientHeight <= 1)
        );
        return scrolled === undefined ? null : scrolled.className;
      });
      expect(
        sideways,
        "nothing in the Colours tab scrolls sideways"
      ).toBeNull();
      await expectNoAxeViolations(page, {
        include: '[aria-label="Design panel"]',
      });
      await open.click();
      const dialog = page.getByRole("dialog", {
        name: "Clean up unused colours",
      });
      await expect(
        dialog.getByRole("checkbox", { name: "Spare two" })
      ).toBeVisible({ timeout: 30_000 });
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
        expect(box.y + box.height).toBeLessThanOrEqual(720);
      }
      await page.keyboard.press("Escape");
    }
  } finally {
    await seed(page, before);
  }
});

test("a role that may read Design but not change it is offered no clean-up, and the route refuses it", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const before = await storedTokens(page.request);
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  try {
    await seed(page, { tokens: [SPARE_ONE, SPARE_TWO] });
    const created = await page.request.post(PAGES, {
      data: {
        title: "Clean-up read-only",
        slug: `cleanup-read-only-${Date.now()}`,
        content: { formatVersion: 1, kind: "page", nodes: NODES },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const pageId = ((await created.json()) as { item: { id: string } }).item.id;
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(view, `/collections/pages/${pageId}/builder?field=content`);
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });
    const panel = await openColours(view);
    // The control: the filter is drawn, so the clean-up's absence is the
    // role's doing.
    await expect(
      panel.getByRole("radiogroup", { name: "Show colours" })
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Clean up unused…" })
    ).toHaveCount(0);

    const refused = await reader.context.request.post(CLEAN_UP, {
      headers: await writeHeaders(reader.context.request),
      data: { ids: ["color.spare-one"] },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect(await storedNames(page.request)).toContain("color.spare-one");
    await page.request.delete(`${PAGES}/${pageId}`);
  } finally {
    await reader.context.close();
    await seed(page, before);
  }
});
