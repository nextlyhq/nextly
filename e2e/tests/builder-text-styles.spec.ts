/**
 * Design → Type → "Text styles" in the browser.
 *
 * - "Eyebrow" is made from "+ Add text style" (12 / 1.4, Semibold,
 *   UPPERCASE, +8%) and reads back unchanged after a reload.
 * - Changing Eyebrow restyles a block wearing it on the canvas at once and
 *   on two published pages.
 * - Removing a text style in use is refused, saying where; a locked one
 *   can't be changed until it is unlocked.
 * - Heading 1 set to follow "Display" in Site text draws every H1 in it.
 * - Undo and Redo take a text style's change back and forward.
 * - The rows are made, renamed and reached with the keyboard alone; at the
 *   panel's narrowest they fit, a popup stays in the window, and the Type
 *   tab passes the accessibility scan, in light and dark.
 * - A role that may read Design but not change it sees the text styles and
 *   can't change one, and the API refuses it.
 *
 * @module builder-text-styles.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, emptyHomepage, openEditorWith } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

// The homepage Single is reseeded and edited here, and the site's classes
// and variables are changed and restored.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const ENTRIES = "/admin/api/collections/block-pages/entries";
const PAGE_SLUGS = ["text-styles-one", "text-styles-two"];

/** Eyebrow as the site stores it, for the tests that start from one. */
const EYEBROW = {
  id: "e2e-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 0,
  role: "text",
  styles: {
    base: {
      base: {
        fontFamily: { $token: "font.body" },
        fontSize: "12px",
        lineHeight: 1.4,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      },
    },
  },
};
const DISPLAY = {
  id: "e2e-display",
  slug: "display",
  label: "Display",
  orderIndex: 1,
  role: "text",
  styles: { base: { base: { fontSize: "56px", lineHeight: 1.05 } } },
};

/** A paragraph wearing Eyebrow, and a first-level heading. */
const NODES = [
  {
    id: "ts-kicker",
    type: "core/text",
    version: 1,
    props: { text: "A kicker over the heading" },
    classes: [EYEBROW.id],
  },
  {
    id: "ts-h1",
    type: "core/heading",
    version: 1,
    props: { text: "A first-level heading", level: "h1" },
  },
];

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: NODES };

/** The stored site style's classes and variables. */
async function stored(api: APIRequestContext): Promise<{
  classes: Record<string, unknown>[];
  tokens: Record<string, unknown> | null;
}> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return {
    classes: (item.classes as Record<string, unknown>[] | undefined) ?? [],
    tokens: (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<
      string,
      unknown
    > | null,
  };
}

/** Store the site's classes and variables. */
async function store(
  api: APIRequestContext,
  data: { classes?: unknown; tokens?: unknown }
): Promise<void> {
  const written = await api.patch(SITE_STYLE, {
    data: { ...data, _overwrite: true },
  });
  expect(
    written.ok(),
    `storing the site style: ${written.status()} ${await written.text()}`
  ).toBe(true);
}

/** A text style as stored, by its name. */
async function storedStyle(
  api: APIRequestContext,
  label: string
): Promise<Record<string, unknown> | undefined> {
  return (await stored(api)).classes.find(entry => entry.label === label);
}

/** The Design panel's Type tab, opened, and its Text styles section. */
async function openTextStyles(page: Page) {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Type/ }).click();
  const section = panel.getByRole("region", { name: "Text styles" });
  await section.waitFor();
  return section;
}

/** A text style's row, by its name. */
const styleRow = (section: ReturnType<Page["locator"]>, name: string) =>
  section.getByRole("button", { name: new RegExp(`^Text styles: ${name}\\b`) });

/** A computed style of an element. */
async function computed(
  locator: ReturnType<Page["locator"]>,
  property: "fontSize" | "fontWeight" | "letterSpacing" | "textTransform"
): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element)[name],
    property
  );
}

/** Type into a field and press Enter, which commits it. */
async function enter(field: ReturnType<Page["locator"]>, value: string) {
  await field.fill(value);
  await field.press("Enter");
}

/**
 * Pick an item from one of the popup's choice menus. Each step is bounded,
 * so a step that can't be taken says which, rather than the test's timeout.
 */
async function choose(page: Page, menu: RegExp, item: RegExp): Promise<void> {
  await page.getByRole("combobox", { name: menu }).click({ timeout: 15_000 });
  await page.getByRole("option", { name: item }).click({ timeout: 15_000 });
}

