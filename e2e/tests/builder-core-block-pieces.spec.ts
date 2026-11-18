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
import { expect, type Locator, type Page } from "@playwright/test";

import { selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { settleTransitions } from "./support/axe-scan.mjs";
import { ownSeat, test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The pieces, each by the block whose adding puts it on screen, and the
 * control itself by its role and name: a picker's group, a button, the
 * empty state's group holding its words.
 */
const PIECES = [
  {
    block: "Columns",
    piece: (page: Page) => page.getByRole("group", { name: "Choose a layout" }),
  },
  {
    block: "Collection list",
    piece: (page: Page) =>
      page.getByRole("group", { name: "Show entries from" }),
  },
  {
    block: "Accordion",
    piece: (page: Page) => page.getByRole("button", { name: "Add a question" }),
  },
  {
    block: "Image",
    piece: (page: Page) =>
      page
        .getByRole("group", { name: "Image" })
        .filter({ hasText: "Add an image" }),
  },
] as const;

/** Where a piece is marked for a scan of it alone. */
const PIECE_MARK = "data-e2e-piece";

/**
 * A scan of the piece alone: axe must have judged it (rules passed on its
 * own nodes) and decided its text's contrast, not left it unverified.
 */
async function scanPiece(page: Page, piece: Locator): Promise<string[]> {
  await piece.evaluate(
    (element, mark) => element.setAttribute(mark, ""),
    PIECE_MARK
  );
  const results = await new AxeBuilder({ page })
    .include(`[${PIECE_MARK}]`)
    .withTags(AA_TAGS)
    .analyze();
  await piece.evaluate(
    (element, mark) => element.removeAttribute(mark),
    PIECE_MARK
  );
  const problems: string[] = [];
  if (results.passes.length === 0) problems.push("axe judged nothing in it");
  for (const rule of results.violations) {
    problems.push(
      `${rule.id}: ${rule.nodes.map(node => node.target.join(" ")).join(", ")}`
    );
  }
  // Text axe could not decide (drawn over the canvas's frame, whose page it
  // does not look behind), measured here instead; its contrast must be judged
  // one way or the other, so text neither passed nor measured fails.
  const undecided = results.incomplete
    .filter(rule => rule.id === "color-contrast")
    .flatMap(rule => rule.nodes.map(node => node.target.join(" ")));
  const measured = await measureContrast(page, undecided);
  problems.push(...measured.problems);
  const passed = results.passes.some(rule => rule.id === "color-contrast");
  if (!passed && measured.judged === 0) {
    problems.push("its text's contrast was judged neither by axe nor here");
  }
  return problems;
}

/**
 * Each element's text contrast, measured directly: its colour composited
 * over every background behind it up to an opaque one, each colour read as
 * the browser paints it (any syntax, through a canvas). 4.5:1, or 3:1 for
 * large text. A background image on the way is reported, not guessed.
 */
async function measureContrast(
  page: Page,
  selectors: readonly string[]
): Promise<{ judged: number; problems: string[] }> {
  return page.evaluate(targets => {
    const paint = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });
    if (paint === null) return { judged: 0, problems: ["no canvas to read"] };
    const rgba = (color: string): number[] => {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = "#000";
      paint.fillStyle = color;
      paint.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = paint.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], below: number[]): number[] => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map(i => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a));
    };
    const luminance = (rgb: number[]): number => {
      const [r = 0, g = 0, b = 0] = rgb.map(value => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let judged = 0;
    const problems: string[] = [];
    for (const target of targets) {
      const element = document.querySelector(target);
      if (element === null) {
        problems.push(`${target}: not found to measure`);
        continue;
      }
      const layers: number[][] = [];
      let image = false;
      for (
        let at: Element | null = element;
        at !== null;
        at = at.parentElement
      ) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== "none") image = true;
        const layer = rgba(style.backgroundColor);
        if ((layer[3] ?? 0) > 0) layers.push(layer);
        if ((layer[3] ?? 0) >= 1) break;
      }
      if (image) {
        problems.push(`${target}: text over an image, not measurable`);
        continue;
      }
      const background = layers
        .reverse()
        .reduce((below, layer) => over(layer, below), [255, 255, 255]);
      const style = getComputedStyle(element);
      const text = over(rgba(style.color), background);
      const [light, dark] = [luminance(text), luminance(background)].sort(
        (x, y) => y - x
      );
      const ratio = ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
      const size = parseFloat(style.fontSize);
      const large =
        size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      judged += 1;
      if (ratio < (large ? 3 : 4.5)) {
        problems.push(`${target}: contrast ${ratio.toFixed(2)}:1`);
      }
    }
    return { judged, problems };
  }, selectors);
}

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
          // The piece itself on screen, as the control it is, so the scans
          // judge it: a picker, a button, or the empty state the editor
          // draws over the block.
          const control = piece.piece(page).first();
          await expect(control).toBeVisible();
          await settleTransitions(page);
          expect
            .soft(
              await scanPiece(page, control),
              `${piece.block} alone, ${scheme}`
            )
            .toEqual([]);
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
              `${piece.block}, ${scheme}`
            )
            .toEqual([]);
        }
      });
    });
  }
});
