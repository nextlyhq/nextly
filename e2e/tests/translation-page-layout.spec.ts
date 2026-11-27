/**
 * The translation page shows each field's source beside what is written from
 * it, and above it where the screen is too narrow for two columns, with nothing
 * scrolling sideways at any width.
 *
 * Takes the place of the spec holding the height of the editor's two panes,
 * which showed the source beside the language being edited. An address naming
 * two languages now opens this page, so no address reaches the panes.
 *
 * @module tests/translation-page-layout
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";
const MAIN = "#nextly-main-content:visible";

/** A word no column can hold on one line, which must not push its edge out. */
const LONG_WORD = "a".repeat(240);

const WIDTHS = [
  { name: "phone", width: 390, height: 844, beside: false },
  { name: "tablet", width: 768, height: 1024, beside: true },
  { name: "desktop", width: 1440, height: 900, beside: true },
] as const;

/** A published author of its own, whose English is the page's source. */
async function createAuthor(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post(AUTHORS, {
    data: {
      title: `Translated author ${stamp}`,
      bio: `Written in English. ${LONG_WORD}`,
      status: "published",
    },
  });
  expect(created.ok(), `creating an author: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new author has no id");
  return id;
}

/** How far what `element` holds runs past the width it is shown in. */
async function sidewaysOverflow(element: Locator): Promise<number> {
  return element.evaluate(node => node.scrollWidth - node.clientWidth);
}

/** A box as drawn; one that is not drawn fails here, by name. */
async function boxOf(element: Locator, what: string) {
  const box = await element.boundingBox();
  if (box === null) throw new Error(`${what} is not drawn`);
  expect(box.width, `${what} has no width`).toBeGreaterThan(0);
  return box;
}

test.describe("the translation page", () => {
  for (const viewport of WIDTHS) {
    const where = viewport.beside ? "beside" : "above";
    test(`shows the source ${where} the translation at ${viewport.name} width, and nothing scrolls sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const id = await createAuthor(page);
      await gotoAdmin(
        page,
        `/translations/collections/authors/${id}?locale=es`
      );

      const field = page.getByRole("group", { name: "Biography", exact: true });
      const source = field.locator('[data-slot="translation-source"]');
      const target = field.locator('[data-slot="translation-target"]');
      await expect(source).toContainText(LONG_WORD);
      // The long word again, as it is written: the control holds it too.
      await target
        .getByRole("textbox", { name: "Biography", exact: true })
        .fill(LONG_WORD);

      const from = await boxOf(source, "the source");
      const to = await boxOf(target, "the translation");
      if (viewport.beside) {
        expect(
          Math.abs(from.y - to.y),
          "both columns start at the top of the field"
        ).toBeLessThanOrEqual(1);
        expect(
          from.x + from.width,
          "the source ends before the translation starts"
        ).toBeLessThanOrEqual(to.x);
      } else {
        expect(
          from.y + from.height,
          "the source ends above the translation"
        ).toBeLessThanOrEqual(to.y);
        expect(
          Math.abs(from.x - to.x),
          "one column, so both start at its edge"
        ).toBeLessThanOrEqual(1);
      }

      expect(
        await sidewaysOverflow(page.locator("html")),
        "the document scrolls sideways"
      ).toBeLessThanOrEqual(0);
      expect(
        await sidewaysOverflow(page.locator(MAIN)),
        "the content area scrolls sideways"
      ).toBeLessThanOrEqual(0);
    });
  }
});
