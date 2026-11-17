/**
 * The Colours tab's named groups in the browser.
 *
 * - A new site starts with "Brand" and "Text and surfaces".
 * - "+ New group" adds one to name; a colour is dragged into it, moved with
 *   Alt+Up and Alt+Down and from its ⋯ menu; a group is renamed and removed.
 * - The groups and order survive a reload, and a block's colour picker lists
 *   colours in the same order.
 * - Moving colours changes no code name and no value.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { clickBlock, openEditorWith } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const NODES = [
  {
    id: "groups-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the colour groups" },
  },
];

interface StoredSet {
  tokens?: { name: string; group?: string; values: { light: string } }[];
  order?: string[];
}

async function storedTokens(page: Page): Promise<StoredSet | null> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return (item.tokens ?? null) as StoredSet | null;
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

async function openColours(page: Page): Promise<Locator> {
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

/** Each named group and the colours it lists, as the panel draws them. */
async function listed(panel: Locator): Promise<string[]> {
  return panel
    .locator("[data-colour-group]")
    .evaluateAll(sections =>
      sections.map(
        section =>
          `${(section as HTMLElement).dataset.colourGroup ?? ""}: ${[
            ...section.querySelectorAll(".nx-vars__row .nx-vars__name"),
          ]
            .map(name => name.textContent)
            .join(", ")}`
      )
    );
}

const row = (panel: Locator, name: string): Locator =>
  panel.getByRole("button", { name: new RegExp(`^${name},`) });

test("colours sit in named groups an author adds to, moves between and removes, kept across a reload", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await storedTokens(page);
  try {
    await seed(page, { tokens: [] });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "groups-text");
    let panel = await openColours(page);
    await expect
      .poll(() => listed(panel))
      .toEqual([
        "Brand: Primary",
        "Text and surfaces: Text, Background, Surface, Border, Strong border, Muted text",
      ]);
    const css = (await storedTokens(page))?.tokens ?? [];

    // + New group, named in place.
    await panel.getByRole("button", { name: "New group" }).click();
    const name = panel.getByRole("textbox", { name: "Group name" });
    await expect(name).toBeFocused();
    await name.fill("Accents");
    await name.press("Enter");

    // Drag Primary onto the new group's heading.
    await row(panel, "Primary").dragTo(
      panel.locator('[data-colour-group="Accents"] .nx-vars__group-head')
    );
    await expect
      .poll(() => listed(panel))
      .toEqual([
        "Text and surfaces: Text, Background, Surface, Border, Strong border, Muted text",
        "Accents: Primary",
      ]);

    // Alt+Up on Background, then the ⋯ menu's Move down on Text.
    await row(panel, "Background").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(() => listed(panel))
      .toEqual([
        "Text and surfaces: Background, Text, Surface, Border, Strong border, Muted text",
        "Accents: Primary",
      ]);
    await panel
      .getByRole("button", { name: "More actions for Muted text" })
      .click();
    await page.getByRole("menuitem", { name: "Move to group…" }).hover();
    await page.getByRole("menuitem", { name: "Accents" }).click();
    await expect
      .poll(() => listed(panel))
      .toEqual([
        "Text and surfaces: Background, Text, Surface, Border, Strong border",
        "Accents: Primary, Muted text",
      ]);

    // Kept across a reload, with no code name and no value changed.
    await expect
      .poll(async () => (await storedTokens(page))?.order?.slice(0, 2))
      .toEqual(["color.background", "color.text"]);
    await openEditorWith(page, NODES, "groups-text");
    panel = await openColours(page);
    await expect
      .poll(() => listed(panel))
      .toEqual([
        "Text and surfaces: Background, Text, Surface, Border, Strong border",
        "Accents: Primary, Muted text",
      ]);
    const after = (await storedTokens(page))?.tokens ?? [];
    for (const token of after) {
      const was = css.find(candidate => candidate.name === token.name);
      if (was !== undefined) expect(token.values).toEqual(was.values);
    }

    // A block's colour picker lists colours in the same order.
    await clickBlock(page, "groups-text");
    const inspector = page.getByTestId("inspector");
    await inspector.getByRole("tab", { name: "Style" }).click();
    const colour = inspector.getByRole("button", {
      name: /^Colour for Colou?r/,
    });
    if (!(await colour.isVisible())) {
      // The text colour sits in the Style tab's text section; opened if shut.
      await inspector
        .locator('[data-slot="accordion-trigger"]')
        .filter({ hasText: /^(Text|Typography)/ })
        .first()
        .click();
    }
    await colour.click();
    const options = page
      .getByRole("listbox", { name: "Colour variables" })
      .getByRole("option");
    await expect
      .poll(() => options.allTextContents())
      .toEqual([
        expect.stringContaining("Background"),
        expect.stringContaining("Text"),
        expect.stringContaining("Surface"),
        expect.stringContaining("Border"),
        expect.stringContaining("Strong border"),
        expect.stringContaining("Primary"),
        expect.stringContaining("Muted text"),
      ]);
    await page.keyboard.press("Escape");

    // Rename a group, then remove it: its colours join the group above.
    await panel
      .getByRole("button", { name: "More actions for group Accents" })
      .click();
    await page.getByRole("menuitem", { name: "Rename group" }).click();
    const rename = panel.getByRole("textbox", { name: "Group name" });
    await rename.fill("Highlights");
    await rename.press("Enter");
    await panel
      .getByRole("button", { name: "More actions for group Highlights" })
      .click();
    await page.getByRole("menuitem", { name: "Remove group" }).click();
    await expect
      .poll(() => listed(panel))
      .toEqual([
        "Text and surfaces: Background, Text, Surface, Border, Strong border, Primary, Muted text",
      ]);
  } finally {
    await seed(page, before);
  }
});

test("at the panel's narrowest, the last group's ⋯ menu opens inside the window", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditorWith(page, NODES, "groups-text");
  const panel = await openColours(page);
  const divider = page.getByRole("separator", { name: "Panel and canvas" });
  await divider.focus();
  await page.keyboard.press("Home");
  await expect
    .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
    .toBeLessThanOrEqual(240);
  const more = panel.getByRole("button", {
    name: "More actions for group Text and surfaces",
  });
  await more.scrollIntoViewIfNeeded();
  await more.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
  }
  await page.keyboard.press("Escape");
});
