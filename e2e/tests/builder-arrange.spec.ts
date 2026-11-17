/**
 * A container's Arrange, in the real editor: Stack, Row or Grid in plain
 * words, laid out on the canvas as each says.
 *
 * - A new Box reads Stack, with the CSS it writes under it; Row lays its
 *   blocks side by side; the section meets WCAG 2.2 AA.
 * - A Row stacked on Mobile still reads as Row there, without Wrap, and Align
 *   Top right puts its blocks at the top right of the stacked column.
 * - Wrap in a Row, then Grid: the wrap is kept and said unused; Clear removes
 *   it, and Undo brings it back.
 *
 * Each test makes its own page, on the site's own devices, so no lock is
 * needed.
 *
 * @module tests/builder-arrange.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BOX = "00000000-0000-4000-8000-00000000a110";
const BUTTONS = ["a", "b", "c"].map(
  each => `00000000-0000-4000-8000-00000000a11${each}`
);

/** A page holding one Box with three Buttons, padded to be clickable. */
async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Arrange ${stamp}`,
      slug: `arrange-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: BOX,
            type: "core/box",
            version: 1,
            props: { as: "div" },
            styles: {
              base: {
                base: {
                  minHeight: "240px",
                  padding: {
                    blockStart: "24px",
                    blockEnd: "24px",
                    inlineStart: "24px",
                    inlineEnd: "24px",
                  },
                },
              },
            },
            slots: {
              children: BUTTONS.map((id, index) => ({
                id,
                type: "core/button",
                version: 1,
                props: { label: `Button ${String(index + 1)}`, href: "/" },
              })),
            },
          },
        ],
      },
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The editor on a new page, the Box selected, Style › Layout open. */
async function openLayout(page: Page, id: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await selectBox(page);
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: "Style", exact: true })
    .click();
  const layout = page
    .getByTestId("inspector")
    .locator('[data-section="layout"] [data-slot="accordion-trigger"]');
  if ((await layout.getAttribute("aria-expanded")) !== "true") {
    await layout.click();
  }
  await expect(arrange(page)).toBeVisible();
}

async function selectBox(page: Page): Promise<void> {
  await canvasBlock(page, BOX)
    .first()
    .click({ position: { x: 6, y: 6 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
}

function arrange(page: Page) {
  return page.getByTestId("inspector").locator('[data-control="arrange"]');
}

function group(page: Page, name: string) {
  return arrange(page).getByRole("radiogroup", { name, exact: true });
}

/** Each Button's box on the canvas, in order. */
async function buttonBoxes(page: Page) {
  const boxes = [];
  for (const id of BUTTONS) {
    const box = await canvasBlock(page, id).first().boundingBox();
    if (box === null) throw new Error(`${id} has no box`);
    boxes.push(box);
  }
  return boxes;
}

test.describe("a container's Arrange", () => {
  test.describe.configure({ timeout: 180_000 });

  test("reads Stack on a new Box, and Row lays its blocks side by side", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openLayout(page, id);
    await expect(
      group(page, "Arrange").getByRole("radio", { name: "Stack" })
    ).toHaveAttribute("aria-checked", "true");
    await expect(arrange(page).locator(".nx-arrange__css")).toHaveText(
      "display: block"
    );

    await group(page, "Arrange").getByRole("radio", { name: "Row" }).click();
    await expect(arrange(page).locator(".nx-arrange__css")).toHaveText(
      "display: flex · flex-direction: row"
    );
    await expect
      .poll(async () => {
        const [first, second, third] = await buttonBoxes(page);
        return (
          Math.abs(first!.y - second!.y) < 2 &&
          Math.abs(second!.y - third!.y) < 2 &&
          first!.x < second!.x &&
          second!.x < third!.x
        );
      })
      .toBe(true);

    const results = await new AxeBuilder({ page })
      .include('[data-section="layout"]')
      .withTags(AA_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("a Row stacked on Mobile reads as Row there, and aligns by the column", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openLayout(page, id);
    await group(page, "Arrange").getByRole("radio", { name: "Row" }).click();
    const stackOn = arrange(page).getByLabel("Stack on");
    const mobile = await stackOn
      .locator("option", { hasText: /^Mobile/ })
      .getAttribute("value");
    await stackOn.selectOption(mobile ?? "");

    await page
      .getByRole("radiogroup", { name: "Device" })
      .getByRole("radio", { name: /^Mobile/ })
      .click();
    await selectBox(page);
    await expect(
      group(page, "Arrange").getByRole("radio", { name: "Row" })
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      arrange(page).getByRole("switch", { name: "Wrap onto new lines" })
    ).toHaveCount(0);

    await group(page, "Align")
      .getByRole("radio", { name: "Top right" })
      .click();
    const frame = await canvasBlock(page, BOX).first().boundingBox();
    if (frame === null) throw new Error("the Box has no box");
    await expect
      .poll(async () => {
        const [first, second, third] = await buttonBoxes(page);
        // Stacked: one under another, each against the right padding, the
        // first at the top padding.
        return (
          first!.y < second!.y &&
          second!.y < third!.y &&
          Math.abs(first!.x + first!.width - (frame.x + frame.width - 24)) <
            2 &&
          Math.abs(first!.y - (frame.y + 24)) < 2
        );
      })
      .toBe(true);
  });

  test("keeps a Row's wrap under Grid, says so, and clears it undoably", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openLayout(page, id);
    await group(page, "Arrange").getByRole("radio", { name: "Row" }).click();
    await arrange(page)
      .getByRole("switch", { name: "Wrap onto new lines" })
      .click();
    await group(page, "Arrange").getByRole("radio", { name: "Grid" }).click();

    const unused = arrange(page).locator(".nx-arrange__unused");
    await expect(unused).toContainText("1 setting from Row isn't used");
    await expect(
      arrange(page).getByRole("switch", { name: "Wrap onto new lines" })
    ).toHaveCount(0);

    await unused.getByRole("button", { name: "Clear" }).click();
    await expect(unused).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(arrange(page).locator(".nx-arrange__unused")).toContainText(
      "1 setting from Row isn't used"
    );
  });
});
