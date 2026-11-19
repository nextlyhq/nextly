/**
 * The Body and Headings fonts in the browser: "Body font" and "Headings font"
 * at the top of Design → Type, applied to every page.
 *
 * - With nothing picked, no font is written: the page keeps the site's own.
 * - Picking Body sets every paragraph, the header's and the footer's, on the
 *   canvas the site serves, on the editor's blank page and on the published
 *   page; picking Headings sets every heading and leaves paragraphs alone; a
 *   block with a font of its own keeps it. The page declares
 *   `--site-font-body` for a host's own CSS.
 * - A Headings font with no bold says so.
 * - Undo and Redo reverse the Body font.
 * - The rows are reached and changed with the keyboard alone; at the panel's
 *   narrowest they fit and the list stays in the window; the Type tab passes
 *   the accessibility scan in light and dark.
 * - A role that may read Design but not change it sees the fonts and cannot
 *   change them, in the panel or through the API.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 */
import {
  expect,
  type APIRequestContext,
  type Frame,
  type Page,
} from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { CANVAS_FRAME } from "./support/canvas-frame";
import { signInAsLimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage, writeHeaders } from "./support/usage-count";

test.describe.configure({ lock: [LOCK.siteStyle] });

const SITE_STYLE = "/admin/api/singles/site-style";
const PAGES = "/admin/api/collections/pages/entries";
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SLUG = `site-fonts-${STAMP}`;
/** The playground's canvas route, its `canvasPath`. */
const CANVAS_ROUTE = "/page-builder-canvas";

const TEXTS = {
  heading: "A heading in the Headings font",
  text: "A paragraph in the Body font",
  own: "A paragraph with a font of its own",
  header: "Contact us",
} as const;

const NODES = [
  {
    id: "sf-h2",
    type: "core/heading",
    version: 1,
    props: { text: TEXTS.heading, level: "h2" },
  },
  { id: "sf-text", type: "core/text", version: 1, props: { text: TEXTS.text } },
  {
    id: "sf-own",
    type: "core/text",
    version: 1,
    props: { text: TEXTS.own },
    styles: { base: { base: { fontFamily: "fantasy" } } },
  },
];

/** Lora from the catalogue, Regular only, served from this site. */
const LORA = {
  family: "Lora",
  weight: "400",
  src: [{ url: "/fonts/e2e-lora-400.woff2", format: "woff2" }],
  source: { kind: "google", id: "lora", category: "serif", subset: "latin" },
};

interface Stored {
  tokens: {
    tokens?: { name: string; values: { light: string } }[];
    siteText?: Record<string, { fontFamily?: unknown }>;
  } | null;
  fonts: unknown;
}

async function stored(api: APIRequestContext): Promise<Stored> {
  const response = await api.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const parse = (raw: unknown) =>
    (typeof raw === "string" ? JSON.parse(raw) : raw) ?? null;
  return { tokens: parse(item.tokens), fonts: parse(item.fonts) };
}

async function seed(page: Page, style: Stored): Promise<void> {
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens: style.tokens, fonts: style.fonts, _overwrite: true },
  });
  expect(written.ok(), `writing the site style: ${written.status()}`).toBe(
    true
  );
}

let pageId: string | undefined;

/** A published page, drawn inside the site's default header and footer. */
async function seedPage(page: Page): Promise<string> {
  if (pageId !== undefined) return pageId;
  await gotoAdmin(page, "/");
  const created = await page.request.post(PAGES, {
    data: {
      title: `Site fonts ${STAMP}`,
      slug: SLUG,
      status: "published",
      content: { formatVersion: 1, kind: "page", nodes: NODES },
    },
  });
  expect(created.ok(), `seeding the page: ${await created.text()}`).toBe(true);
  pageId = ((await created.json()) as { item: { id: string } }).item.id;
  return pageId;
}

type Fonts = Record<keyof typeof TEXTS, string>;

/**
 * The family each text is drawn in, read off the innermost element holding
 * it, in the document `scope` is evaluated in.
 */
function fontsIn(scope: Page | Frame, within: string): Promise<Fonts> {
  return scope.evaluate(
    ([texts, inside]) => {
      const holder = document.querySelector(inside) ?? document.body;
      const out: Record<string, string> = {};
      for (const [key, text] of Object.entries(texts)) {
        const holds = (each: Element) =>
          (each.textContent ?? "").trim() === text;
        const element = [...holder.querySelectorAll("*")].find(
          each => holds(each) && ![...each.children].some(holds)
        );
        out[key] =
          element === undefined ? "" : getComputedStyle(element).fontFamily;
      }
      return out;
    },
    [TEXTS, within] as const
  ) as Promise<Fonts>;
}

/** The canvas frame's document, once the page is drawn in it. */
async function canvasDocument(page: Page): Promise<Frame> {
  await expect((await canvasRoot(page)).getByText(TEXTS.text)).toBeVisible({
    timeout: 30_000,
  });
  await expect((await canvasRoot(page)).getByText(TEXTS.header)).toBeVisible({
    timeout: 30_000,
  });
  const handle = await page.locator(CANVAS_FRAME).elementHandle();
  const frame = await handle?.contentFrame();
  if (frame === null || frame === undefined) throw new Error("no canvas frame");
  return frame;
}

