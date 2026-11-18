/**
 * A Rich text is edited on the canvas with the floating bar, and in a full
 * editor when wanted: in a real browser, because the selection the bar is
 * drawn over, the keys Lexical answers and the field's height all need one.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * page builder document, and read back through its API, so what is asserted
 * is what an author and a visitor see.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-rich-text-toolbar
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

const HOMEPAGE = "/admin/api/singles/homepage";
const OPEN_BUILDER_ACTION = /^Open in builder$/;

/** The element the renderer marks as carrying the passage. */
const PASSAGE = '[data-nx-prop="content"]';

/** The panel's line, and its button, in the agreed words. */
const PANEL_LINE =
  "Edit on the canvas. Select text for bold, links, headings and lists.";
const OPEN_FULL_EDITOR = "Open the full editor";

/** The bar's buttons for a Rich text, by their accessible names. */
const RICH_TEXT_BUTTONS = [
  "Bold",
  "Italic",
  "Link",
  "Heading 2",
  "Heading 3",
  "Bullets",
  "Numbers",
  "Quote",
];

const words = (text: string) => ({
  type: "text",
  text,
  format: 0,
  style: "",
  mode: "normal",
  detail: 0,
  version: 1,
});

const paragraph = (text: string) => ({
  type: "paragraph",
  format: "",
  indent: 0,
  version: 1,
  direction: null,
  children: [words(text)],
});

/** A homepage layout holding one Rich text of the given paragraphs. */
function layoutWith(...paragraphs: string[]) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "passage",
        type: "core/rich-text",
        version: 1,
        props: {
          content: {
            root: {
              type: "root",
              format: "",
              indent: 0,
              version: 1,
              direction: null,
              children: paragraphs.map(paragraph),
            },
          },
        },
      },
    ],
  };
}

