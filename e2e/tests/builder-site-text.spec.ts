/**
 * Site text in the browser: Design → Type → "Site text", set once for every
 * page.
 *
 * - Pointing Heading 2 at another type size restyles every H2 at once on the
 *   canvas and on two published pages, and no heading or paragraph gains an
 *   outer margin; a block's own size still wins over the row.
 * - Undo and Redo reverse a row's change.
 * - The rows are reached and changed with the keyboard alone, and Escape
 *   closes a row's popup, hands focus back to its row and keeps the canvas
 *   selection.
 * - At the panel's narrowest the rows fit without sideways scrolling and a
 *   popup opened from the last row stays in the window, in light and dark;
 *   the Type tab passes the accessibility scan in both. The scan of a row's
 *   popup waits on the scan measuring a Design popup at all.
 * - A role that may read Design but not change it sees the rows and cannot
 *   change one.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  block,
  OPEN_BUILDER_ACTION,
  openEditorWith,
  PAGE_BUILDER_CARD,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const ENTRIES = "/admin/api/collections/block-pages/entries";
const PAGE_SLUGS = ["site-text-one", "site-text-two"];

/** A type size the site added, with the line height it pairs with. */
const DISPLAY = [
  {
    name: "font-size.display",
    label: "Display",
    kind: "dimension",
    values: { light: "56px" },
  },
  { name: "line-height.display", kind: "number", values: { light: "1.05" } },
];

/** Two headings at level 2, one with a size of its own, and a paragraph. */
const NODES = [
  {
    id: "st-h2",
    type: "core/heading",
    version: 1,
    props: { text: "A second-level heading", level: "h2" },
  },
  {
    id: "st-text",
    type: "core/text",
    version: 1,
    props: { text: "Body text under it" },
  },
  {
    id: "st-own",
    type: "core/heading",
    version: 1,
    props: { text: "A heading with its own size", level: "h2" },
    styles: { base: { base: { fontSize: "19px" } } },
  },
];

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: NODES };

interface StoredSet {
  tokens?: unknown[];
  siteText?: Record<string, unknown>;
}

async function storedTokens(api: APIRequestContext): Promise<StoredSet | null> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredSet | null;
}

async function seed(page: Page, tokens: unknown): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** The Design panel's Type tab, opened. */
async function openType(page: Page) {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Type/ }).click();
  return panel.getByRole("region", { name: "Site text" });
}

/** A computed style of an element. */
async function computed(
  locator: ReturnType<Page["locator"]>,
  property: "fontSize" | "marginTop" | "marginBottom" | "lineHeight"
): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element)[name],
    property
  );
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    for (const slug of PAGE_SLUGS) {
      const created = await api.post(ENTRIES, {
        data: { title: slug, slug, content: DOCUMENT, status: "published" },
      });
      if (created.status() !== 409) {
        expect(created.ok(), `seeding ${slug}: ${await created.text()}`).toBe(
          true
        );
      }
    }
  } finally {
    await api.dispose();
  }
});

test("Heading 2 pointed at another type size restyles every H2 on the canvas at once and on two published pages", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: DISPLAY });
    await page.setViewportSize({ width: 1280, height: 720 });
    // Before any change, the heading looks as it did: 28px at a 16px root.
    await page.goto(`/blocks/${PAGE_SLUGS[0]}`);
    await expect
      .poll(() =>
        computed(
          page.getByRole("heading", { name: "A second-level heading" }),
          "fontSize"
        )
      )
      .toBe("28px");

    await openEditorWith(page, NODES, "st-h2");
    const heading = (await block(page, "st-h2"))
      .locator("h2")
      .or(await block(page, "st-h2"));
    await expect.poll(() => computed(heading.first(), "fontSize")).toBe("28px");
    const section = await openType(page);
    await section
      .getByRole("button", { name: /^Site text: Heading 2,/ })
      .click();
    const popup = page.getByRole("dialog", { name: "Edit Heading 2" });
    await popup.getByRole("radio", { name: "Display · 56 / 1.05" }).check();

    // On the canvas, at once.
    await expect.poll(() => computed(heading.first(), "fontSize")).toBe("56px");
    // A block's own size still wins over the row.
    const own = (await block(page, "st-own"))
      .locator("h2")
      .or(await block(page, "st-own"));
    await expect.poll(() => computed(own.first(), "fontSize")).toBe("19px");
    await expect
      .poll(async () => (await storedTokens(page.request))?.siteText?.h2)
      .toEqual({
        fontSize: { $token: "font-size.display" },
        lineHeight: { $token: "line-height.display" },
      });
    await page.keyboard.press("Escape");

    // And on both published pages, with no outer margin on any heading or
    // paragraph.
    for (const slug of PAGE_SLUGS) {
      await page.goto(`/blocks/${slug}`);
      const h2 = page.getByRole("heading", { name: "A second-level heading" });
      await expect.poll(() => computed(h2, "fontSize")).toBe("56px");
      expect(await computed(h2, "lineHeight")).toBe("58.8px");
      expect(await computed(h2, "marginTop")).toBe("0px");
      expect(await computed(h2, "marginBottom")).toBe("0px");
      const text = page.getByText("Body text under it");
      expect(await computed(text, "marginTop")).toBe("0px");
      expect(
        await computed(
          page.getByRole("heading", { name: "A heading with its own size" }),
          "fontSize"
        )
      ).toBe("19px");
    }
  } finally {
    await seed(page, before);
  }
});

