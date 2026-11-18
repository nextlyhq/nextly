/**
 * The Design panel's ⋯ menu ("More design actions"), in the editor.
 *
 * - A default site's design token export ends with a toast that names its
 *   files in words, and leaves no box above the tab.
 * - An export for Figma of a site with a shadow offers "What wasn't
 *   exported", which names the shadow, that it was left out, and why.
 * - At the panel's narrowest, the menu opens whole inside the window, works
 *   from the keyboard, and passes the accessibility check in light and dark.
 */
import { expect, type Page } from "@playwright/test";

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
      "Figma keeps shadows as effect styles, not variables."
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
