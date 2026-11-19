/**
 * The Styles tab's Block styles section, in the builder, as an author uses it.
 *
 * - "+ New button style" asks for a name, makes "Ghost" from the ★ style's
 *   values and opens it in the style editor; a button can then wear it.
 * - A style the site made is renamed, duplicated and removed; one in use is
 *   refused, saying where: the panel names this page's blocks, and the route
 *   names the document.
 * - A built-in style (Button "Text") is hidden: the block panel stops
 *   offering it, a button already wearing it keeps it and says "Hidden", and
 *   it is shown again.
 * - "Set as default ★" moves the ★ between styles of one type.
 * - Every action is reached from the keyboard, Escape closing the innermost
 *   thing and never the canvas selection.
 * - At the panel's narrowest, rows don't scroll sideways and a row's ⋯ menu
 *   opens inside the window; the section passes the accessibility scan in
 *   light and dark.
 * - A role that may not change Design sees the section with no action, and
 *   its writes are refused.
 * - Undo and Redo reverse a block style's rename.
 * - The style editor's State switch moves to Hover, with no block selected.
 *
 * Safe to write against: the suite owns its database. The homepage and the
 * site's stored styles are put back after each test.
 *
 * @module builder-block-styles.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  clickBlock,
  emptyHomepage,
  layerRow,
  OPEN_BUILDER_ACTION,
  openEditorWith,
  PAGE_BUILDER_CARD,
  openLayers,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const HOMEPAGE = "/admin/api/singles/homepage";
const PAGES = "/admin/api/collections/pages/entries";
const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";

const TEXT_ID = "look:core/button:text";
const OUTLINE_ID = "look:core/button:outline";

/** A button block, wearing the block styles given. */
function button(id: string, label: string, classes?: readonly string[]) {
  return {
    id,
    type: "core/button",
    version: 1,
    props: { label },
    ...(classes === undefined ? {} : { classes: [...classes] }),
  };
}

/** A block style the site made, for Button. */
function siteButtonStyle(id: string, label: string, slug: string) {
  return {
    id,
    slug,
    label,
    orderIndex: 100,
    blockType: "core/button",
    styles: { base: { base: { backgroundColor: "#24425c" } } },
  };
}

type Stored = Record<string, unknown>;

/** The stored `classes` section: the site's own styles and its edits. */
async function storedClasses(api: APIRequestContext): Promise<Stored[]> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Stored;
  const item = (body.item ?? body) as Stored;
  return (item.classes as Stored[] | undefined) ?? [];
}

async function storeClasses(
  api: APIRequestContext,
  classes: readonly unknown[]
): Promise<void> {
  const stored = await api.patch(SITE_STYLE, {
    data: { classes, _overwrite: true },
  });
  expect(
    stored.ok(),
    `storing the block styles: ${stored.status()} ${await stored.text()}`
  ).toBe(true);
}

/** The homepage's stored nodes, draft included. */
async function storedNodes(page: Page): Promise<Stored[]> {
  const response = await page.request.get(`${HOMEPAGE}?draft=true`);
  const body = (await response.json()) as Stored;
  const item = (body.item ?? body) as { layout?: { nodes?: Stored[] } };
  return item.layout?.nodes ?? [];
}

/** The next stored write of the site style. */
function styleWrite(page: Page) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname === SITE_STYLE &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

/** Open the Design panel on its Styles tab. */
async function openStyles(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  const restored = await panel
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!restored) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
  const tab = panel.getByRole("tab", { name: /^Styles/ });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(blockStyles(page)).toBeVisible();
}

const blockStyles = (page: Page) =>
  page.getByRole("region", { name: "Block styles" });

const buttonStyles = (page: Page) =>
  blockStyles(page).getByRole("list", { name: "Button styles" });

/** A Button style's row, by the start of its name. */
const styleRow = (page: Page, name: string) =>
  buttonStyles(page).getByRole("button", {
    name: new RegExp(`^${name}(,|$)`),
  });

