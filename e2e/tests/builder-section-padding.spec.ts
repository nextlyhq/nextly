/**
 * A Section's Padding as Compact, Normal or Roomy, in a real browser:
 *
 * 1. Style › Spacing offers "Padding: Compact / Normal / Roomy" above the
 *    spacing box, at Normal, with its hint; it is chosen from the keyboard,
 *    fits the panel at its narrowest, passes the accessibility scan in light
 *    and dark, and is held on a Section locked in Layers.
 * 2. A side's own value reads as "Custom"; a preset chosen again clears it,
 *    and one undo brings it back.
 * 3. Compact is tighter and Roomy airier above and below, the sides
 *    unchanged, on the canvas and the published page alike; a Normal Section
 *    keeps today's padding; at 320px nothing scrolls sideways.
 * 4. Changing Roomy's variable moves every Roomy Section.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  OPEN_BUILDER_ACTION,
  openEditorWith,
  PAGE_BUILDER_CARD,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

test.describe.configure({
  mode: "serial",
  lock: [LOCK.homepage, LOCK.siteStyle],
});

const SITE_STYLE = "/admin/api/singles/site-style";
const ENTRIES = "/admin/api/collections/block-pages/entries";
const PAGE_SLUG = "section-padding";
/** The editor's undo and redo: `mod` is Control in the suite's browser. */
const UNDO = "Control+z";
const REDO = "Control+Shift+z";
const HINT = "Space inside the section, from the site's settings";

function text(id: string, words: string) {
  return { id, type: "core/text", version: 1, props: { text: words } };
}

function section(
  id: string,
  words: string,
  extra: Record<string, unknown> = {},
  props: Record<string, unknown> = {}
) {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true, ...props },
    slots: { children: [text(`${id}-text`, words)] },
    ...extra,
  };
}

/** One Section of each kind, for the measures on both surfaces. */
const BANDS = [
  section("sp-normal", "A normal band"),
  section("sp-compact", "A compact band", {}, { paddingPreset: "compact" }),
  section("sp-roomy", "A roomy band", {}, { paddingPreset: "roomy" }),
];

/** An element's padding, in px, side by side. */
interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function paddingOf(locator: Locator): Promise<Padding> {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      top: parseFloat(style.paddingTop),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft),
      right: parseFloat(style.paddingRight),
    };
  });
}

/** The Section a visitor sees holding these words. */
function liveBand(page: Page, words: string): Locator {
  return page.locator("section", { hasText: words });
}

/** Select a Section by its text and open its Style tab's Spacing section. */
async function openSpacing(page: Page, id: string): Promise<Locator> {
  await clickBlock(page, `${id}-text`);
  await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([id]);
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const spacing = inspector.getByRole("button", { name: /^Spacing/ });
  if ((await spacing.getAttribute("aria-expanded")) !== "true") {
    await spacing.click();
  }
  await expect(spacing).toHaveAttribute("aria-expanded", "true");
  return inspector.getByRole("radiogroup", { name: "Padding" });
}

/** A side's button in the spacing box, by the start of its name. */
function sideField(page: Page, side: string): Locator {
  return page
    .locator(".nx-spacing-box")
    .getByRole("button", { name: new RegExp(`^${side} `) });
}

function sideText(page: Page, side: string): Locator {
  return sideField(page, side).locator(".nx-spacing-side__text");
}

/** The choice that reads as chosen, or none for Custom. */
async function chosen(group: Locator): Promise<string[]> {
  return group
    .getByRole("radio", { checked: true })
    .allTextContents()
    .catch(() => []);
}

async function storeTokens(page: Page, tokens: unknown): Promise<void> {
  const response = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(response.ok(), `writing the site style: ${response.status()}`).toBe(
    true
  );
}

let before: unknown;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    const read = await api.get(SITE_STYLE);
    const body = (await read.json()) as Record<string, unknown>;
    const item = (body.item ?? body) as Record<string, unknown>;
    const raw = item.tokens ?? null;
    before = typeof raw === "string" ? JSON.parse(raw) : raw;
    const created = await api.post(ENTRIES, {
      data: {
        title: "Section padding",
        slug: PAGE_SLUG,
        content: { formatVersion: 1, kind: "page", nodes: BANDS },
        status: "published",
      },
    });
    if (created.status() !== 409) {
      expect(
        created.ok(),
        `seeding ${PAGE_SLUG}: ${await created.text()}`
      ).toBe(true);
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) return;
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    await api.patch("/admin/api/singles/homepage", {
      data: {
        layout: { formatVersion: 1, kind: "page", nodes: [] },
        _overwrite: true,
      },
    });
    await api.patch(SITE_STYLE, {
      data: { tokens: before ?? { tokens: [] }, _overwrite: true },
    });
  } finally {
    await api.dispose();
  }
});

