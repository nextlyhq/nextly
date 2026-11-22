/**
 * The Design panel's ⋯ menu ("More design actions"), in the editor.
 *
 * - A default site's design token export ends with a toast that names its
 *   files in words, and leaves no box above the tab.
 * - An export for Figma of a site with a shadow offers "What wasn't
 *   exported", which names the shadow, that it was left out, and why.
 * - At the panel's narrowest, the menu opens whole inside the window, works
 *   from the keyboard, and passes the accessibility check in light and dark.
 * - A design token file carries a site's text styles, Site text and fluid
 *   range into a fresh site. Its import names a font the site lacks, offers
 *   to add one the catalogue has, fits the window, works from the keyboard,
 *   passes the accessibility check in light and dark, and Undo and Redo
 *   reverse it.
 */
import { readFileSync } from "node:fs";

import { expect, type Locator, type Page } from "@playwright/test";

import { openEditorWith } from "./canvas/editor-driver";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const NODES = [
  {
    id: "more-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the Design panel's menu" },
  },
];

async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

async function openDesign(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await expect(panel).toBeVisible();
}

function moreButton(page: Page) {
  return page
    .getByRole("region", { name: "Design panel" })
    .getByRole("button", { name: "More design actions" });
}

async function choose(page: Page, item: string): Promise<void> {
  await moreButton(page).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/**
 * axe cannot parse a colour with a missing component, such as the canvas's
 * `oklch(0.95 0 none)`, which Chromium keeps in the computed value and draws
 * as zero; it then gives up on every text whose backdrop holds one, and a
 * dialog over the canvas has one. Each is restated with the zero it is drawn
 * with, which changes no pixel, so the scan measures the dialog.
 */
async function spellMissingColourComponents(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      const colour = getComputedStyle(element).backgroundColor;
      if (!/\bnone\b/.test(colour)) continue;
      element.style.backgroundColor = colour.replace(/\bnone\b/g, "0");
    }
  });
}

function toastSaying(page: Page, text: string | RegExp) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** Press Tab until `target` has the focus, failing after a bounded walk. */
async function reachByTab(page: Page, target: Locator): Promise<void> {
  for (let press = 0; press < 25; press += 1) {
    if (await target.evaluate(element => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/**
 * Press the toolbar's Undo or Redo until the stored design reads `want`. An
 * import stores its variables and its text styles as separate writes, so it
 * may take one press or two; each press must change what is stored, so a
 * press that does nothing fails rather than looping.
 */
async function stepUntil<T>(
  page: Page,
  button: "Undo" | "Redo",
  read: () => Promise<T>,
  want: T
): Promise<void> {
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  for (let press = 0; press < 3; press += 1) {
    const now = await read();
    if (same(now, want)) return;
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect
      .poll(async () => same(await read(), now), { timeout: 15_000 })
      .toBe(false);
  }
  await expect.poll(read, { timeout: 15_000 }).toEqual(want);
}

test("a default site's export ends with a toast naming its files, and no box stays", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    // A default site: nothing of its own, only the built-in variables.
    await seed(page, null);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "more-text");
    await openDesign(page);
    const panel = page.getByRole("region", { name: "Design panel" });

    const downloads: string[] = [];
    page.on("download", download => {
      downloads.push(download.suggestedFilename());
    });
    await choose(page, "Export design tokens (.json)");
    const toast = toastSaying(
      page,
      "Design tokens exported: variables, and dark values in a theme file (2 files)"
    );
    await expect(toast).toBeVisible();
    await expect
      .poll(() => [...downloads].sort())
      .toEqual(["variables.resolver.json", "variables.tokens.json"]);

    // No report box above the tab, and nothing in the panel to dismiss.
    await expect(page.locator(".nx-pb-design__reports")).toHaveCount(0);
    await expect(page.locator(".nx-vars__report")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
    // The toast goes by itself.
    await expect(toast).toBeHidden({ timeout: 20_000 });
  } finally {
    await seed(page, before);
  }
});

/** The stored site style's variables and classes, to put back afterwards. */
async function storedDesign(
  page: Page
): Promise<{ tokens: unknown; classes: unknown }> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const read = (value: unknown) =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return {
    tokens: read(item.tokens) ?? null,
    classes: read(item.classes) ?? [],
  };
}

async function seedDesign(
  page: Page,
  design: { tokens: unknown; classes: unknown }
): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { ...design, _overwrite: true },
  });
  expect(written.ok(), `writing the design: ${written.status()}`).toBe(true);
}

