/**
 * A Text takes bold, italic and links, edited on the canvas with a floating
 * bar: in a real browser, because the selection the bar is drawn over, the
 * keys Lexical answers and a paste all need one.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * page builder document, and read back through its API and its published
 * page, so what is asserted is what an author and a visitor see.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-text-marks
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

const HOMEPAGE = "/admin/api/singles/homepage";
const OPEN_BUILDER_ACTION = /^Open in builder$/;

/** The element the renderer marks as carrying the Text's words. */
const WORDS = '[data-nx-prop="text"]';

/** The notice a paste that lost formatting leaves, in the agreed words. */
const DROPPED =
  "Text keeps words, bold, italic and links. Use Rich text for headings and lists";

/** A homepage layout holding one Text, saved as a version-1 string. */
function layoutWith(text: string) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "words", type: "core/text", version: 1, props: { text } }],
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

async function openBuilder(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(canvasFrame(page).locator(WORDS).first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Enter the Text: select it, then Enter, the keyboard's way in. Aimed by
 * selection rather than a double-click, because the block bar drawn over
 * the first block on a page can take the second click.
 */
async function enterWords(page: Page): Promise<void> {
  await canvasFrame(page).locator(WORDS).first().click();
  await expect(
    page.getByRole("toolbar", { name: "Block actions" })
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    canvasFrame(page).locator(`${WORDS}[contenteditable="true"]`)
  ).toBeVisible({ timeout: 60_000 });
}

/** Select the last `count` characters before the caret's line end. */
async function selectLast(page: Page, count: number): Promise<void> {
  await page.keyboard.press("End");
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+ArrowLeft");
}

/** Select the first `count` characters of the line. */
async function selectFirst(page: Page, count: number): Promise<void> {
  await page.keyboard.press("Home");
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+ArrowRight");
}

/** The homepage layout as stored. */
async function storedText(page: Page): Promise<unknown> {
  const read = await page.request.get(`${HOMEPAGE}?draft=true`);
  expect(read.ok(), `reading the homepage: ${read.status()}`).toBe(true);
  const body = (await read.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const layout = (
    typeof item.layout === "string" ? JSON.parse(item.layout) : item.layout
  ) as { nodes: { props: { text: unknown } }[] };
  return layout.nodes[0]?.props.text;
}

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ mode: "serial", lock: [LOCK.homepage] });

test.describe("a Text edited on the canvas", () => {
  test("takes bold, italic, a link and line breaks from its bar and its keys", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Hello world"));
    await openBuilder(page);
    await enterWords(page);

    // Selecting words draws the bar over them: B, I and Link, nothing more.
    await selectLast(page, 5);
    const bar = page.getByRole("toolbar", { name: "Text formatting" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveText(["B", "I", "Link"]);
    for (const absent of [/^H2$/, /^H3$/, /bullet/i, /quote/i]) {
      await expect(bar.getByRole("button", { name: absent })).toHaveCount(0);
    }

    const words = canvasFrame(page).locator(WORDS).first();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(words.locator("strong")).toHaveText("world");

    // The bar's own I, pressed with the pointer, keeps the selection.
    await selectFirst(page, 5);
    await bar.getByRole("button", { name: "Italic" }).click();
    await expect(words.locator("em")).toHaveText("Hello");
    await expect(
      canvasFrame(page).locator(`${WORDS}[contenteditable="true"]`)
    ).toBeVisible();

    // ⌘K opens the address field for the selected words.
    await selectLast(page, 5);
    await page.keyboard.press("ControlOrMeta+k");
    const address = page.getByRole("textbox", { name: "Link address" });
    await expect(address).toBeFocused();
    await address.fill("javascript:alert(1)");
    await address.press("Enter");
    await expect(
      page.getByRole("toolbar", { name: "Text formatting" }).getByRole("alert")
    ).toHaveText("This address can't be used for a link.");
    await address.fill("https://example.com/survey");
    await address.press("Enter");
    await expect(words.locator("a")).toHaveAttribute(
      "href",
      "https://example.com/survey"
    );

    // Enter and Shift+Enter are line breaks: still one paragraph.
    await words.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Third");
    await expect(words.locator("br")).toHaveCount(2);
    await expect(words.locator("p")).toHaveCount(1);
    await expect(words).toContainText("Third");

    // Leaving writes it, restricted, and the page draws it.
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /^(Save|Save draft|Publish)$/ })
      .first()
      .click();
    await expect
      .poll(async () => JSON.stringify(await storedText(page)), {
        timeout: 15_000,
      })
      .toContain("https://example.com/survey");
    const stored = JSON.stringify(await storedText(page));
    expect(stored).toContain('"linebreak"');
    expect(stored).not.toContain("javascript:");
  });

  test("keeps a pasted passage's words, drops its headings and lists, and says so", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Start"));
    await openBuilder(page);
    await enterWords(page);
    await page.keyboard.press("End");
    await canvasFrame(page)
      .locator(WORDS)
      .first()
      .evaluate(element => {
        const data = new DataTransfer();
        data.setData(
          "text/html",
          "<h2>Our process</h2><ul><li>Survey</li><li><u>Report</u></li></ul>"
        );
        data.setData("text/plain", "Our process\nSurvey\nReport");
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          })
        );
      });
    const words = canvasFrame(page).locator(WORDS).first();
    await expect(words).toContainText("Our process");
    await expect(words).toContainText("Report");
    await expect(words.locator("h2, ul, li, u")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: DROPPED })
    ).toBeVisible();
  });

  test("reaches the bar from the keyboard, and goes back to the words", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Keyboard words"));
    await openBuilder(page);
    await enterWords(page);
    const bold = page
      .getByRole("toolbar", { name: "Text formatting" })
      .getByRole("button", { name: "Bold" });
    // From a caret with nothing selected, the bar is drawn and reached too.
    await page.keyboard.press("End");
    await page.keyboard.press("Alt+F10");
    await expect(bold).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      canvasFrame(page).locator(`${WORDS}[contenteditable="true"]`)
    ).toBeFocused();
    await selectLast(page, 5);
    await page.keyboard.press("Alt+F10");
    await expect(bold).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: "Italic" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(canvasFrame(page).locator(`${WORDS} em`)).toHaveText("words");
    await page.keyboard.press("Escape");
    await expect(
      canvasFrame(page).locator(`${WORDS}[contenteditable="true"]`)
    ).toBeFocused();
  });

  test("updates the canvas while words are typed in the panel, not on leaving", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("Panel"));
    await openBuilder(page);
    await canvasFrame(page).locator(WORDS).first().click();
    const field = page.getByRole("textbox", { name: "Text", exact: true });
    await field.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" typed live");
    // Still in the field: nothing has been left.
    await expect(field).toBeFocused();
    await expect(canvasFrame(page).locator(WORDS).first()).toHaveText(
      "Panel typed live"
    );
  });
});