let before: Awaited<ReturnType<typeof stored>> | null = null;

/** The entries a test made, as `collection|id`, taken away after it. */
const created: string[] = [];

/** Delete what the tests made, and count usage again so it frees the styles. */
async function removeCreated(api: APIRequestContext): Promise<void> {
  for (const entry of created.splice(0)) {
    const [collection, id] = entry.split("|");
    await api.delete(`/admin/api/collections/${collection}/entries/${id}`);
  }
  await countEveryPage(api);
}

/** Two published pages, each with a paragraph wearing Eyebrow. */
async function publishTwoPages(api: APIRequestContext): Promise<string[]> {
  const slugs: string[] = [];
  for (const slug of PAGE_SLUGS) {
    const made = await api.post(ENTRIES, {
      data: {
        title: slug,
        slug: `${slug}-${Date.now()}`,
        content: DOCUMENT,
        status: "published",
      },
    });
    expect(made.ok(), `seeding ${slug}: ${await made.text()}`).toBe(true);
    const body = (await made.json()) as { item: { id: string; slug: string } };
    created.push(`block-pages|${body.item.id}`);
    slugs.push(body.item.slug);
  }
  return slugs;
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    before = await stored(api);
    await store(api, { classes: [EYEBROW, DISPLAY] });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? "";
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    await removeCreated(api);
    if (before !== null) {
      await store(api, { classes: before.classes, tokens: before.tokens });
    }
  } finally {
    await api.dispose();
  }
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async ({ page }) => {
  // Off the homepage and the pages made first: a text style in use can't be
  // removed, which putting the starting classes back may do.
  await emptyHomepage(page);
  await removeCreated(page.request);
  await store(page.request, { classes: [EYEBROW, DISPLAY] });
});

test('makes "Eyebrow" (12 / 1.4, Semibold, UPPERCASE, +8%) and reads it back unchanged after a reload', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await countEveryPage(page.request);
  await store(page.request, { classes: [] });
  await openEditorWith(page, [NODES[1]], "ts-h1");
  const section = await openTextStyles(page);
  await section.getByRole("button", { name: "+ Add text style" }).click();
  await enter(
    section.getByRole("textbox", { name: "New text style name" }),
    "Eyebrow"
  );
  await expect(styleRow(section, "Eyebrow")).toBeVisible();

  await styleRow(section, "Eyebrow").click();
  const popup = page.getByRole("dialog", { name: "Edit Eyebrow" });
  for (const device of ["Desktop", "Tablet", "Mobile"]) {
    await enter(popup.getByLabel(`Size on ${device}`, { exact: true }), "12px");
  }
  await enter(popup.getByRole("textbox", { name: "Line height" }), "1.4");
  await choose(page, /^Weight, /, /^Semibold 600/);
  await enter(popup.getByRole("textbox", { name: "Letter spacing" }), "0.08");
  // The case is held by the stored style, so the radio shows as checked once
  // the editor's write has re-rendered it: clicked, then waited for, rather
  // than asserted the instant the click lands.
  const uppercase = popup.getByRole("radio", { name: "UPPERCASE" });
  await uppercase.click();
  await expect(uppercase).toBeChecked();
  const want = {
    base: {
      base: {
        fontFamily: { $token: "font.body" },
        fontSize: "12px",
        lineHeight: 1.4,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      },
      tablet: { fontSize: "12px" },
      mobile: { fontSize: "12px" },
    },
  };
  await expect
    .poll(async () => (await storedStyle(page.request, "Eyebrow"))?.styles)
    .toEqual(want);
  await page.keyboard.press("Escape");

  await page.reload();
  const again = await openTextStyles(page);
  await expect(styleRow(again, "Eyebrow")).toHaveAccessibleName(
    "Text styles: Eyebrow, 12 / 1.4"
  );
  const sample = styleRow(again, "Eyebrow").getByText("The quick survey");
  await expect(sample).toHaveCSS("text-transform", "uppercase");
  await expect(sample).toHaveCSS("font-weight", "600");
  expect((await storedStyle(page.request, "Eyebrow"))?.styles).toEqual(want);
  expect((await storedStyle(page.request, "Eyebrow"))?.role).toBe("text");
});

