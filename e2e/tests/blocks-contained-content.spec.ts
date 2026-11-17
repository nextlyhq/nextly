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
    container(
      "26",
      "core/box",
      { as: "div", contained: true },
      [text("27", "Sized box")],
      { width: "600px" }
    ),
    container(
      "28",
      "core/box",
      { as: "div", contained: true },
      [text("29", "Sized box at start")],
      { width: "600px", margin: { inlineStart: "0" } }
    ),
    container(
      "30",
      "core/box",
      { as: "div", contained: false },
      [
        container("31", "core/box", { as: "div", contained: true }, [
          text("32", "Row item one"),
        ]),
        container("33", "core/box", { as: "div", contained: true }, [
          text("34", "Row item two"),
        ]),
      ],
      { display: "flex" }
    ),
    container(
      "40",
      "core/box",
      { as: "div", contained: false },
      [
        container(
          "41",
          "core/box",
          { as: "div", contained: true },
          [text("42", "Full row item")],
          { minWidth: "100%" }
        ),
      ],
      { display: "flex" }
    ),
    container(
      "43",
      "core/box",
      { as: "div", contained: false },
      [
        container(
          "44",
          "core/box",
          { as: "div", contained: false },
          [
            container("45", "core/box", { as: "div", contained: true }, [
              text("46", "Wrapped item one"),
            ]),
            container("47", "core/box", { as: "div", contained: true }, [
              text("48", "Wrapped item two"),
            ]),
          ],
          { display: "contents" }
        ),
      ],
      { display: "flex" }
    ),
    container("35", "core/columns", { as: "div", contained: false }, [
      container("36", "core/column", { as: "div", contained: true }, [
        text("37", "Column item one"),
      ]),
      container("38", "core/column", { as: "div", contained: true }, [
        text("39", "Column item two"),
      ]),
    ]),
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
    // A Card's border sits outside its padding, so its content starts that
    // much further in; the padding itself is the inset.
    const border = await page
      .getByText(words, { exact: true })
      .evaluate(node =>
        parseFloat(
          getComputedStyle(node.parentElement as Element).borderInlineStartWidth
        )
      );
    near(text.left, inset + border);
  }
  const free = await placed(page, "Free box");
  near(free.band.left, 0);
  near(free.text.left, 40);
});

test("a contained block its author sized is centred at that size, its content whole", async ({
  page,
}) => {
  const { pageWidth, gutter } = await open(page, WIDE);
  const sized = await placed(page, "Sized box");
  near(sized.band.width, 600);
  near(sized.band.left, (pageWidth - 600) / 2);
  // No inset inside it: only the gutter, as the least space at each side.
  near(sized.text.left, sized.band.left + gutter);
  near(sized.text.width, 600 - 2 * gutter);
  // An author's own margin outweighs the centring.
  const atStart = await placed(page, "Sized box at start");
  near(atStart.band.left, 0);
  near(atStart.band.width, 600);
});

test("a contained flex item is not inset from the row, nor a grid item from the grid", async ({
  page,
}) => {
  // A padding's `100%` is the row's width, not the item's own, so an item
  // inset from it would overflow a wide page. Treated as sized instead: only
  // the gutter inside its own box.
  const { pageWidth, gutter } = await open(page, { width: 2400, height: 900 });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const words of [
    "Row item one",
    "Row item two",
    "Wrapped item one",
    "Wrapped item two",
    "Column item one",
    "Column item two",
  ]) {
    const { text, band } = await placed(page, words);
    expect(band.width).toBeLessThan(pageWidth);
    near(text.left, band.left + gutter);
  }
});

test("a flex item its author made fill the row keeps its inset", async ({
  page,
}) => {
  const { pageWidth, inset } = await open(page, WIDE);
  const { text, band } = await placed(page, "Full row item");
  near(band.width, pageWidth);
  near(text.left, inset);
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
