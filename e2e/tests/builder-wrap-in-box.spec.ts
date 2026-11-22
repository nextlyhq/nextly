/**
 * Wrapping selected blocks in a Box, and unwrapping it again, from the
 * editor's commands.
 *
 * - Three blocks selected side by side and "Wrap blocks in a box" put them, in
 *   order, into a new Box at their place; one Undo puts them back.
 * - With that Box selected, "Unwrap block (keep what's inside)" puts its blocks
 *   back at its place and removes it.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-wrap-in-box.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  clickBlock,
  layerRow,
  openLayers,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const A = "00000000-0000-4000-8000-0000000b0a01";
const B = "00000000-0000-4000-8000-0000000b0a02";
const C = "00000000-0000-4000-8000-0000000b0a03";

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

async function createPage(request: APIRequestContext): Promise<string> {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(PAGES, {
    data: {
      title: `Wrap in a box ${run}`,
      slug: `wrap-in-a-box-${run}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [heading(A, "First"), heading(B, "Second"), heading(C, "Third")],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Run a command from the editor's search by its words. */
async function runCommand(page: Page, words: string): Promise<void> {
  await page.getByRole("button", { name: "Search and commands" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill(words);
  await palette.getByRole("option", { name: new RegExp(words, "i") }).first().click();
  await expect(palette).toBeHidden();
}

test.describe("wrapping blocks in a box", () => {
  test.describe.configure({ timeout: 180_000 });

  test("wraps three blocks in order as one step, and unwraps them again", async ({
    page,
  }) => {
    await openBuilder(page, await createPage(page.request));
    await clickBlock(page, A);
    await clickBlock(page, B, ["Shift"]);
    await clickBlock(page, C, ["Shift"]);
    await expect.poll(async () => (await selection(page)).length).toBe(3);

    await runCommand(page, "Wrap blocks in a box");
    // The new Box is selected, at their place, holding the three in order.
    await expect.poll(async () => (await selection(page)).length).toBe(1);
    const [box] = await selection(page);
    if (box === undefined || [A, B, C].includes(box)) throw new Error("no Box selected");
    const wrapped = [box, `${box}>${A}`, `${box}>${B}`, `${box}>${C}`];
    await expect.poll(() => structure(page)).toEqual(wrapped);

    // One Undo: back as they were.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => structure(page)).toEqual([A, B, C]);

    // Again, then unwrap the Box it made: its blocks at its place, Box gone.
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(() => structure(page)).toEqual(wrapped);
    // Selected by its Layers row: a click on the canvas lands on a heading.
    await openLayers(page);
    await layerRow(page, box).locator(`[data-nx-layer="${box}"]`).first().click();
    await expect.poll(() => selection(page)).toEqual([box]);
    await runCommand(page, "Unwrap block");
    await expect.poll(() => structure(page)).toEqual([A, B, C]);
  });
});
