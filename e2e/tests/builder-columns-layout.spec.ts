/**
 * A Columns row's layout tiles and stacking, in the real editor.
 *
 * - A tile writes the row's columns: 33 / 67 lays two columns at one to two.
 * - A tile that would remove a column holding content is held, with why.
 * - Stack on Tablet, reversed, lays the row out as a reversed column at the
 *   site's tablet width and below, and is stored on the row alone.
 *
 * Each test makes its own page. The site's devices are stored for the file,
 * so it holds the site-style lock.
 *
 * @module tests/builder-columns-layout.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { storeSiteBreakpoints } from "./support/site-breakpoints";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const ROW = "00000000-0000-4000-8000-00000000c001";
const DEVICES = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

/** A column, empty or holding a line of text. */
function column(id: string, filled: boolean) {
  return {
    id,
    type: "core/column",
    version: 1,
    props: {},
    slots: {
      children: filled
        ? [
            {
              id: `${id}-text`,
              type: "core/text",
              version: 1,
              props: { text: `Text in ${id}` },
            },
          ]
        : [],
    },
  };
}

/** A page holding one Columns row, padded so the row has a surface to click. */
async function createPage(
  request: APIRequestContext,
  columns: ReturnType<typeof column>[]
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Columns ${stamp}`,
      slug: `columns-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: ROW,
            type: "core/columns",
            version: 1,
            props: { as: "div" },
            styles: {
              base: {
                base: {
                  padding: {
                    blockStart: "24px",
                    blockEnd: "24px",
                    inlineStart: "24px",
                    inlineEnd: "24px",
                  },
                },
              },
            },
            slots: { children: columns },
          },
        ],
      },
    },
  });
  if (!created.ok()) throw new Error(`creating a page: ${created.status()}`);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** Open the row's Style tab, selected by clicking its padding. */
async function openRow(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${ROW}"]`)
    .first()
    .click({ position: { x: 6, y: 6 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  await page.getByRole("tab", { name: "Style" }).click();
  await expect(page.getByRole("radiogroup", { name: "Widths" })).toBeVisible();
}

async function storedRow(page: Page, id: string) {
  const nodes = await storedPageNodes(page.request, ENTRIES, id);
  return nodes.find(node => node.id === ROW) as
    | {
        styles?: Record<string, Record<string, Record<string, unknown>>>;
        slots?: { children?: { styles?: unknown }[] };
      }
    | undefined;
}

test.describe("a Columns row's layout", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a tile lays the row's columns out at its widths", async ({ page }) => {
    const id = await createPage(page.request, [
      column("a", true),
      column("b", true),
    ]);
    await openRow(page, id);
    await page.getByRole("radio", { name: "33 / 67" }).click();
    await expect(page.getByRole("radio", { name: "33 / 67" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    const tracks = await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${ROW}"]`)
      .first()
      .evaluate(row =>
        getComputedStyle(row)
          .gridTemplateColumns.split(" ")
          .map(width => parseFloat(width))
      );
    expect(tracks).toHaveLength(2);
    expect(tracks[1] / tracks[0]).toBeCloseTo(2, 1);
  });

  test("a tile that would remove a column holding content is held, with why", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      column("a", true),
      column("b", true),
      column("c", true),
    ]);
    await openRow(page, id);
    const tile = page.getByRole("radio", { name: "50 / 50" });
    await expect(tile).toHaveAttribute("aria-disabled", "true");
    await tile.hover();
    await expect(tile).toHaveAccessibleDescription(
      "Needs 2 columns. This row has 3 with content; empty one out first."
    );
  });

  test("stacks at Tablet and below, reversed, written on the row alone", async ({
    page,
  }) => {
    await storeSiteBreakpoints(page.request, DEVICES);
    try {
      const id = await createPage(page.request, [
        column("a", true),
        column("b", true),
      ]);
      await openRow(page, id);
      await page
        .getByRole("radiogroup", { name: "Stack on" })
        .getByRole("radio", { name: "Tablet" })
        .click();
      await page.getByRole("switch", { name: "Reverse when stacked" }).click();
      await expect(
        page.getByRole("switch", { name: "Reverse when stacked" })
      ).toBeChecked();

      await pressSave(page);
      await expect
        .poll(async () => (await storedRow(page, id))?.styles?.base?.tablet, {
          timeout: 15_000,
        })
        .toEqual({ display: "flex", flexDirection: "column-reverse" });
      // The columns themselves carry nothing: no per-column order.
      const columns = (await storedRow(page, id))?.slots?.children ?? [];
      expect(columns).toHaveLength(2);
      expect(columns.filter(each => each.styles !== undefined)).toEqual([]);
    } finally {
      await storeSiteBreakpoints(page.request, null);
    }
  });
});