test("changing Eyebrow restyles a block wearing it on the canvas at once and on two published pages", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const slugs = await publishTwoPages(page.request);
  await openEditorWith(page, NODES, "ts-kicker");
  const kicker = await block(page, "ts-kicker");
  await expect.poll(() => computed(kicker, "fontWeight")).toBe("600");
  const section = await openTextStyles(page);
  await styleRow(section, "Eyebrow").click();
  await choose(page, /^Weight, /, /^Bold 700/);
  // On the canvas, at once.
  await expect.poll(() => computed(kicker, "fontWeight")).toBe("700");
  await expect
    .poll(
      async () =>
        (
          (await storedStyle(page.request, "Eyebrow"))?.styles as {
            base: { base: Record<string, unknown> };
          }
        )?.base.base.fontWeight
    )
    .toBe(700);
  await page.keyboard.press("Escape");
  for (const slug of slugs) {
    await page.goto(`/blocks/${slug}`);
    const text = page.getByText("A kicker over the heading");
    await expect.poll(() => computed(text, "fontWeight")).toBe("700");
    expect(await computed(text, "textTransform")).toBe("uppercase");
  }
});

test("removing Eyebrow while it is used is refused, saying where, and a lock holds it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openEditorWith(page, NODES, "ts-h1");
  // Counted whole, so the removal answers "in use", never "not counted yet".
  await countEveryPage(page.request);
  const section = await openTextStyles(page);
  const row = styleRow(section, "Eyebrow");
  await section
    .getByRole("button", { name: "More actions for Eyebrow" })
    .click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(section.getByRole("alert")).toContainText(/used/i);
  expect(await storedStyle(page.request, "Eyebrow")).toBeDefined();

  await section
    .getByRole("button", { name: "More actions for Eyebrow" })
    .click();
  await page.getByRole("menuitem", { name: "Lock" }).click();
  await expect
    .poll(async () => (await storedStyle(page.request, "Eyebrow"))?.locked)
    .toBe(true);
  await expect(row).toHaveAccessibleName(/, locked$/);
  await row.click();
  const popup = page.getByRole("dialog", { name: "Edit Eyebrow" });
  await expect(popup).toContainText(
    "Eyebrow is locked. Unlock it to change it."
  );
  await expect(popup.getByRole("radio", { name: "lowercase" })).toBeDisabled();
  await page.keyboard.press("Escape");
  // No Rename or Remove on a locked one; Unlock lifts it.
  await section
    .getByRole("button", { name: "More actions for Eyebrow" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Remove" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Unlock" }).click();
  await expect
    .poll(async () => (await storedStyle(page.request, "Eyebrow"))?.locked)
    .toBeUndefined();
});

test("Heading 1 follows Display, and every H1 draws it", async ({ page }) => {
  test.setTimeout(300_000);
  const tokensBefore = (await stored(page.request)).tokens;
  try {
    await openEditorWith(page, NODES, "ts-h1");
    const heading = (await block(page, "ts-h1"))
      .locator("h1")
      .or(await block(page, "ts-h1"));
    await openTextStyles(page);
    const siteText = page
      .getByRole("region", { name: "Design panel" })
      .getByRole("region", { name: "Site text" });
    await siteText
      .getByRole("button", { name: /^Site text: Heading 1,/ })
      .click();
    const popup = page.getByRole("dialog", { name: "Edit Heading 1" });
    await popup.getByRole("radio", { name: "Text style: Display" }).click();
    await expect(
      popup.getByRole("radio", { name: "Text style: Display" })
    ).toBeChecked();
    await expect.poll(() => computed(heading.first(), "fontSize")).toBe("56px");
    await page.keyboard.press("Escape");
    await expect(
      siteText.getByRole("button", {
        name: "Site text: Heading 1 uses Display",
      })
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            (await stored(page.request)).tokens?.siteText as
              | Record<string, Record<string, unknown>>
              | undefined
          )?.h1?.textStyle
      )
      .toBe(DISPLAY.id);
  } finally {
    await store(page.request, { tokens: tokensBefore });
  }
});

test("Undo and Redo take a text style's change back and forward", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openEditorWith(page, NODES, "ts-kicker");
  const section = await openTextStyles(page);
  await styleRow(section, "Eyebrow").click();
  const popup = page.getByRole("dialog", { name: "Edit Eyebrow" });
  await popup.getByRole("radio", { name: "lowercase" }).click();
  await expect(popup.getByRole("radio", { name: "lowercase" })).toBeChecked();
  const transform = async () =>
    (
      (await storedStyle(page.request, "Eyebrow"))?.styles as {
        base: { base: Record<string, unknown> };
      }
    )?.base.base.textTransform;
  await expect.poll(transform).toBe("lowercase");
  await page.keyboard.press("Escape");
  const kicker = await block(page, "ts-kicker");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(transform).toBe("uppercase");
  await expect.poll(() => computed(kicker, "textTransform")).toBe("uppercase");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(transform).toBe("lowercase");
  await expect.poll(() => computed(kicker, "textTransform")).toBe("lowercase");
});