async function seed(page: Page, layout: unknown): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE, {
    data: { layout, _overwrite: true },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

async function openBuilder(
  page: Page,
  scheme?: "light" | "dark"
): Promise<void> {
  await gotoAdmin(page, "/singles/homepage", scheme);
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(canvasFrame(page).locator(PASSAGE).first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Enter the passage: select it, then Enter, the keyboard's way in. Aimed by
 * selection rather than a double-click, because the block bar drawn over
 * the first block on a page can take the second click.
 */
async function enterPassage(page: Page): Promise<void> {
  await canvasFrame(page).locator(PASSAGE).first().click();
  await expect(
    page.getByRole("toolbar", { name: "Block actions" })
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    canvasFrame(page).locator(`${PASSAGE}[contenteditable="true"]`)
  ).toBeVisible({ timeout: 60_000 });
}

/** Select the first `count` characters of the caret's line. */
async function selectFirst(page: Page, count: number): Promise<void> {
  await page.keyboard.press("Home");
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+ArrowRight");
}

/** The accessible names of a toolbar's buttons, in order. */
async function buttonNames(toolbar: Locator): Promise<string[]> {
  return toolbar
    .getByRole("button")
    .evaluateAll(buttons =>
      buttons.map(
        button => button.getAttribute("aria-label") ?? button.textContent ?? ""
      )
    );
}

/** The passage as stored. */
async function storedPassage(page: Page): Promise<string> {
  const read = await page.request.get(`${HOMEPAGE}?draft=true`);
  expect(read.ok(), `reading the homepage: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const layout = (
    typeof item.layout === "string" ? JSON.parse(item.layout) : item.layout
  ) as { nodes: { props: { content: unknown } }[] };
  return JSON.stringify(layout.nodes[0]?.props.content);
}

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ mode: "serial", lock: [LOCK.homepage] });

test.describe("a Rich text edited on the canvas", () => {
  test("offers B, I, Link, H2, H3, bullets, numbers, quote and Turn into over selected words", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Hello world"));
    await openBuilder(page);
    await enterPassage(page);
    await selectFirst(page, 5);
    const bar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(bar).toBeVisible();
    expect(await buttonNames(bar)).toEqual([...RICH_TEXT_BUTTONS, "Turn into"]);
  });

  test("shows each action on the canvas as it goes, and stores it", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Hello world", "Second", "Third", "Fourth"));
    await openBuilder(page);
    await enterPassage(page);
    const passage = canvasFrame(page).locator(PASSAGE).first();
    const bar = page.getByRole("toolbar", { name: "Text formatting" });

    // B and I on "Hello".
    await passage.locator(":scope > *").first().click();
    await selectFirst(page, 5);
    await bar.getByRole("button", { name: "Bold" }).click();
    await bar.getByRole("button", { name: "Italic" }).click();
    await expect(passage.locator("strong")).toContainText("Hello");
    await expect(passage.locator("em")).toContainText("Hello");

    // A link on "world".
    await page.keyboard.press("End");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
    await bar.getByRole("button", { name: "Link" }).click();
    await page
      .getByRole("textbox", { name: "Link address" })
      .fill("https://example.com/");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(passage.locator("a")).toHaveAttribute(
      "href",
      "https://example.com/"
    );

    // A block action on one line, said on in the bar, drawn on the canvas.
    const blockOn = async (line: number, name: string) => {
      await passage.locator(":scope > *").nth(line).click();
      await selectFirst(page, 2);
      await bar.getByRole("button", { name }).click();
      await expect(bar.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    };
    await blockOn(1, "Heading 3");
    await expect(passage.locator("h3")).toHaveText("Second");
    await blockOn(2, "Bullets");
    await expect(passage.locator("ul li")).toHaveText("Third");
    await blockOn(3, "Numbers");
    await expect(passage.locator("ol li")).toHaveText("Fourth");
    await blockOn(0, "Heading 2");
    await expect(passage.locator("h2")).toContainText("Hello");
    await blockOn(0, "Quote");
    await expect(passage.locator("blockquote")).toContainText("Hello");

    // Leaving the passage finishes the edit; saving stores it.
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => storedPassage(page), { timeout: 30_000 })
      .toContain('"type":"quote"');
    const stored = await storedPassage(page);
    expect(stored).toContain('"tag":"h3"');
    expect(stored).toContain('"listType":"bullet"');
    expect(stored).toContain('"listType":"number"');
    expect(stored).toContain('"url":"https://example.com/"');
  });

  test("reaches the bar from the keyboard with Alt+F10, in the dark theme", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Hello world"));
    await openBuilder(page, "dark");
    await enterPassage(page);
    await page.keyboard.press("Alt+F10");
    const bar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(bar.getByRole("button", { name: "Bold" })).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    const h2 = bar.getByRole("button", { name: "Heading 2" });
    await expect(h2).toBeFocused();
    // A visible focus ring on the bar's ink.
    expect(
      await h2.evaluate(button => getComputedStyle(button).outlineStyle)
    ).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(canvasFrame(page).locator(`${PASSAGE} h2`)).toHaveText(
      "Hello world"
    );
  });
});

test.describe("a Rich text in the panel", () => {
  test("says it is edited on the canvas; its field is four lines high, holds still on focus and grows", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("One line"));
    await openBuilder(page);
    await canvasFrame(page).locator(PASSAGE).first().click();
    await expect(page.getByText(PANEL_LINE)).toBeVisible();
    const field = page.getByRole("textbox", { name: "Text", exact: true });
    const lineHeight = await field.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).lineHeight)
    );
    const before = (await field.boundingBox())?.height ?? 0;
    expect(before).toBeGreaterThanOrEqual(lineHeight * 4);

    await field.click();
    await expect(field).toHaveAttribute("contenteditable", "true");
    const focused = (await field.boundingBox())?.height ?? 0;
    expect(Math.abs(focused - before)).toBeLessThan(1);

    await page.keyboard.press("End");
    for (const line of ["Two", "Three", "Four", "Five", "Six"]) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(line);
    }
    const grown = (await field.boundingBox())?.height ?? 0;
    expect(grown).toBeGreaterThan(before + lineHeight);
  });

  test("opens the full editor; Done writes and goes back to the block, Cancel does not", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Hello world"));
    await openBuilder(page);
    await canvasFrame(page).locator(PASSAGE).first().click();
    const open = page.getByRole("button", { name: OPEN_FULL_EDITOR });

    // Cancel: nothing written, back on the button.
    await open.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: "Text" })).toHaveAttribute(
      "contenteditable",
      "true",
      { timeout: 60_000 }
    );
    expect(
      await buttonNames(
        dialog.getByRole("toolbar", { name: "Text formatting" })
      )
    ).toEqual(RICH_TEXT_BUTTONS);
    await dialog.getByRole("button", { name: "Heading 2" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await expect(canvasFrame(page).locator(`${PASSAGE} h2`)).toHaveCount(0);

    // Done: written and drawn on the canvas, the block still selected.
    await open.click();
    await expect(dialog.getByRole("textbox", { name: "Text" })).toHaveAttribute(
      "contenteditable",
      "true",
      { timeout: 60_000 }
    );
    await dialog.getByRole("button", { name: "Heading 2" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await expect(page.getByText(PANEL_LINE)).toBeVisible();
    await expect(canvasFrame(page).locator(`${PASSAGE} h2`)).toHaveText(
      "Hello world"
    );
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => storedPassage(page), { timeout: 30_000 })
      .toContain('"tag":"h2"');
  });
});
