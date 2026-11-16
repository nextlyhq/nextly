/**
 * A contained container's background reaches the page edges; only its content
 * is held to the site's content width.
 *
 * A contained Section, Box or Card is one element drawn full width. Its inline
 * padding brings its content in to the content width, with the site's gutter
 * as the least space at each side. An author's own side padding replaces the
 * gutter and can widen the inset, but never takes the content past the content
 * width. Layout is the claim here, so it is measured in a real browser on a
 * real published page: unit tests can check the CSS text, not where a heading
 * lands.
 *
 * Safe to write against: the suite owns its database and empties it before
 * every run.
 */
import { expect, type APIResponse, type Page } from "@playwright/test";

import { fileAccount, test } from "./support/test";

test.describe.configure({ mode: "serial" });

const ENTRIES = "/admin/api/collections/block-pages/entries";
const SLUG = "contained-bands";

/** A wide window, where the content width is narrower than the page. */
const WIDE = { width: 1440, height: 900 };
/** A narrow one, where the gutter is wider than the inset. */
const NARROW = { width: 800, height: 900 };

const BAND = "rgb(230, 240, 255)";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000001${suffix}`;

const text = (suffix: string, words: string) => ({
  id: id(suffix),
  type: "core/text",
  version: 1,
  props: { text: words },
});

const container = (
  suffix: string,
  type: string,
  props: Record<string, unknown>,
  children: unknown[],
  base: Record<string, unknown> = {}
) => ({
  id: id(suffix),
  type,
  version: 1,
  props,
  styles: { base: { base: { backgroundColor: BAND, ...base } } },
  slots: { children },
});

const section = (
  suffix: string,
  children: unknown[],
  base: Record<string, unknown> = {}
) =>
  container(
    suffix,
    "core/section",
    { as: "section", contained: true },
    children,
    base
  );

const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    section("01", [text("02", "Default band")]),
    section("03", [text("04", "Wide padding band")], {
      padding: { inlineStart: "300px", inlineEnd: "300px" },
    }),
    section("05", [text("06", "No padding band")], {
      padding: { inlineStart: "0", inlineEnd: "0" },
    }),
    section("07", [text("08", "Start padding band")], {
      padding: { inlineStart: "300px" },
    }),
    section("09", [text("10", "Row first"), text("11", "Row second")], {
      display: "flex",
    }),
    section("12", [text("13", "Grid first"), text("14", "Grid second")], {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
    }),
    section("15", [
      container("16", "core/box", { as: "div", contained: false }, [
        text("17", "Box inside a band"),
      ]),
      section("18", [text("19", "Nested band")]),
    ]),
    container("20", "core/box", { as: "div", contained: true }, [
      text("21", "Contained box"),
    ]),
    container("22", "core/card", { as: "div", contained: true }, [
      text("23", "Contained card"),
    ]),
    container(
      "24",
      "core/box",
      { as: "div", contained: false },
      [text("25", "Free box")],
      { padding: { inlineStart: "40px" } }
    ),
  ],
};

async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    const created = await api.post(ENTRIES, {
      data: {
        title: "Contained bands",
        slug: SLUG,
        content: DOCUMENT,
        status: "published",
      },
    });
    // A rerun against a kept database finds the row already there.
    if (created.status() !== 409) await expectOk(created, "seeding the page");
  } finally {
    await api.dispose();
  }
});

interface Box {
  left: number;
  right: number;
  width: number;
}

/** Where the text's own element sits, and where the container holding it does. */
async function placed(
  page: Page,
  words: string
): Promise<{ text: Box; band: Box }> {
  return page.getByText(words, { exact: true }).evaluate(node => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };
    return { text: box(node), band: box(node.parentElement as Element) };
  });
}

/** A site length, resolved by the browser. */
async function length(page: Page, value: string): Promise<number> {
  return page.evaluate(css => {
    const probe = document.createElement("div");
    probe.style.width = css;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }, value);
}

async function open(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  const response = await page.goto(`/blocks/${SLUG}`);
  expect(response?.status()).toBe(200);
  const pageWidth = await page.evaluate(
    () => document.documentElement.clientWidth
  );
  const contentWidth = await length(page, "var(--site-content-width)");
  const gutter = await length(page, "var(--site-space-gutter)");
  // Both must resolve, or every inset below would be measured against zero.
  expect(contentWidth).toBeGreaterThan(0);
  expect(gutter).toBeGreaterThan(0);
  return {
    pageWidth,
    inset: Math.max(0, (pageWidth - contentWidth) / 2),
    gutter,
  };
}

const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(1);

test("a contained Section's band is full width and its content starts at the content edge", async ({
  page,
}) => {
  const { pageWidth, inset, gutter } = await open(page, WIDE);
  expect(inset).toBeGreaterThan(gutter);
  const { text, band } = await placed(page, "Default band");
  near(band.left, 0);
  near(band.width, pageWidth);
  await expect(page.locator("section").first()).toHaveCSS(
    "background-color",
    BAND
  );
  near(text.left, inset);
  near(text.right, pageWidth - inset);
});

test("the gutter is the least space at each side on a narrow page", async ({
  page,
}) => {
  const { pageWidth, inset, gutter } = await open(page, NARROW);
  expect(gutter).toBeGreaterThan(inset);
  const { text } = await placed(page, "Default band");
  near(text.left, gutter);
  near(text.right, pageWidth - gutter);
});

test("an author's side padding replaces the gutter and never undoes the containment", async ({
  page,
}) => {
  // Wider than the inset: the content moves further in.
  const wide = await open(page, WIDE);
  expect(300).toBeGreaterThan(wide.inset);
  near((await placed(page, "Wide padding band")).text.left, 300);
  // Zero: no gutter, and still the content edge on a wide page.
  near((await placed(page, "No padding band")).text.left, wide.inset);
  // On a narrow page zero means zero, since it replaced the gutter.
  await open(page, NARROW);
  near((await placed(page, "No padding band")).text.left, 0);
});

test("a row and a grid lay out the band's own children inside the content width", async ({
  page,
}) => {
  const { pageWidth, inset } = await open(page, WIDE);
  for (const [first, second] of [
    ["Row first", "Row second"],
    ["Grid first", "Grid second"],
  ]) {
    const one = await placed(page, first);
    const two = await placed(page, second);
    near(one.band.width, pageWidth);
    near(one.text.left, inset);
    expect(two.text.left).toBeGreaterThan(one.text.right - 1);
    expect(two.text.right).toBeLessThan(pageWidth - inset + 1);
  }
});

test("a block inside a band takes none of its inset", async ({ page }) => {
  const { inset, gutter } = await open(page, WIDE);
  // The Box starts at the band's content edge and adds nothing of its own.
  const inBox = await placed(page, "Box inside a band");
  near(inBox.band.left, inset);
  near(inBox.text.left, inset);
  // A contained Section inside a band is as wide as the band's content, so
  // its own inset is nothing and the gutter is what remains.
  const nested = await placed(page, "Nested band");
  near(nested.band.left, inset);
  near(nested.text.left, inset + gutter);
});

test("a contained Box and Card are banded the same way, and a free Box is unchanged", async ({
  page,
}) => {
  const { pageWidth, inset } = await open(page, WIDE);
  for (const words of ["Contained box", "Contained card"]) {
    const { text, band } = await placed(page, words);
    near(band.width, pageWidth);
    near(text.left, inset);
  }
  const free = await placed(page, "Free box");
  near(free.band.left, 0);
  near(free.text.left, 40);
});

test("the inset follows the writing direction", async ({ page }) => {
  const { pageWidth } = await open(page, WIDE);
  near((await placed(page, "Start padding band")).text.left, 300);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  const rtl = await placed(page, "Start padding band");
  // The start side is now the right: 300px there, the inset on the left.
  near(rtl.text.right, pageWidth - 300);
});