/** Choose an item in a Button style's ⋯ menu. */
async function chooseFromMenu(
  page: Page,
  name: string,
  item: string
): Promise<void> {
  await buttonStyles(page)
    .getByRole("button", { name: `More actions for ${name}` })
    .click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** The Block style tiles of the selected block, in the Style tab. */
async function lookTiles(page: Page, id: string) {
  // Chosen from Layers, which names each block: a press on a small inline
  // button can land on chrome drawn over it, or start a drag.
  await openLayers(page);
  await layerRow(page, id).locator(`[data-nx-layer="${id}"]`).click();
  await expect.poll(() => selection(page)).toEqual([id]);
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style", exact: true })
    .click();
  const tiles = page.getByRole("radiogroup", { name: "Block style" });
  await expect(tiles).toBeVisible();
  return tiles;
}

/** Each tile's name, without its tags ("Default", "Hidden"). */
const tileNames = (tiles: ReturnType<Page["getByRole"]>) =>
  tiles
    .getByRole("radio")
    .evaluateAll(radios =>
      radios.map(
        radio =>
          radio.querySelector(".nx-look-tile__name")?.firstChild?.textContent ??
          ""
      )
    );

test.describe("block styles in the Styles tab", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await storeClasses(page.request, []);
  });
  test.afterEach(async ({ page }) => {
    // Off the homepage first: a style still in use can't be removed.
    await emptyHomepage(page);
    await storeClasses(page.request, []);
  });

  test("names the two sections with their lines, and never says class", async ({
    page,
  }) => {
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await openStyles(page);
    await expect(
      blockStyles(page).getByText(
        "Saved looks for one kind of block. ★ is the look a block has until you pick another."
      )
    ).toBeVisible();
    const shared = page.getByRole("region", { name: "Shared styles" });
    await expect(
      shared.getByText("Your own styles for any block.")
    ).toBeVisible();
    // Each type ends with its own + New row, Button's among them.
    await expect(
      blockStyles(page).getByRole("button", { name: "+ New button style" })
    ).toBeVisible();
    const text = await page
      .getByRole("region", { name: "Design panel" })
      .innerText();
    expect(text).not.toMatch(/\bclass(es)?\b/i);
  });

  test('makes "Ghost" for Button from the ★ style, opens it, and a button wears it', async ({
    page,
  }) => {
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await openStyles(page);
    await blockStyles(page)
      .getByRole("button", { name: "+ New button style" })
      .click();
    const name = blockStyles(page).getByRole("textbox", {
      name: "New button style name",
    });
    await expect(name).toBeFocused();
    const saved = styleWrite(page);
    await name.fill("Ghost");
    await name.press("Enter");
    await saved;

    // Opened in the style editor, its row chosen.
    await expect(
      page.getByRole("group", { name: "Editing Ghost" })
    ).toBeVisible();
    await expect(styleRow(page, "Ghost")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Stored as the site's own Button style, named as typed.
    const ghost = (await storedClasses(page.request)).find(
      entry => entry.label === "Ghost"
    );
    expect(ghost).toMatchObject({
      slug: "button-ghost",
      blockType: "core/button",
    });
    expect(ghost?.starred).toBeUndefined();

    // A button wears it, picked from its Block style tiles, and keeps it once saved.
    const tiles = await lookTiles(page, "bs-plain");
    await tiles.getByRole("radio", { name: /^Ghost/ }).click();
    await expect(tiles.getByRole("radio", { name: /^Ghost/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await pressSave(page);
    await expect
      .poll(async () => (await storedNodes(page))[0]?.classes)
      .toEqual([ghost?.id]);
  });

  test("renames, duplicates and removes a style the site made, and refuses removing one in use, naming where", async ({
    page,
  }) => {
    const ghost = siteButtonStyle("e2e-ghost", "Ghost", "button-ghost");
    await storeClasses(page.request, [ghost]);
    await openEditorWith(
      page,
      [button("bs-worn", "Worn", [ghost.id])],
      "bs-worn"
    );
    // Counted whole, so a removal answers "in use" or "free", never "not
    // counted yet".
    await countEveryPage(page.request);
    await openStyles(page);

    // Rename: the name only, never its id or class name.
    await chooseFromMenu(page, "Ghost", "Rename");
    const field = blockStyles(page).getByRole("textbox", {
      name: "Rename Ghost",
    });
    await expect(field).toBeFocused();
    const renamed = styleWrite(page);
    await field.fill("Soft ghost");
    await field.press("Enter");
    await renamed;
    await expect(styleRow(page, "Soft ghost")).toBeVisible();
    expect(
      (await storedClasses(page.request)).find(entry => entry.id === ghost.id)
    ).toMatchObject({ label: "Soft ghost", slug: "button-ghost" });

    // Duplicate: a copy of the site's own, opened in the style editor.
    const copied = styleWrite(page);
    await chooseFromMenu(page, "Soft ghost", "Duplicate");
    await copied;
    await expect(
      page.getByRole("group", { name: "Editing Soft ghost copy" })
    ).toBeVisible();
    const copy = (await storedClasses(page.request)).find(
      entry => entry.label === "Soft ghost copy"
    );
    expect(copy).toMatchObject({
      blockType: "core/button",
      styles: ghost.styles,
    });

    // Remove the unused copy: one step.
    await chooseFromMenu(page, "Soft ghost copy", "Remove");
    await expect(styleRow(page, "Soft ghost copy")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await storedClasses(page.request)).map(entry => entry.id)
      )
      .toEqual([ghost.id]);

    // Remove the one a block on this page wears: refused, saying where,
    // before the route is asked, since the page's own blocks may be unsaved.
    await chooseFromMenu(page, "Soft ghost", "Remove");
    const refusal = buttonStyles(page).getByRole("alert");
    await expect(refusal).toHaveText(
      "Soft ghost is used on 1 block on this page. Take it off them first."
    );
    await expect(styleRow(page, "Soft ghost")).toBeVisible();

    // The route refuses it too, listing where, and nothing is removed.
    const refused = await page.request.post(`${PLUGIN}/shared-styles/remove`, {
      headers: await writeHeaders(page.request),
      data: { ids: [ghost.id] },
    });
    expect(refused.status()).toBe(400);
    const body = await refused.text();
    expect(body).toContain('"code":"IN_USE"');
    expect(body).toContain("Soft ghost is used on 1 document: Homepage.");
    expect((await storedClasses(page.request)).map(entry => entry.id)).toEqual([
      ghost.id,
    ]);
  });

  test('hides Button "Text": the tiles stop offering it, a button wearing it keeps it, marked Hidden', async ({
    page,
  }) => {
    await openEditorWith(
      page,
      [
        button("bs-plain", "Plain"),
        // Apart, so one button's floating toolbar never covers the other.
        {
          id: "bs-gap",
          type: "core/text",
          version: 1,
          props: { text: "Between the buttons" },
        },
        button("bs-text", "Texted", [TEXT_ID]),
      ],
      "bs-plain"
    );
    // The controls: before it is hidden, the plain button is offered Text,
    // and the button wearing it shows it chosen.
    expect(await tileNames(await lookTiles(page, "bs-plain"))).toContain(
      "Text"
    );
    await expect(
      (await lookTiles(page, "bs-text")).getByRole("radio", { name: /^Text/ })
    ).toHaveAttribute("aria-checked", "true");

    await openStyles(page);
    // A built-in style is never renamed or removed.
    await buttonStyles(page)
      .getByRole("button", { name: "More actions for Text" })
      .click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Edit",
      "Set as default ★",
      "Duplicate",
      "Hide",
    ]);
    const hidden = styleWrite(page);
    await menu.getByRole("menuitem", { name: "Hide" }).click();
    await hidden;
    await expect(styleRow(page, "Text")).toHaveAccessibleName(
      /^Text, hidden, built-in/
    );
    expect(
      (await storedClasses(page.request)).find(entry => entry.id === TEXT_ID)
    ).toMatchObject({ hidden: true, label: "Text" });

    // Not offered to a button that doesn't wear it.
    expect(await tileNames(await lookTiles(page, "bs-plain"))).not.toContain(
      "Text"
    );
    // Kept by the button wearing it, its tile saying Hidden.
    const worn = await lookTiles(page, "bs-text");
    const tile = worn.getByRole("radio", { name: /^Text/ });
    await expect(tile).toHaveAttribute("aria-checked", "true");
    await expect(tile).toContainText("Hidden");

    // Shown again, it is offered again.
    await openStyles(page);
    const shown = styleWrite(page);
    await chooseFromMenu(page, "Text", "Show");
    await shown;
    expect(await tileNames(await lookTiles(page, "bs-plain"))).toContain(
      "Text"
    );
  });

  test('"Set as default ★" moves the ★, one style per type', async ({
    page,
  }) => {
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await openStyles(page);
    // The block's own style carries ★ until another does.
    await expect(styleRow(page, "Primary")).toHaveAccessibleName(
      /^Primary, default/
    );
    const moved = styleWrite(page);
    await chooseFromMenu(page, "Outline", "Set as default ★");
    await moved;
    await expect(styleRow(page, "Outline")).toHaveAccessibleName(
      /^Outline, default/
    );
    await expect(styleRow(page, "Primary")).toHaveAccessibleName("Primary");
    expect(
      (await storedClasses(page.request))
        .filter(entry => entry.starred === true)
        .map(entry => entry.id)
    ).toEqual([OUTLINE_ID]);

    // Given back to the block's own style, nothing is starred.
    const back = styleWrite(page);
    await chooseFromMenu(page, "Primary", "Set as default ★");
    await back;
    expect(
      (await storedClasses(page.request)).filter(
        entry => entry.starred === true
      )
    ).toEqual([]);
  });

  test("makes, renames, edits and removes a block style from the keyboard alone", async ({
    page,
  }) => {
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await clickBlock(page, "bs-plain");
    await expect.poll(() => selection(page)).toEqual(["bs-plain"]);
    await openStyles(page);
    await countEveryPage(page.request);

    /** Tab from the Design search until the element named `name` has focus. */
    const tabTo = async (name: RegExp): Promise<void> => {
      await page.getByRole("searchbox", { name: "Search Design" }).focus();
      for (let presses = 0; presses < 80; presses += 1) {
        // A row is named by its own hidden text, which starts with its
        // name; anything else by its label or its text.
        const focused = await page.evaluate(
          () =>
            document.activeElement?.getAttribute("aria-label") ??
            document.activeElement?.querySelector(":scope > .nx-sr-only")
              ?.textContent ??
            document.activeElement?.textContent ??
            ""
        );
        if (name.test(focused)) return;
        await page.keyboard.press("Tab");
      }
      throw new Error(`[e2e] Tab never reached ${String(name)}`);
    };

    // Make one: Enter on "+ New button style", a name, Enter.
    await tabTo(/^\+ New button style$/);
    await page.keyboard.press("Enter");
    const made = styleWrite(page);
    await page.keyboard.type("Keys");
    await page.keyboard.press("Enter");
    await made;
    await expect(
      page.getByRole("group", { name: "Editing Keys" })
    ).toBeVisible();

    // Rename it: F2 on its row, a name, Enter; focus back on the row.
    await tabTo(/^Keys(,|$)/);
    await page.keyboard.press("F2");
    const renamed = styleWrite(page);
    await page.keyboard.type("Keyed");
    await page.keyboard.press("Enter");
    await renamed;
    await expect(styleRow(page, "Keyed")).toBeFocused();

    // Edit it: Enter on the row opens it in the style editor.
    await tabTo(/^Keyed(,|$)/);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("group", { name: "Editing Keyed" })
    ).toBeVisible();

    // Shift+F10 opens its ⋯ menu; Escape closes it back to the row and the
    // canvas selection is never cleared by it.
    await tabTo(/^Keyed(,|$)/);
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(styleRow(page, "Keyed")).toBeFocused();

    // Remove it from the menu: End lands on the last item, Remove.
    await tabTo(/^Keyed(,|$)/);
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("menuitem", { name: "Remove", exact: true })
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(styleRow(page, "Keyed")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await storedClasses(page.request)).some(
          entry => entry.label === "Keyed"
        )
      )
      .toBe(false);
  });

  test("at the panel's narrowest, rows fit and a row's ⋯ menu opens inside the window", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await openStyles(page);
    const divider = page.getByRole("separator", { name: "Panel and canvas" });
    await divider.focus();
    await page.keyboard.press("Home");
    const panel = page.getByRole("region", { name: "Design panel" });
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
      .toBeLessThanOrEqual(240);
    // No row, and no body, scrolls sideways.
    const overflowing = await blockStyles(page)
      .locator(".nx-block-styles__item, .nx-block-styles__add")
      .evaluateAll(rows =>
        rows
          .filter(row => row.scrollWidth > row.clientWidth + 1)
          .map(row => row.textContent)
      );
    expect(overflowing).toEqual([]);
    const body = await page
      .locator(".nx-pb-design__body")
      .first()
      .evaluate(element => element.scrollWidth <= element.clientWidth + 1);
    expect(body).toBe(true);

    // The last block style row's menu, inside the 1280×720 window.
    const more = blockStyles(page)
      .getByRole("button", { name: /^More actions for / })
      .last();
    await more.scrollIntoViewIfNeeded();
    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box, "the menu is drawn").not.toBeNull();
    if (box === null) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("passes the accessibility scan in light and dark", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
      if (theme === "dark") {
        await gotoAdmin(page, "/singles/homepage", "dark");
        // The way into the builder, named as the shared driver names it.
        await page
          .locator(PAGE_BUILDER_CARD)
          .getByRole("link", { name: OPEN_BUILDER_ACTION })
          .click();
      }
      await openStyles(page);
      await expectNoAxeViolations(page, { include: ".nx-block-styles" });
    }
  });

  test("edits a block style at Hover from the style editor's State switch", async ({
    page,
  }) => {
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await openStyles(page);
    await styleRow(page, "Outline").click();
    const bar = page.getByRole("group", { name: "Editing Outline" });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(
      "Changes every Button using Outline on every page"
    );
    await bar.getByRole("button", { name: /^State: Normal/ }).click();
    await page.getByRole("menuitemradio", { name: /^Hover/ }).click();
    // The host keeps no block selected here, and the switch still moves.
    await expect(
      bar.getByRole("button", { name: /^State: Hover/ })
    ).toBeVisible();
    await expect(
      page.getByText("You are editing the Hover look. Normal stays as it is.")
    ).toBeVisible();
  });

  test("Undo and Redo reverse a block style's rename", async ({ page }) => {
    const ghost = siteButtonStyle("e2e-undo-ghost", "Ghost", "button-ghost");
    await storeClasses(page.request, [ghost]);
    await openEditorWith(page, [button("bs-plain", "Plain")], "bs-plain");
    await openStyles(page);
    await chooseFromMenu(page, "Ghost", "Rename");
    const field = blockStyles(page).getByRole("textbox", {
      name: "Rename Ghost",
    });
    const renamed = styleWrite(page);
    await field.fill("Soft ghost");
    await field.press("Enter");
    await renamed;
    const labelOf = async () =>
      (await storedClasses(page.request)).find(entry => entry.id === ghost.id)
        ?.label;
    expect(await labelOf()).toBe("Soft ghost");

    const undone = styleWrite(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await undone;
    await expect.poll(labelOf).toBe("Ghost");
    await expect(styleRow(page, "Ghost")).toBeVisible();

    const redone = styleWrite(page);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await redone;
    await expect.poll(labelOf).toBe("Soft ghost");
  });
});