test("the rows are made, renamed and opened with the keyboard alone", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openEditorWith(page, NODES, "ts-h1");
  const section = await openTextStyles(page);
  await section.getByRole("button", { name: "+ Add text style" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Caption note");
  await page.keyboard.press("Enter");
  const made = styleRow(section, "Caption note");
  await expect(made).toBeVisible();

  await made.focus();
  await page.keyboard.press("F2");
  const rename = section.getByRole("textbox", { name: "Rename Caption note" });
  await expect(rename).toBeFocused();
  await rename.fill("Small print");
  await page.keyboard.press("Enter");
  const renamed = styleRow(section, "Small print");
  await expect(renamed).toBeVisible();

  await renamed.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(renamed).toBeFocused();

  await page.keyboard.press("Enter");
  const popup = page.getByRole("dialog", { name: "Edit Small print" });
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(renamed).toBeFocused();
});

test("at the panel's narrowest the rows fit, a popup stays in the window, and the tab passes the scan, in light and dark", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openEditorWith(page, NODES, "ts-h1");
  for (const dark of [false, true]) {
    await page.evaluate(wantDark => {
      document.documentElement.classList.toggle("dark", wantDark);
    }, dark);
    const section = await openTextStyles(page);
    const panel = page.getByRole("region", { name: "Design panel" });
    const divider = page.getByRole("separator", { name: "Panel and canvas" });
    await divider.focus();
    await page.keyboard.press("Home");
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
      .toBeLessThanOrEqual(240);
    const sideways = await section.evaluate(element => {
      const scrolled = [element, ...element.querySelectorAll("*")].find(
        each =>
          each.scrollWidth > each.clientWidth + 1 &&
          getComputedStyle(each).overflowX !== "visible" &&
          getComputedStyle(each).textOverflow !== "ellipsis"
      );
      return scrolled === undefined ? null : scrolled.className;
    });
    expect(
      sideways,
      `no text style row scrolls sideways, dark=${dark}`
    ).toBeNull();
    await expectNoAxeViolations(page, {
      include: '[aria-label="Design panel"]',
    });
    await styleRow(section, "Display").click();
    const popup = page.getByRole("dialog", { name: "Edit Display" });
    await expect(popup).toBeVisible();
    const box = await popup.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }
    await page.keyboard.press("Escape");
  }
});

test("a role that may read Design but not change it sees the text styles and can't change one", async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  try {
    const made = await page.request.post(
      "/admin/api/collections/pages/entries",
      {
        data: {
          title: "Text styles read-only",
          slug: `text-styles-read-only-${Date.now()}`,
          content: { formatVersion: 1, kind: "page", nodes: [NODES[1]] },
        },
      }
    );
    expect(made.ok(), await made.text()).toBe(true);
    const pageId = ((await made.json()) as { item: { id: string } }).item.id;
    created.push(`pages|${pageId}`);
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(view, `/collections/pages/${pageId}/builder?field=content`);
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });
    const section = await openTextStyles(view);
    await expect(styleRow(section, "Eyebrow")).toBeVisible();
    await expect(
      section.getByRole("button", { name: "+ Add text style" })
    ).toHaveCount(0);
    await expect(
      section.getByRole("button", { name: /^More actions for/ })
    ).toHaveCount(0);
    await styleRow(section, "Eyebrow").click();
    const popup = view.getByRole("dialog", { name: "Eyebrow" });
    await expect(popup).toContainText("You can't change this site's design.");
    for (const radio of await popup.getByRole("radio").all()) {
      await expect(radio).toBeDisabled();
    }
    const headers = await writeHeaders(reader.context.request);
    const refused = await reader.context.request.patch(SITE_STYLE, {
      headers,
      data: {
        classes: [{ ...EYEBROW, label: "Renamed" }, DISPLAY],
        _overwrite: true,
      },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect(await storedStyle(page.request, "Eyebrow")).toBeDefined();
  } finally {
    await reader.context.close();
  }
});
