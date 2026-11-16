/**
 * A block locked in Layers, in the real editor, saved through the real API.
 *
 * - Every path refuses a locked block, and a block inside one, up front and
 *   says why: Layers, the canvas drag, the block toolbar, the keyboard and
 *   the inspector. A click still selects a locked block, so it can be
 *   unlocked.
 * - Unlocking a block and changing it saves as one write and one "Saved",
 *   with the history untouched by the save and both changes stored.
 * - A save that fails stores nothing and keeps the editor's work, with Retry,
 *   which stores it.
 * - A block the saved page still holds locked cannot be deleted until its
 *   unlock is saved: Delete says "Save first", and works after a save.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  announcer,
  block,
  boxOf,
  clickBlock,
  layerRow,
  openLayers,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasLayer } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";

const HERO = "00000000-0000-4000-8000-0000000b1001";
const TITLE = "00000000-0000-4000-8000-0000000b1002";
const FREE = "00000000-0000-4000-8000-0000000b1003";

const AROUND = "This block is inside Hero, which is locked.";

/** A locked section named Hero holding a heading, then a free heading. */
function document(): unknown {
  const pad = "24px";
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: HERO,
        type: "core/section",
        version: 1,
        name: "Hero",
        locked: true,
        props: { as: "section", contained: true },
        styles: {
          base: {
            base: {
              padding: {
                blockStart: pad,
                blockEnd: pad,
                inlineStart: pad,
                inlineEnd: pad,
              },
            },
          },
        },
        slots: {
          children: [
            {
              id: TITLE,
              type: "core/heading",
              version: 1,
              props: { text: "Locked heading", level: "h2" },
            },
          ],
        },
      },
      {
        id: FREE,
        type: "core/heading",
        version: 1,
        props: { text: "Free heading", level: "h2" },
      },
    ],
  };
}