/**
 * Design's update permission withheld: the section shows its styles with no
 * action, and the writes it would make are refused.
 */
test("a role that may read Design but not change it sees block styles with no action, and is refused their changes", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const ghost = siteButtonStyle("e2e-ro-ghost", "Ghost", "button-ghost");
  await storeClasses(page.request, [ghost]);
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  try {
    const created = await page.request.post(PAGES, {
      data: {
        title: "Block styles read-only",
        slug: `block-styles-read-only-${Date.now()}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [button("bs-ro", "Read only")],
        },
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
    await openStyles(view);
    await expect(styleRow(view, "Ghost")).toBeVisible();
    await expect(
      blockStyles(view).getByRole("button", { name: /^\+ New / })
    ).toHaveCount(0);
    await expect(
      blockStyles(view).getByRole("button", { name: /^More actions for / })
    ).toHaveCount(0);
    // F2 renames nothing.
    await styleRow(view, "Ghost").focus();
    await view.keyboard.press("F2");
    await expect(blockStyles(view).getByRole("textbox")).toHaveCount(0);

    // The writes themselves are refused for want of the right alone: each is
    // a whole write the site style takes from a Design manager (the control,
    // put back after), and the reader's same write is refused as forbidden.
    const writes = [
      { classes: [{ ...ghost, label: "Mine" }], _overwrite: true },
      { classes: [{ ...ghost, starred: true }], _overwrite: true },
    ];
    for (const data of writes) {
      const allowed = await page.request.patch(SITE_STYLE, { data });
      expect(allowed.ok(), await allowed.text()).toBe(true);
      await storeClasses(page.request, [ghost]);
    }
    const headers = await writeHeaders(reader.context.request);
    for (const data of writes) {
      const refused = await reader.context.request.patch(SITE_STYLE, {
        headers,
        data,
      });
      expect(refused.status(), await refused.text()).toBe(403);
    }
    const removed = await reader.context.request.post(
      `${PLUGIN}/shared-styles/remove`,
      { headers, data: { ids: [ghost.id] } }
    );
    expect(removed.status()).toBe(403);
    expect(await storedClasses(page.request)).toEqual([ghost]);
  } finally {
    await reader.context.close();
    await storeClasses(page.request, []);
  }
});