test("Padding sits above the spacing box at Normal, is chosen from the keyboard, fits the panel and passes the scan in light and dark", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await storeTokens(page, { tokens: [] });
  await openEditorWith(page, [section("sp-new", "A new band")], "sp-new-text");
  const group = await openSpacing(page, "sp-new");

  await expect(group.getByRole("radio")).toHaveText([
    "Compact",
    "Normal",
    "Roomy",
  ]);
  expect(await chosen(group)).toEqual(["Normal"]);
  const hint = page.getByText(HINT);
  await expect(hint).toBeVisible();
  const box = page.locator(".nx-spacing-box");
  const groupBox = await group.boundingBox();
  const hintBox = await hint.boundingBox();
  const spacingBox = await box.boundingBox();
  if (groupBox === null || hintBox === null || spacingBox === null) {
    throw new Error("the control, its hint or the box is not drawn");
  }
  expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(hintBox.y + 1);
  expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(spacingBox.y + 1);

  // One tab stop, at Normal; the arrows choose, and the canvas follows.
  const band = await block(page, "sp-new");
  const normal = await paddingOf(band);
  await group.getByRole("radio", { name: "Normal" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Roomy" })).toBeFocused();
  expect(await chosen(group)).toEqual(["Roomy"]);
  await expect
    .poll(async () => (await paddingOf(band)).top)
    .toBeGreaterThan(normal.top);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect(await chosen(group)).toEqual(["Compact"]);
  await expect
    .poll(async () => (await paddingOf(band)).top)
    .toBeLessThan(normal.top);
  // Focus is drawn where it is.
  const focused = group.getByRole("radio", { name: "Compact" });
  await expect(focused).toBeFocused();
  expect(
    await focused.evaluate(element => getComputedStyle(element).outlineStyle)
  ).not.toBe("none");

  // At the panel's narrowest, and narrower still, the row fits its panel.
  const divider = page.getByRole("separator", { name: "Canvas and inspector" });
  await divider.focus();
  await page.keyboard.press("End");
  const fits = () =>
    page
      .locator('[data-control="section-padding"]')
      .evaluate(
        element =>
          element.scrollWidth <= element.clientWidth + 1 &&
          [...element.querySelectorAll('[role="radio"]')].every(
            radio =>
              radio.getBoundingClientRect().right <=
              element.getBoundingClientRect().right + 1
          )
      );
  expect(await fits()).toBe(true);
  await page
    .locator(".nx-inspector")
    .evaluate(element => element.style.setProperty("width", "240px"));
  expect(await fits()).toBe(true);

  await expectNoAxeViolations(page, { include: '[data-section="spacing"]' });

  // In the builder's dark theme.
  await gotoAdmin(page, "/singles/homepage", "dark");
  await page
    .locator(PAGE_BUILDER_CARD)
    .getByRole("link", { name: OPEN_BUILDER_ACTION })
    .click();
  await expect(await block(page, "sp-new")).toBeVisible({ timeout: 30_000 });
  await openSpacing(page, "sp-new");
  await expectNoAxeViolations(page, { include: '[data-section="spacing"]' });
});

test("a side's own value reads as Custom; a preset chosen again clears it, and one undo brings it back", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(
    page,
    [section("sp-own", "An own band", {}, { paddingPreset: "compact" })],
    "sp-own-text"
  );
  const group = await openSpacing(page, "sp-own");
  expect(await chosen(group)).toEqual(["Compact"]);
  await expect(sideText(page, "Padding top")).toHaveText(
    "Section padding, compact (top and bottom)"
  );

  // The author's own top padding, from the spacing box.
  await sideField(page, "Padding top").click();
  const number = page.getByLabel("Value for Padding top");
  await number.fill("10");
  await number.press("Enter");
  await expect(page.getByRole("dialog", { name: "Padding top" })).toHaveCount(
    0
  );
  await expect(sideText(page, "Padding top")).toHaveText("10px");
  await expect.poll(() => chosen(group)).toEqual([]);
  await expect(page.getByText(/^Custom:/)).toBeVisible();
  const band = await block(page, "sp-own");
  await expect.poll(async () => (await paddingOf(band)).top).toBe(10);

  // Roomy clears it, in one step.
  await group.getByRole("radio", { name: "Roomy" }).click();
  expect(await chosen(group)).toEqual(["Roomy"]);
  await expect(sideText(page, "Padding top")).toHaveText(
    "Section padding, roomy (top and bottom)"
  );
  await expect
    .poll(async () => (await paddingOf(band)).top)
    .toBeGreaterThan(40);

  // One undo: the own value and Custom are back.
  await page.keyboard.press(UNDO);
  await expect(sideText(page, "Padding top")).toHaveText("10px");
  await expect.poll(() => chosen(group)).toEqual([]);
  await expect.poll(async () => (await paddingOf(band)).top).toBe(10);
  // And redo takes it to Roomy again.
  await page.keyboard.press(REDO);
  await expect.poll(() => chosen(group)).toEqual(["Roomy"]);
});