/** A draft page of its own, holding the document above, and its id. */
async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Layers lock ${stamp}`,
      slug: `layers-lock-${stamp}`,
      status: "draft",
      content: document(),
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The page's stored nodes, read back through the API. */
async function storedNodes(
  request: APIRequestContext,
  id: string
): Promise<Record<string, unknown>[]> {
  return await storedPageNodes(request, ENTRIES, id);
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(await block(page, TITLE)).toBeVisible({ timeout: 30_000 });
}

/** Select a block by clicking it on the canvas, near its top-left corner. */
async function selectBlock(page: Page, id: string): Promise<void> {
  const box = await boxOf(page, id);
  await page.mouse.click(box.x + 6, box.y + 6);
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** A toolbar button, by its verb, in the chrome drawn over the canvas. */
async function toolbarButton(page: Page, name: string) {
  return canvasLayer(page)
    .getByRole("toolbar", { name: "Block actions" })
    .getByRole("button", { name, exact: true });
}

/** The card menu's Unlock, for the selected block. */
async function unlockFromCard(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Unlock", exact: true }).click();
  await expect(page.locator('[data-lock="layers"]')).toHaveCount(0);
}

/** Whether a request is a write of this collection's entries. */
function isWrite(request: { url(): string; method(): string }): boolean {
  return (
    request.url().includes("/collections/pages/entries") &&
    ["PATCH", "PUT", "POST"].includes(request.method())
  );
}

/** The top bar's save state chip. */
function saveState(page: Page) {
  return page
    .locator('[data-topbar="end"]')
    .locator('[data-testid="save-state-indicator"]');
}

/**
 * Save without publishing from the top bar and wait for it to be stored,
 * counting the writes the one save sends.
 */
async function saveDraft(page: Page): Promise<number> {
  let writes = 0;
  const count = (request: { url(): string; method(): string }) => {
    if (isWrite(request)) writes += 1;
  };
  page.on("request", count);
  const stored = page.waitForResponse(
    response => isWrite(response.request()) && response.ok()
  );
  await pressSave(page);
  await stored;
  await expect(saveState(page)).toHaveText("Saved", { timeout: 30_000 });
  // Settled: anything else this save would send has gone by now.
  await page.waitForLoadState("networkidle");
  page.off("request", count);
  return writes;
}

/** The inspector's Text field for the selected heading. */
function textField(page: Page) {
  // Exact: the Bind button beside the field is labelled "Bind Text to a field".
  return page
    .getByRole("tabpanel", { name: "Content" })
    .getByLabel("Text", { exact: true });
}

test.describe("a block locked in Layers", () => {
  test.describe.configure({ timeout: 180_000 });

  test("is refused up front on every path, with the reason, and still selects", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    // Layers: the locked block says so, and the block inside it says by whom.
    await openLayers(page);
    await expect(layerRow(page, HERO).first()).toContainText("Locked");
    await layerRow(page, HERO).first().press("ArrowRight");
    await expect(layerRow(page, TITLE)).toContainText("Locked by Hero");

    // A click still selects the locked block, so it can be unlocked.
    await selectBlock(page, HERO);
    // The note, the toolbar and the refusal are chrome, drawn over the canvas
    // in the admin's document rather than in the page.
    const scope = canvasLayer(page);
    await expect(scope.locator("[data-lock-note]")).toHaveText("Locked");
    await expect(
      page.getByRole("button", { name: "Actions for Hero" })
    ).toBeVisible();

    // The block inside it: the toolbar, the keyboard and the inspector.
    await clickBlock(page, TITLE);
    await expect.poll(() => selection(page)).toEqual([TITLE]);
    await expect(scope.locator("[data-lock-note]")).toHaveText(
      "Locked by Hero"
    );
    for (const verb of ["Move up", "Move down", "Delete"]) {
      const button = await toolbarButton(page, verb);
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAttribute("title", AROUND);
    }
    await page.keyboard.press("Alt+ArrowDown");
    await expect(announcer(page)).toContainText(AROUND);
    await expect(page.locator('[data-lock="layers-inherited"]')).toContainText(
      "Locked by Hero"
    );
    await expect(textField(page)).toBeDisabled();
    // A segmented choice is held too: a click on another level changes
    // nothing, on screen or stored.
    const level = page
      .getByRole("tabpanel", { name: "Content" })
      .getByRole("radiogroup", { name: "Level" });
    await expect(level.getByRole("radio", { name: "H1" })).toBeDisabled();
    await level.getByRole("radio", { name: "H1" }).click({ force: true });
    await expect(level.getByRole("radio", { name: "H2" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    // The canvas drag: the reason drawn over the block, and nothing moves.
    const from = await boxOf(page, TITLE);
    const to = await boxOf(page, FREE);
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + from.height / 2 + 14, {
      steps: 4,
    });
    await page.mouse.move(to.x + 10, to.y + to.height * 0.8, { steps: 12 });
    await expect(scope.locator(".nx-drop-refusal")).toContainText(AROUND);
    await page.mouse.up();
    await expect(scope.locator(".nx-drop-refusal")).toHaveCount(0);
    const nodes = await storedNodes(page.request, id);
    expect(nodes.map(n => n.id)).toEqual([HERO, FREE]);
    const [title] = (nodes[0]?.slots as { children: Record<string, unknown>[] })
      .children;
    expect(title?.props).toEqual({ text: "Locked heading", level: "h2" });
  });

  test("duplicates a locked block as a locked copy, and refuses a copy inside it", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await openLayers(page);

    // Inside the locked block a copy would change what it holds, so the bar
    // says so before anything is tried.
    await clickBlock(page, TITLE);
    await expect.poll(() => selection(page)).toEqual([TITLE]);
    const inside = await toolbarButton(page, "Duplicate");
    await expect(inside).toHaveAttribute("aria-disabled", "true");
    await expect(inside).toHaveAttribute(
      "title",
      "Hero is locked. Unlock it to add blocks to it."
    );

    // The locked block itself copies, and the copy keeps its lock.
    await selectBlock(page, HERO);
    const duplicate = await toolbarButton(page, "Duplicate");
    await expect(duplicate).not.toHaveAttribute("aria-disabled", "true");
    await duplicate.click();
    // Selection follows the copy, which is what the author works on next.
    await expect
      .poll(async () => {
        const selected = await selection(page);
        return selected.length === 1 && selected[0] !== HERO;
      })
      .toBe(true);
    const [copy] = await selection(page);
    await expect(layerRow(page, copy ?? "").first()).toContainText("Hero copy");
    await expect(layerRow(page, copy ?? "").first()).toContainText("Locked");
  });

  test("saves an unlock and a change to the block in one write, with one Saved, and keeps the history", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await selectBlock(page, HERO);
    await unlockFromCard(page, "Hero");
    await clickBlock(page, TITLE);
    await expect(textField(page)).toBeEnabled();
    await textField(page).fill("Changed heading");
    await textField(page).press("Tab");

    expect(await saveDraft(page)).toBe(1);
    // One save, said once: the chip says "Saved" for the one write.
    await expect(saveState(page)).toHaveText("Saved");

    const [hero] = await storedNodes(page.request, id);
    expect(hero?.locked).toBeUndefined();
    const children = (hero?.slots as { children: Record<string, unknown>[] })
      .children;
    expect(children[0]?.props).toMatchObject({ text: "Changed heading" });

    // The save added no step of its own: one undo takes the text back.
    await (await block(page, FREE)).click();
    await page.keyboard.press("Control+z");
    await clickBlock(page, TITLE);
    await expect(textField(page)).toHaveValue("Locked heading");
  });

  test("keeps the editor's work and stores nothing when the save fails, with Retry", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await selectBlock(page, HERO);
    await unlockFromCard(page, "Hero");
    await clickBlock(page, TITLE);
    await textField(page).fill("Not stored yet");
    await textField(page).press("Tab");

    // The write fails once, as a server would on a bad moment.
    let failed = false;
    await page.route(`**${ENTRIES}/${id}**`, async route => {
      try {
        if (!failed && route.request().method() !== "GET") {
          failed = true;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "INTERNAL_ERROR", message: "Unexpected error." },
            }),
          });
          return;
        }
        await route.fallback();
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    const refused = page.waitForResponse(
      response => isWrite(response.request()) && response.status() === 500
    );
    await pressSave(page);
    await refused;
    const indicator = saveState(page);
    await expect(indicator).toContainText("Not saved", { timeout: 30_000 });
    const retry = indicator.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();

    // Nothing stored changed, and the editor still holds the work.
    const [hero] = await storedNodes(page.request, id);
    expect(hero?.locked).toBe(true);
    await expect(textField(page)).toHaveValue("Not stored yet");

    // Retry stores the unlock and the change in one write.
    const stored = page.waitForResponse(
      response => isWrite(response.request()) && response.ok()
    );
    await retry.click();
    await stored;
    await expect(indicator).toHaveText("Saved", { timeout: 30_000 });
    const [after] = await storedNodes(page.request, id);
    expect(after?.locked).toBeUndefined();
  });

  test("says to save first before deleting a block the saved page still holds locked", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);

    await selectBlock(page, HERO);
    await unlockFromCard(page, "Hero");
    const remove = await toolbarButton(page, "Delete");
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(remove).toHaveAttribute(
      "title",
      "Save first: this block is still locked on the saved page. Save, then delete it."
    );

    expect(await saveDraft(page)).toBe(1);
    await expect(remove).not.toHaveAttribute("aria-disabled", "true");
    await remove.click();
    await expect(await block(page, HERO)).toHaveCount(0);
    expect(await saveDraft(page)).toBe(1);
    expect((await storedNodes(page.request, id)).map(n => n.id)).toEqual([
      FREE,
    ]);
  });
});
