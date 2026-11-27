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
 * reports a colour in the space it was written in: `rgba(0, 0, 0, 0)` for
 * none, `lab(…)`, `oklch(…)` or `color(srgb …)` for the tokens, with any
 * alpha after a `/`. Only the legacy `rgba(r, g, b, a)` carries it otherwise.
 */
function alphaOf(colour: string): number {
  if (colour === "transparent") return 0;
  const call = /^([a-z]+)\(([^)]*)\)$/.exec(colour.trim());
  if (call === null) throw new Error(`not a colour: ${colour}`);
  const [, name, inner = ""] = call;
  if (inner.includes("/")) return Number(inner.split("/")[1]?.trim());
  if (name !== "rgba") return 1;
  const parts = inner.split(",").map(part => part.trim());
  return parts.length === 4 ? Number(parts[3]) : 1;
}

/** The colour the editor's own chrome resolves its panel token to. */
async function chromePanel(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const chrome = document.querySelector(".nx-builder-chrome");
    if (chrome === null) throw new Error("no editor chrome");
    const probe = document.createElement("div");
    probe.style.background = "var(--nx-builder-panel)";
    chrome.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
}

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
      // The editor's own panel in this theme, as its chrome draws it: not a
      // light panel under the dark theme, nor anything else opaque.
      expect(background).toBe(await chromePanel(page));
    });
  }

  test("the picker's panel differs between light and dark", async ({
    page,
  }) => {
    const id = await createPage(page.request, []);
    const panels: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      await openBuilder(page, id, theme);
      const start = page.locator(".nx-page-start");
      await expect(start).toBeVisible({ timeout: 60_000 });
      await start.getByRole("button", { name: "Add a block" }).click();
      await expect(picker(page)).toBeVisible();
      panels.push(
        await picker(page).evaluate(
          element => getComputedStyle(element).backgroundColor
        )
      );
    }
    expect(panels[0]).not.toBe(panels[1]);
  });

  test("a tile's name breaks only between words with the panel at its narrowest", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const id = await createPage(page.request, []);
    await openBuilder(page, id, "light");
    const add = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
    const divider = page.getByRole("separator", { name: "Panel and canvas" });
    await divider.focus();
    await page.keyboard.press("Home");
    const panel = page.locator(".nx-insert-panel");
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
      .toBeLessThanOrEqual(240);

    const labels = page.locator(".nx-insert-panel__label");
    // The control: the names are there, "Table of contents" among them.
    await expect(labels.first()).toBeVisible();
    expect(await labels.count()).toBeGreaterThan(10);
    // Every word of every name laid out on one line: a word broken across
    // two lines has two boxes.
    const broken = await labels.evaluateAll(elements =>
      elements.flatMap(element => {
        const text = element.textContent ?? "";
        const node = element.firstChild;
        if (node === null) return [];
        return [...text.matchAll(/\S+/g)]
          .filter(word => {
            const range = element.ownerDocument.createRange();
            range.setStart(node, word.index);
            range.setEnd(node, word.index + word[0].length);
            return range.getClientRects().length > 1;
          })
          .map(word => `${word[0]} in "${text}"`);
      })
    );
    expect(broken).toEqual([]);
  });

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

      // The name in the same colour as an addable tile's, and only the mark
      // grayed: a greyed name that still passes contrast is not enough.
      const look = (option: string) =>
        page
          .getByRole("option", { name: option, exact: true })
          .evaluate(element => {
            const label = element.querySelector(".nx-insert-panel__label");
            const mark = element.querySelector(".nx-block-icon");
            if (label === null || mark === null) throw new Error("no tile");
            return {
              name: getComputedStyle(label).color,
              mark: getComputedStyle(mark).color,
            };
          });
      const refused = await look("Column");
      const addable = await look("Heading");
      expect(refused.name).toBe(addable.name);
      expect(refused.mark).not.toBe(addable.mark);

      const results = await new AxeBuilder({ page })
        .include(".nx-insert-panel [cmdk-item][data-refused='true']")
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
