/**
 * The Add surfaces as an author sees them: the in-place picker is drawn solid
 * on the editor's panel, in light and dark; its "Adding …" line is never under
 * its search field; and a tile the place refuses keeps a name that reads.
 *
 * Asserted in the browser, against computed styles and laid-out boxes, since
 * the picker is portalled out of the chrome and only a real page resolves the
 * tokens it paints with.
 *
 * @module tests/builder-add-picker-surface
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin, type Theme } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const BOX = "00000000-0000-4000-8000-00000000c001";

/** A draft page holding `nodes`, by its id. */
async function createPage(
  request: APIRequestContext,
  nodes: readonly unknown[]
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Add picker ${stamp}`,
      slug: `add-picker-${stamp}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

async function openBuilder(page: Page, id: string, theme: Theme) {
  await gotoAdmin(
    page,
    `/collections/pages/${id}/builder?field=content`,
    theme
  );
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

function picker(page: Page) {
  return page.getByRole("dialog", { name: "Add a block" });
}

/**
 * A computed colour's alpha: 0 for see-through, 1 for solid. The browser
 * reports a colour in the space it was written in, `rgba(0, 0, 0, 0)` for
 * none and `lab(…)` or `oklch(…)` for the tokens, with any alpha after a `/`.
 */
function alphaOf(colour: string): number {
  if (colour === "transparent") return 0;
  const inner = /^[a-z]+\(([^)]*)\)$/.exec(colour.trim())?.[1];
  if (inner === undefined) throw new Error(`not a colour: ${colour}`);
  if (inner.includes("/")) return Number(inner.split("/")[1]?.trim());
  const parts = inner.split(/[\s,]+/).filter(part => part !== "");
  // The legacy comma form carries alpha as a fourth value.
  return parts.length === 4 ? Number(parts[3]) : 1;
}

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("the Add picker and tiles", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const theme of ["light", "dark"] as const) {
    test(`the picker on an empty page is solid, in ${theme}`, async ({
      page,
    }) => {
      const id = await createPage(page.request, []);
      await openBuilder(page, id, theme);
      // The empty page's start area, its starter pages below the button.
      const start = page.locator(".nx-page-start");
      await expect(start).toBeVisible({ timeout: 60_000 });
      await start.getByRole("button", { name: "Add a block" }).click();
      await expect(picker(page)).toBeVisible();

      const background = await picker(page).evaluate(
        element => getComputedStyle(element).backgroundColor
      );
      expect(alphaOf(background), background).toBe(1);
      // The panel's own text colour, not the white a missing token leaves.
      const [text, panel] = await picker(page).evaluate(element => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor];
      });
      expect(text).not.toBe(panel);
    });
  }

  for (const size of [null, { width: 1280, height: 800 }] as const) {
    test(`the "Adding" line is clear of the search field${size === null ? "" : " at 1280x800"}`, async ({
      page,
    }) => {
      if (size !== null) await page.setViewportSize(size);
      const id = await createPage(page.request, [
        {
          id: BOX,
          type: "core/box",
          version: 1,
          props: {},
          slots: { children: [] },
        },
      ]);
      await openBuilder(page, id, "light");
      await page
        .getByRole("button", { name: "Add a block, or drop one here, in Box" })
        .click();
      await expect(picker(page)).toBeVisible();

      const line = picker(page).locator(".nx-insert-picker__line");
      await expect(line).toHaveText("Adding inside Box, at the end");
      const search = await picker(page)
        .locator(".nx-insert-picker__search")
        .boundingBox();
      const words = await line.boundingBox();
      if (search === null || words === null) {
        throw new Error("the picker's search or line has no box");
      }
      expect(words.y).toBeGreaterThanOrEqual(search.y + search.height);
      // And whole: its text is not clipped by its own box.
      expect(
        await line.evaluate(
          element => element.scrollHeight <= element.clientHeight
        )
      ).toBe(true);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`a refused tile's name reads, in ${theme}`, async ({ page }) => {
      const id = await createPage(page.request, [
        {
          id: BOX,
          type: "core/box",
          version: 1,
          props: {},
          slots: { children: [] },
        },
      ]);
      await openBuilder(page, id, theme);
      await canvasFrame(page)
        .locator(`.nx-canvas [data-nx-node="${BOX}"]`)
        .click({ position: { x: 4, y: 4 } });
      const add = page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Add", exact: true });
      if ((await add.getAttribute("aria-pressed")) !== "true")
        await add.click();

      const column = page.getByRole("option", { name: "Column", exact: true });
      await expect(column).toHaveAttribute("data-refused", "true");
      await column.hover();
      await expect(page.locator(".nx-insert-popover__hint")).toContainText(
        "Goes inside"
      );

      const results = await new AxeBuilder({ page })
        .include(".nx-insert-panel [cmdk-item][data-refused='true']")
        .withTags(AA_TAGS)
        .withRules(["color-contrast"])
        .analyze();
      expect(results.violations).toEqual([]);
      // The control: the check reached the refused tiles at all.
      expect(results.passes.length + results.incomplete.length).toBeGreaterThan(
        0
      );
    });
  }
});
