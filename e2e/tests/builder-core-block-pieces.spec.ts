/**
 * The builder's own pieces for the core blocks, in light and dark.
 *
 * Each piece is put on screen in the real editor (the Columns layout picker,
 * the Collection list's source picker, an Accordion's "+ Add a question", an
 * Image's empty state), then the editor and its canvas are scanned with axe
 * at WCAG 2.2 AA in both of the admin's themes: names, roles and contrast.
 *
 * Each case makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-core-block-pieces.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { settleTransitions } from "./support/axe-scan.mjs";
import { ownSeat, test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The pieces, each by the block whose adding puts it on screen. */
const PIECES = [
  { block: "Columns", shows: "Choose a layout" },
  { block: "Collection list", shows: "Show entries from" },
  { block: "Accordion", shows: "Add a question" },
  { block: "Image", shows: "Add an image" },
] as const;

async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Block pieces ${stamp}`,
      slug: `block-pieces-${stamp}`,
      status: "draft",
      noHeaderFooter: true,
      content: { formatVersion: 1, kind: "page", nodes: [] },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

test.describe("the core blocks' builder pieces", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const [index, scheme] of (["light", "dark"] as const).entries()) {
    test.describe(scheme, () => {
      ownSeat(11 + index);
      test(`meet WCAG 2.2 AA on screen, ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1440, height: 900 });
        const id = await createPage(page);
        await gotoAdmin(
          page,
          `/collections/pages/${id}/builder?field=content`,
          scheme
        );
        await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
          timeout: 60_000,
        });
        const add = page
          .getByRole("navigation", { name: "Editor panels" })
          .getByRole("button", { name: "Add", exact: true });
        for (const piece of PIECES) {
          for (
            let press = 0;
            press < 4 && (await selection(page)).length > 0;
            press++
          ) {
            await page.keyboard.press("Escape");
          }
          if ((await add.getAttribute("aria-pressed")) !== "true")
            await add.click();
          await page
            .getByRole("option", { name: piece.block, exact: true })
            .first()
            .click();
          await expect.poll(async () => (await selection(page)).length).toBe(1);
          // The piece itself on screen, so the scan judges it: a picker, a
          // button, or the empty state the editor draws over the block.
          await expect(page.getByText(piece.shows).first()).toBeVisible();
          await settleTransitions(page);
          const results = await new AxeBuilder({ page })
            .withTags(AA_TAGS)
            .analyze();
          expect(results.passes.length).toBeGreaterThan(10);
          expect
            .soft(
              results.violations.map(violation => ({
                id: violation.id,
                targets: violation.nodes
                  .flatMap(node => node.target.map(String))
                  .slice(0, 5),
              })),
              `${piece.block} (${piece.shows}), ${scheme}`
            )
            .toEqual([]);
        }
      });
    });
  }
});