async function openBuilder(page: Page): Promise<Frame> {
  const id = await seedPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  return canvasDocument(page);
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
  const fonts = panel.getByRole("region", { name: "Body and headings fonts" });
  await expect(fonts).toBeVisible({ timeout: 30_000 });
  return { panel, fonts };
}

/** Pick an entry from a role's list: "Body font" or "Headings font". */
async function pick(
  page: Page,
  role: "Body font" | "Headings font",
  entry: string
): Promise<void> {
  const { fonts } = await openType(page);
  await fonts.getByRole("button", { name: new RegExp(`^${role},`) }).click();
  await page
    .getByRole("listbox", { name: role })
    .getByRole("option", { name: entry, exact: true })
    .click();
}

const LORA_STACK = /^"?Lora"?, serif$/;
const MONO_STACK = /^ui-monospace, monospace$/;

test("Body and Headings reach every page: the canvas, its header and footer, the blank page and the published page", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const before = await stored(page.request);
  try {
    await seed(page, { tokens: before.tokens, fonts: [LORA] });
    await page.setViewportSize({ width: 1440, height: 900 });

    // With nothing picked, nothing is written: the published page's text is
    // in the site's own font, and the page declares the variables anyway.
    await seedPage(page);
    await page.goto(`/${SLUG}`);
    // The host's own font: the one its document body is set in, which a
    // paragraph inherits while nothing is written for it.
    const host = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily
    );
    expect(host).not.toBe("");
    const own = await fontsIn(page, "body");
    expect(own.text, "the paragraph is on the page").not.toBe("");
    expect(own.text).toBe(host);
    expect(own.heading).toBe(host);
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--site-font-body")
          .trim()
      )
    ).not.toBe("");

    // At the top of Type, above the way to the site's fonts.
    const frame = await openBuilder(page);
    const { panel, fonts } = await openType(page);
    await expect(
      fonts.getByRole("button", { name: "Body font, Your site's own font" })
    ).toBeVisible();
    await expect(
      fonts.getByRole("button", { name: "Headings font, Same as body" })
    ).toBeVisible();
    const top = async (locator: ReturnType<Page["locator"]>) =>
      (await locator.boundingBox())?.y ?? Number.POSITIVE_INFINITY;
    expect(await top(fonts)).toBeLessThan(
      await top(panel.getByRole("button", { name: "Manage fonts…" }))
    );

    // Body: every paragraph, the header's and the footer's, and the heading
    // with it while Headings is the same as body.
    await pick(page, "Body font", "Lora");
    await expect
      .poll(async () => (await stored(page.request)).tokens?.siteText?.body)
      .toEqual({ fontFamily: { $token: "font.body" } });
    await expect
      .poll(async () => (await fontsIn(frame, ".nx-canvas")).text)
      .toMatch(LORA_STACK);
    let canvas = await fontsIn(frame, ".nx-canvas");
    expect(canvas.header).toMatch(LORA_STACK);
    expect(canvas.heading).toMatch(LORA_STACK);
    expect(canvas.own).toBe("fantasy");

    // Headings: every heading, with paragraphs left in the Body font.
    await pick(page, "Headings font", "System monospace");
    await expect
      .poll(async () => (await stored(page.request)).tokens?.siteText?.h2)
      .toMatchObject({ fontFamily: { $token: "font.heading" } });
    await expect
      .poll(async () => (await fontsIn(frame, ".nx-canvas")).heading)
      .toMatch(MONO_STACK);
    canvas = await fontsIn(frame, ".nx-canvas");
    expect(canvas.text).toMatch(LORA_STACK);
    expect(canvas.own).toBe("fantasy");

    // The published page, the playground's own route, reads the same.
    await page.goto(`/${SLUG}`);
    const live = await fontsIn(page, "body");
    expect(live.text).toMatch(LORA_STACK);
    expect(live.header).toMatch(LORA_STACK);
    expect(live.heading).toMatch(MONO_STACK);
    expect(live.own).toBe("fantasy");
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--site-font-body")
          .trim()
      )
    ).toMatch(LORA_STACK);

    // The editor's blank page, where the site's canvas route can't be shown,
    // draws by the same rule.
    await page.route(`**${CANVAS_ROUTE}`, async route => {
      try {
        await route.fulfill({
          status: 404,
          contentType: "text/html",
          body: "<!doctype html><html><body><main>Not found</main></body></html>",
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    const blank = await openBuilder(page);
    expect(blank.url()).toBe("about:srcdoc");
    const drawn = await fontsIn(blank, ".nx-canvas");
    expect(drawn.text).toMatch(LORA_STACK);
    expect(drawn.header).toMatch(LORA_STACK);
    expect(drawn.heading).toMatch(MONO_STACK);
    expect(drawn.own).toBe("fantasy");
    await page.unroute(`**${CANVAS_ROUTE}`);
  } finally {
    await seed(page, before);
  }
});

test("a Headings font with no bold says so, and Undo and Redo reverse the Body font", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await stored(page.request);
  try {
    await seed(page, { tokens: before.tokens, fonts: [LORA] });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBuilder(page);
    await pick(page, "Headings font", "Lora");
    const { fonts } = await openType(page);
    await expect(
      fonts.getByText("Lora has no Bold, so browsers draw a fake bold")
    ).toBeVisible();
    await expect(fonts.getByRole("button", { name: "Add Bold" })).toBeVisible();

    await pick(page, "Body font", "Serif");
    const body = async () =>
      (await stored(page.request)).tokens?.siteText?.body;
    await expect.poll(body).toEqual({ fontFamily: { $token: "font.body" } });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(body).toBeUndefined();
    await expect(
      fonts.getByRole("button", { name: "Body font, Your site's own font" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(body).toEqual({ fontFamily: { $token: "font.body" } });
    await expect(
      fonts.getByRole("button", { name: "Body font, Serif" })
    ).toBeVisible();
  } finally {
    await seed(page, before);
  }
});

test("the fonts are changed with the keyboard alone, fit the narrowest panel, and pass the scan in light and dark", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await stored(page.request);
  try {
    await seed(page, { tokens: before.tokens, fonts: [LORA] });
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const id = await seedPage(page);
      await gotoAdmin(
        page,
        `/collections/pages/${id}/builder?field=content`,
        theme
      );
      await canvasDocument(page);
      const { panel, fonts } = await openType(page);
      const divider = page.getByRole("separator", { name: "Panel and canvas" });
      await divider.focus();
      await page.keyboard.press("Home");
      await expect
        .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
        .toBeLessThanOrEqual(240);
      const sideways = await fonts.evaluate(element => {
        const scrolled = [element, ...element.querySelectorAll("*")].find(
          each =>
            each.scrollWidth > each.clientWidth + 1 &&
            getComputedStyle(each).overflowX !== "visible" &&
            getComputedStyle(each).textOverflow !== "ellipsis" &&
            // Text only a screen reader reads sits in a 1px box that is never
            // drawn, so nobody can scroll it; anything drawn is still checked.
            !(each.clientWidth <= 1 && each.clientHeight <= 1)
        );
        return scrolled === undefined ? null : scrolled.className;
      });
      expect(sideways, "no font row scrolls sideways").toBeNull();
      await expectNoAxeViolations(page, {
        include: '[aria-label="Design panel"]',
      });

      // The keyboard alone: focus the row, open its list, move and pick.
      const headings = fonts.getByRole("button", { name: /^Headings font,/ });
      await headings.focus();
      await page.keyboard.press("Enter");
      const list = page.getByRole("listbox", { name: "Headings font" });
      await expect(list).toBeVisible();
      const box = await list.boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
        expect(box.y + box.height).toBeLessThanOrEqual(720);
      }
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
      await expect(headings).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(list).toBeVisible();
      // From "Same as body" to the first of the site's fonts.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await stored(page.request)).tokens?.siteText?.h1)
        .toMatchObject({ fontFamily: { $token: "font.heading" } });
      await expect(headings).toHaveAccessibleName("Headings font, Lora");
      await seed(page, { tokens: before.tokens, fonts: [LORA] });
    }
  } finally {
    await seed(page, before);
  }
});

test("a role that may read Design but not change it sees the fonts and cannot change them", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL ?? "";
  const before = await stored(page.request);
  const reader = await signInAsLimitedUser(browser, page.request, baseURL, [
    "read-pages",
    "update-pages",
    "read-components",
    "read-site-style",
  ]);
  try {
    await seed(page, { tokens: before.tokens, fonts: [LORA] });
    // A page of its own, which no other test holds open for editing.
    const created = await page.request.post(PAGES, {
      data: {
        title: `Site fonts read-only ${STAMP}`,
        slug: `${SLUG}-read-only`,
        content: { formatVersion: 1, kind: "page", nodes: NODES },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const id = ((await created.json()) as { item: { id: string } }).item.id;
    const view = await reader.context.newPage();
    await view.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(view, `/collections/pages/${id}/builder?field=content`);
    await expect(view.getByRole("region", { name: "Canvas" })).toBeVisible({
      timeout: 30_000,
    });
    const { fonts } = await openType(view);
    await expect(fonts).toContainText("Body font");
    await expect(fonts).toContainText("Your site's own font");
    await expect(fonts.getByRole("button")).toHaveCount(0);
    const headers = await writeHeaders(reader.context.request);
    const refused = await reader.context.request.patch(SITE_STYLE, {
      headers,
      data: {
        tokens: {
          tokens: [
            {
              name: "font.body",
              kind: "fontFamily",
              values: { light: '"Lora", serif' },
            },
          ],
          siteText: { body: { fontFamily: { $token: "font.body" } } },
        },
        _overwrite: true,
      },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect((await stored(page.request)).tokens?.siteText?.body).toBeUndefined();
  } finally {
    await reader.context.close();
    await seed(page, before);
  }
});