test("a Section locked in Layers shows its Padding held", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(
    page,
    [section("sp-locked", "A locked band", { locked: true })],
    "sp-locked-text"
  );
  const group = await openSpacing(page, "sp-locked");
  for (const radio of await group.getByRole("radio").all()) {
    await expect(radio).toBeDisabled();
  }
});

test("Compact is tighter and Roomy airier above and below, sides unchanged, on the canvas and the published page alike", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await storeTokens(page, { tokens: [] });
  await page.setViewportSize({ width: 1280, height: 900 });
  // The published page, read until its render follows the stored page.
  let live: Padding[] = [];
  await expect
    .poll(
      async () => {
        await page.goto(`/blocks/${PAGE_SLUG}`);
        live = await Promise.all(
          ["A normal band", "A compact band", "A roomy band"].map(words =>
            paddingOf(liveBand(page, words))
          )
        );
        return live.map(each => each.top);
      },
      { timeout: 60_000 }
    )
    // At 1280px: today's 80px, Compact 40px, Roomy 120px.
    .toEqual([80, 40, 120]);
  const [normal, compact, roomy] = live as [Padding, Padding, Padding];
  expect([normal.bottom, compact.bottom, roomy.bottom]).toEqual([80, 40, 120]);
  for (const each of [compact, roomy]) {
    expect([each.left, each.right]).toEqual([normal.left, normal.right]);
  }

  // At a phone's 320px, nothing scrolls sideways, and Roomy is 72px.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/blocks/${PAGE_SLUG}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  expect((await paddingOf(liveBand(page, "A roomy band"))).top).toBe(72);

  // The canvas, from the same stored nodes.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(page, BANDS, "sp-normal-text");
  const canvas = await Promise.all(
    ["sp-normal", "sp-compact", "sp-roomy"].map(async id =>
      paddingOf(await block(page, id))
    )
  );
  const [cNormal, cCompact, cRoomy] = canvas as [Padding, Padding, Padding];
  expect(cCompact.top).toBeLessThan(cNormal.top);
  expect(cRoomy.top).toBeGreaterThan(cNormal.top);
  expect(cCompact.bottom).toBe(cCompact.top);
  expect(cRoomy.bottom).toBe(cRoomy.top);
  for (const each of [cCompact, cRoomy]) {
    expect([each.left, each.right]).toEqual([cNormal.left, cNormal.right]);
  }
});

test("changing Roomy's variable moves every Roomy Section", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await storeTokens(page, {
    tokens: [
      {
        name: "space.section-y-roomy",
        kind: "dimension",
        values: { light: "200px" },
      },
    ],
  });
  await expect
    .poll(
      async () => {
        await page.goto(`/blocks/${PAGE_SLUG}`);
        return Promise.all(
          ["A normal band", "A compact band", "A roomy band"].map(
            async words => (await paddingOf(liveBand(page, words))).top
          )
        );
      },
      { timeout: 60_000 }
    )
    .toEqual([80, 40, 200]);
  await storeTokens(page, { tokens: [] });
});