test.describe("a Text saved before marks", () => {
  test("opens and is published as it was, each line on its own", async ({
    page,
  }) => {
    test.slow();
    await seed(page, layoutWith("First line\nSecond line"));
    await page.goto("/");
    const published = page.locator("p", { hasText: "First line" }).first();
    await expect(published).toBeVisible({ timeout: 30_000 });
    expect(await published.innerHTML()).toBe("First line<br>Second line");

    await openBuilder(page);
    const words = canvasFrame(page).locator(WORDS).first();
    await expect(words.locator("br")).toHaveCount(1);
    await expect(words).toHaveText("First lineSecond line");
  });

  test("is published with its bold, italic and link, and nothing it cannot hold", async ({
    page,
  }) => {
    test.slow();
    await seed(page, {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "words",
          type: "core/text",
          version: 2,
          props: {
            text: {
              root: {
                type: "root",
                children: [
                  {
                    type: "heading",
                    tag: "h1",
                    children: [{ type: "text", text: "Not a heading" }],
                  },
                  {
                    type: "paragraph",
                    children: [
                      { type: "text", text: "Bold", format: 1 },
                      { type: "linebreak" },
                      { type: "text", text: "Italic", format: 2 },
                      {
                        type: "link",
                        url: "javascript:alert(1)",
                        children: [{ type: "text", text: " unsafe" }],
                      },
                      {
                        type: "link",
                        url: "/about",
                        target: "_blank",
                        children: [{ type: "text", text: " about" }],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    });
    await page.goto("/");
    const published = page.locator("p", { hasText: "Not a heading" }).first();
    await expect(published).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Not a heading" })
    ).toHaveCount(0);
    await expect(published.locator("strong")).toHaveText("Bold");
    await expect(published.locator("em")).toHaveText("Italic");
    await expect(published.locator("a")).toHaveCount(1);
    await expect(published.locator("a")).toHaveAttribute("href", "/about");
    await expect(published.locator("a")).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
    await expect(published).toContainText("unsafe");
  });
});