test("Undo and Redo reverse a Site text row's change", async ({ page }) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: DISPLAY });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "st-h2");
    const section = await openType(page);
    await section.getByRole("button", { name: /^Site text: Body,/ }).click();
    const popup = page.getByRole("dialog", { name: "Edit Body" });
    await popup.getByRole("radio", { name: /^Small · / }).check();
    const body = async () => (await storedTokens(page.request))?.siteText?.body;
    await expect.poll(body).toEqual({
      fontSize: { $token: "font-size.small" },
      lineHeight: { $token: "line-height.small" },
    });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(body).toBeUndefined();
    await expect(
      section.getByRole("button", { name: /^Site text: Body,/ })
    ).toContainText("Your site's own");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(body).toEqual({
      fontSize: { $token: "font-size.small" },
      lineHeight: { $token: "line-height.small" },
    });
  } finally {
    await seed(page, before);
  }
});

test("the rows are reached and changed with the keyboard alone, and Escape keeps the canvas selection", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: DISPLAY });
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEditorWith(page, NODES, "st-h2");
    await (await block(page, "st-text")).click();
    await expect.poll(() => selection(page)).toEqual(["st-text"]);
    const section = await openType(page);
    const row = section.getByRole("button", { name: /^Site text: Heading 3,/ });
    await row.focus();
    await page.keyboard.press("Enter");
    const popup = page.getByRole("dialog", { name: "Edit Heading 3" });
    await expect(popup).toBeVisible();
    // Into the type sizes, and across them with the arrow keys.
    const checked = popup.getByRole("radio", { checked: true });
    await checked.focus();
    await page.keyboard.press("ArrowDown");
    const h3 = async () => (await storedTokens(page.request))?.siteText?.h3;
    await expect.poll(h3).toBeDefined();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(row).toBeFocused();
    // The block chosen on the canvas is still the one selected.
    expect(await selection(page)).toEqual(["st-text"]);
  } finally {
    await seed(page, before);
  }
});

test("at the panel's narrowest the rows fit, and the last row's popup stays in the window, in light and dark", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await storedTokens(page.request);
  try {
    await seed(page, { tokens: DISPLAY });
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openEditorWith(page, NODES, "st-h2");
      if (theme === "dark") {
        await gotoAdmin(page, "/singles/homepage", "dark");
        await page
          .locator(PAGE_BUILDER_CARD)
          .getByRole("link", { name: OPEN_BUILDER_ACTION })
          .click();
      }
      const section = await openType(page);
      const panel = page.getByRole("region", { name: "Design panel" });
      const divider = page.getByRole("separator", { name: "Panel and canvas" });
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
        .toBeLessThanOrEqual(240);
      // Text cut short with an ellipsis is cut by design, its whole text
      // in the row's name or tooltip; anything else wider than its box would
      // scroll.
      const sideways = await section.evaluate(element => {
        const scrolled = [element, ...element.querySelectorAll("*")].find(
          each =>
            each.scrollWidth > each.clientWidth + 1 &&
            getComputedStyle(each).overflowX !== "visible" &&
            getComputedStyle(each).textOverflow !== "ellipsis"
        );
        return scrolled === undefined ? null : scrolled.className;
      });
      expect(sideways, "no Site text row scrolls sideways").toBeNull();
      await expectNoAxeViolations(page, {
        include: '[aria-label="Design panel"]',
      });
      await section
        .getByRole("button", { name: /^Site text: Captions,/ })
        .click();
      const popup = page.getByRole("dialog", { name: "Edit Captions" });
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
  } finally {
    await seed(page, before);
  }
});

// While any Design popup is open, axe measures no contrast anywhere on the
// page, a row's own popup included, so a scan of it proves nothing yet and is
// refused as empty. Enabled once the scan measures the popup.
test.fixme(
  "a Site text row's popup passes the accessibility scan in light and dark",
  async ({ page }) => {
    await seed(page, { tokens: DISPLAY });
    await openEditorWith(page, NODES, "st-h2");
    const section = await openType(page);
    await section.getByRole("button", { name: /^Site text: Links,/ }).click();
    await expectNoAxeViolations(page, { include: ".nx-vars-editor" });
  }
);

test("a role that may read Design but not change it sees the rows and cannot change one", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const before = await storedTokens(page.request);
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  try {
    await seed(page, { tokens: DISPLAY });
    const created = await page.request.post(
      "/admin/api/collections/pages/entries",
      {
        data: {
          title: "Site text read-only",
          slug: `site-text-read-only-${Date.now()}`,
          content: DOCUMENT,
        },
      }
    );
    expect(created.ok(), await created.text()).toBe(true);
    const pageId = ((await created.json()) as { item: { id: string } }).item.id;
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(view, `/collections/pages/${pageId}/builder?field=content`);
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });
    const section = await openType(view);
    await section
      .getByRole("button", { name: /^Site text: Heading 2,/ })
      .click();
    const popup = view.getByRole("dialog", { name: "Heading 2" });
    for (const radio of await popup.getByRole("radio").all()) {
      await expect(radio).toBeDisabled();
    }
    const headers = await writeHeaders(reader.context.request);
    const refused = await reader.context.request.patch(SITE_STYLE, {
      headers,
      data: {
        tokens: { tokens: DISPLAY, siteText: { h2: { fontSize: "40px" } } },
        _overwrite: true,
      },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect((await storedTokens(page.request))?.siteText).toBeUndefined();
  } finally {
    await reader.context.close();
    await seed(page, before);
  }
});