const EYEBROW = {
  id: "ts-e2e-eyebrow",
  slug: "e2e-eyebrow",
  label: "Eyebrow",
  orderIndex: 900,
  role: "text",
  styles: {
    base: {
      base: {
        fontSize: { $token: "font-size.h2" },
        textTransform: "uppercase",
      },
    },
  },
};

const CARRIED_DESIGN = {
  tokens: {
    tokens: [
      {
        id: "c-e2e-brand",
        name: "color.e2e-brand",
        label: "E2E brand",
        kind: "color",
        group: "Brand",
        values: { light: "#1d4ed8", dark: "#93c5fd" },
      },
      {
        name: "font.body",
        kind: "fontFamily",
        values: { light: '"Brand Sans E2E", sans-serif' },
      },
      // A family the stand-in catalogue lists, so the import offers to add it.
      {
        name: "font.heading",
        kind: "fontFamily",
        values: { light: '"Fixture Serif", serif' },
      },
      {
        name: "shadow.e2e-lift",
        label: "Lift",
        kind: "shadow",
        values: {
          light: "0 1px 2px #000000, 0 8px 24px var(--site-c-e2e-brand)",
        },
      },
    ],
    siteText: {
      body: { fontFamily: { $token: "font.body" } },
      h3: { textStyle: EYEBROW.id },
    },
    fluidRange: { min: 320, max: 1440 },
  },
  classes: [EYEBROW],
};

test("a design token file carries text styles, Site text and the fluid range into a fresh site, and names a font it lacks", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedDesign(page);
  try {
    await seedDesign(page, CARRIED_DESIGN);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "more-text");
    await openDesign(page);

    // Export: the token file holds the text style as a typography value
    // and the shadow as a shadow value.
    const saved = new Map<string, string>();
    page.on("download", download => {
      void download.path().then(path => {
        if (path !== null) saved.set(download.suggestedFilename(), path);
      });
    });
    await choose(page, "Export design tokens (.json)");
    await expect
      .poll(() => saved.has("variables.tokens.json"), { timeout: 20_000 })
      .toBe(true);
    const tokensFile = saved.get("variables.tokens.json") ?? "";
    const file = JSON.parse(readFileSync(tokensFile, "utf8")) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(file.textStyles?.["e2e-eyebrow"]).toMatchObject({
      $type: "typography",
      $value: { fontSize: "{font-size.h2}" },
    });
    expect(file.shadow?.["e2e-lift"]).toMatchObject({ $type: "shadow" });

    // A fresh site: none of it stored.
    await seedDesign(page, { tokens: null, classes: [] });
    await openEditorWith(page, NODES, "more-text");
    await openDesign(page);
    const chooser = page.waitForEvent("filechooser");
    await choose(page, "Import design tokens…");
    await (await chooser).setFiles([tokensFile]);

    const preview = page.getByRole("dialog", { name: "Import variables" });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "Text styles" })
    ).toBeVisible();
    await expect(preview).toContainText("Eyebrow");
    await expect(preview).toContainText("Site text: Body, Heading 3");
    await expect(preview).toContainText(
      "Fluid sizes grow from 320px to 1440px wide"
    );
    const fonts = preview
      .getByRole("heading", { name: "Fonts this site doesn't have" })
      .locator("xpath=..");
    await expect(fonts).toContainText("Brand Sans E2E");
    await expect(fonts).toContainText(
      "Upload its font file in Fonts to use it."
    );
    // The catalogue font is offered; it isn't added here, so the site's
    // fonts stay as they were. The stand-in catalogue answers a development
    // server only, so a production run sees the upload note instead.
    const catalogueAnswers = process.env.E2E_SERVER !== "production";
    const addFont = fonts.getByRole("button", {
      name: "Add from Google Fonts: Fixture Serif",
    });
    if (catalogueAnswers) await expect(addFont).toBeVisible();

    // The dialog sits whole inside the window, with no sideways scroll.
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }
    // Named rather than counted, so a failure says which element is wider
    // than the room it is given.
    expect(
      await preview.evaluate(dialog =>
        [dialog, ...dialog.querySelectorAll("*")]
          .filter(
            element =>
              // Text kept for screen readers only is 1px wide by design.
              element.clientWidth > 1 &&
              element.scrollWidth > element.clientWidth + 1 &&
              getComputedStyle(element).overflowX !== "visible"
          )
          .map(
            element =>
              `${element.tagName.toLowerCase()}.${String(element.className)} ` +
              `${String(element.scrollWidth)}>${String(element.clientWidth)} ` +
              `${getComputedStyle(element).overflowX} ` +
              `"${(element.textContent ?? "").trim().slice(0, 40)}"`
          )
      )
    ).toEqual([]);

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await spellMissingColourComponents(page);
      await expectNoAxeViolations(page, { include: ".nx-vars-import" });
    }

    // From the keyboard: Tab reaches "Add from Google Fonts", then Import,
    // and Enter imports.
    const importButton = preview.getByRole("button", {
      name: "Import",
      exact: true,
    });
    if (catalogueAnswers) await reachByTab(page, addFont);
    await reachByTab(page, importButton);
    await page.keyboard.press("Enter");
    await expect(
      toastSaying(page, /^Imported \d+ variables? and 1 text style\./)
    ).toBeVisible();

    const carried = async () => {
      const stored = await storedDesign(page);
      const tokens = stored.tokens as Record<string, unknown> | null;
      return {
        siteText: tokens?.siteText ?? null,
        fluidRange: tokens?.fluidRange ?? null,
        textStyles: (stored.classes as { id: string }[]).map(entry => entry.id),
      };
    };
    const imported = {
      siteText: CARRIED_DESIGN.tokens.siteText,
      fluidRange: CARRIED_DESIGN.tokens.fluidRange,
      textStyles: [EYEBROW.id],
    };
    const fresh = { siteText: null, fluidRange: null, textStyles: [] };
    await expect.poll(carried, { timeout: 20_000 }).toEqual(imported);

    // Undo takes the import back, its variables and data and its text
    // styles, and Redo makes it again.
    await stepUntil(page, "Undo", carried, fresh);
    await stepUntil(page, "Redo", carried, imported);
  } finally {
    await seedDesign(page, before);
  }
});

