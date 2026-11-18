/**
 * Every core block starts visible and real.
 *
 * Each block the Add panel offers is added, in turn, to an empty page with its
 * defaults, and:
 *
 * - it draws at a visible size, never a 0px line;
 * - where the blocks spec gives it real-looking content, it shows it (a
 *   Heading's "A section title", a Text's "A paragraph of text.", a List's
 *   "First" and "Second"); a block that starts empty says what to do next
 *   instead, or asks on the canvas (the Columns and Collection list pickers);
 * - adding it fails no request, so no block asks for a missing file.
 *
 * Its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-every-block-starts.spec
 */
import { expect, type Page } from "@playwright/test";

import { selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

/** The words a block's defaults must show, where the blocks spec names them. */
const STARTS_WITH: Readonly<Record<string, readonly string[]>> = {
  Heading: ["A section title"],
  Text: ["A paragraph of text."],
  List: ["First", "Second"],
};

/** An empty draft page, and its id. */
async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Every block ${stamp}`,
      slug: `every-block-${stamp}`,
      status: "draft",
      noHeaderFooter: true,
      content: { formatVersion: 1, kind: "page", nodes: [] },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

function railButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

/** The Add panel's block tiles, by name, in the order it offers them. */
async function blockTiles(page: Page): Promise<string[]> {
  const add = railButton(page, "Add");
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
  const names = await page
    .getByRole("listbox")
    .first()
    .getByRole("option")
    .evaluateAll(options =>
      // A tile's first line is its name, as the panel draws it.
      options.map(
        option => (option as HTMLElement).innerText.split("\n")[0]?.trim() ?? ""
      )
    );
  // The suite's own fixture blocks, which only a test setup registers, are
  // not core blocks.
  return names.filter(name => name !== "" && !name.startsWith("Test fixture"));
}

test("every core block starts at a visible size, real or with its next step, and fails no request", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const failed: string[] = [];
  page.on("response", response => {
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", request => {
    // A read the editor stopped itself, as a newer one replaces it, is not a
    // missing file.
    if (request.failure()?.errorText.includes("ERR_ABORTED") === true) return;
    failed.push(
      `failed ${request.url()} ${request.failure()?.errorText ?? ""}`
    );
  });

  const id = await createPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  const tiles = await blockTiles(page);
  expect(tiles.length, "the Add panel offers blocks").toBeGreaterThan(10);

  const problems: string[] = [];
  for (const name of tiles) {
    // Nothing selected, so each block is added at the end of the page.
    for (
      let press = 0;
      press < 4 && (await selection(page)).length > 0;
      press++
    ) {
      await page.keyboard.press("Escape");
    }
    const before = failed.length;
    const tile = page.getByRole("option", { name, exact: true }).first();
    await tile.click();
    // A block that only goes inside another (a Column, an accordion's item)
    // adds nothing on its own; its tile says where it goes instead.
    const added = await expect
      .poll(async () => (await selection(page))[0], { timeout: 3_000 })
      .not.toBeUndefined()
      .then(async () => (await selection(page))[0])
      .catch(() => undefined);
    if (added === undefined) {
      // Its tile says where it goes: in its accessible description (the
      // tooltip it is described by) or its own words.
      const describedWhere = await expect(tile)
        .toHaveAccessibleDescription(/goes inside/i, { timeout: 1_000 })
        .then(() => true)
        .catch(() => false);
      if (!describedWhere && !/goes inside/i.test(await tile.innerText())) {
        problems.push(
          `${name}: nothing was added, and the tile says nothing of where it goes`
        );
      }
      continue;
    }
    const block = canvasBlock(page, added).first();
    await expect(block).toBeVisible();
    const box = await block.boundingBox();
    // Visible: never 0px either way. A Divider is rightly a 1px line.
    if (box === null || box.height < 1 || box.width < 1) {
      problems.push(
        `${name}: drawn at ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}px`
      );
    }
    // The blocks that start with parts of their own, as the spec counts them.
    const parts: Readonly<Record<string, [string, number]>> = {
      Accordion: ["summary", 3],
      Form: ["input, textarea, select", 3],
    };
    const counted = parts[name];
    if (counted !== undefined) {
      const found = await block.locator(counted[0]).count();
      if (found < counted[1]) {
        problems.push(`${name}: starts with ${found}, not ${counted[1]}`);
      }
    }
    if (name === "Quote" && (await block.innerText()).trim() === "") {
      problems.push("Quote: starts with no words");
    }
    for (const words of STARTS_WITH[name] ?? []) {
      if (!(await block.innerText()).includes(words)) {
        problems.push(`${name}: does not start with "${words}"`);
      }
    }
    // A picker the block asks with on the canvas is its next step; leave it.
    await page.keyboard.press("Escape");
    for (const failure of failed.slice(before)) {
      problems.push(`${name}: ${failure}`);
    }
  }
  expect(problems).toEqual([]);
});