test("an export for Figma lists the shadow it left out, and why", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const before = await storedTokens(page);
  try {
    await seed(page, {
      tokens: [
        {
          name: "color.text",
          kind: "color",
          values: { light: "#111111", dark: "#eeeeee" },
        },
        {
          name: "shadow.card",
          label: "Card shadow",
          kind: "shadow",
          values: { light: "0 2px 4px rgba(0, 0, 0, 0.2)" },
        },
      ],
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "more-text");
    await openDesign(page);

    await choose(page, "Export for Figma");
    const toast = toastSaying(
      page,
      /^Exported for Figma: light mode and dark mode \(2 files\)/
    );
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "What wasn't exported" }).click();

    const list = page.getByRole("dialog", { name: "What wasn't exported" });
    await expect(list).toBeVisible();
    const row = list.getByRole("listitem").filter({ hasText: "Card shadow" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Left out");
    await expect(row).toContainText(
      "Figma keeps these as effect styles and text styles; the variables they use are in the file"
    );
    await spellMissingColourComponents(page);
    await expectNoAxeViolations(page, { include: ".nx-design-gaps" });

    // Escape closes it, and focus is back on the menu it came from.
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
  } finally {
    await seed(page, before);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`at the panel's narrowest the menu opens whole in the window and works from the keyboard (${scheme})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "more-text");
    await openDesign(page);
    const divider = page.getByRole("separator", { name: "Panel and canvas" });
    await divider.focus();
    await page.keyboard.press("Home");
    const panel = page.getByRole("region", { name: "Design panel" });
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
      .toBeLessThanOrEqual(240);

    const button = moreButton(page);
    const target = await button.boundingBox();
    expect(target?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(24);

    // From the keyboard: Enter opens it, the arrows move, Escape returns.
    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Import design tokens…",
      /^Export design tokens \(\.json\)\s*DTCG 2025\.10$/,
      "Export for Figma",
      "Copy CSS variables",
    ]);
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();

    const box = await menu.boundingBox();
    expect(box, "the menu is drawn").not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }
    await expectNoAxeViolations(page, { include: "[role='menu']" });

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });
}
