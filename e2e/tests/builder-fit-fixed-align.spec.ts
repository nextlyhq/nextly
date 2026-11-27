/**
 * A Fit or Fixed block stays where its parent puts its blocks, and Align
 * moves it, in the real editor and as the browser lays it out.
 *
 * - In a Section aligned to the top center, an Image given Fit or Fixed stays
 *   centered, Align shows "Section's · Left · Center · Right" with the
 *   Section's chosen, Left moves it to the left, and the Section's choice
 *   centers it again. Fill takes the Align row away.
 * - Right chosen at Mobile places it there only: Desktop stays centered.
 *
 * Each test makes its own page, so no lock is needed.
 *
 * @module tests/builder-fit-fixed-align.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { clearSelection, clickBlock, selection } from "./canvas/editor-driver";
import { canvasBlock } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const SECTION = "00000000-0000-4000-8000-00000000f170";
const IMAGE = "00000000-0000-4000-8000-00000000f17a";

/** A page holding one Section aligned to the top center, with an Image. */
async function createPage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Align ${stamp}`,
      slug: `align-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: SECTION,
            type: "core/section",
            version: 1,
            props: { as: "section", contained: true },
            // The Section's Align at the top center, as Arrange writes it.
            styles: {
              base: {
                base: {
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-start",
                  alignItems: "center",
                },
              },
            },
            slots: {
              children: [
                {
                  id: IMAGE,
                  type: "core/image",
                  version: 1,
                  // A picture with a size of its own (82 × 97), so Fit is its width.
                  props: { src: "/Nextly_Icon_Light.svg", alt: "Nextly" },
                },
              ],
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

async function openEditor(page: Page, id: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** Select the Image and open "Inside its parent" in its Style tab. */
async function selectImage(page: Page): Promise<void> {
  await clearSelection(page);
  await clickBlock(page, IMAGE);
  await expect.poll(() => selection(page)).toEqual([IMAGE]);
  await page
    .getByTestId("inspector")
    .getByRole("tab", { name: /^Style/ })
    .click();
  const header = page
    .getByTestId("inspector")
    .locator('[data-section="inside-parent"] [data-slot="accordion-trigger"]');
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
}

function group(page: Page, name: "Width" | "Align") {
  return page
    .getByTestId("inspector")
    .locator('[data-control="inside-parent"]')
    .getByRole("radiogroup", { name, exact: true });
}

async function choose(page: Page, row: "Width" | "Align", name: string) {
  const choice = group(page, row).getByRole("radio", { name, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-checked", "true");
}

/**
 * Where the Image sits in the Section's content box, as the browser lays it
 * out: "left", "center" or "right", within 2px, or "elsewhere".
 */
async function placeOfImage(page: Page): Promise<string> {
  const section = await canvasBlock(page, SECTION)
    .first()
    .evaluate(node => {
      const { x, width } = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const zoom = width / node.offsetWidth || 1;
      return {
        left: x + parseFloat(style.paddingLeft) * zoom,
        right: x + width - parseFloat(style.paddingRight) * zoom,
      };
    });
  const image = await canvasBlock(page, IMAGE)
    .first()
    .evaluate(node => {
      const { x, width } = node.getBoundingClientRect();
      return { left: x, right: x + width };
    });
  const near = (a: number, b: number) => Math.abs(a - b) < 2;
  // Not stretched across: a place is only one where there is room either side.
  if (near(image.left, section.left) && near(image.right, section.right)) {
    return "filled";
  }
  if (near(image.left, section.left)) return "left";
  if (near(image.right, section.right)) return "right";
  const middle = (section.left + section.right) / 2;
  return near((image.left + image.right) / 2, middle) ? "center" : "elsewhere";
}

test.describe("a Fit or Fixed block in a centered Section", () => {
  test.describe.configure({ timeout: 180_000 });

  test("stays centered, and Align moves it", async ({ page }) => {
    const id = await createPage(page.request);
    await openEditor(page, id);
    await selectImage(page);

    await choose(page, "Width", "Fit");
    await expect.poll(() => placeOfImage(page)).toBe("center");
    const align = group(page, "Align");
    await expect(align.getByRole("radio")).toHaveText([
      "Section's",
      "Left",
      "Center",
      "Right",
    ]);
    await expect(
      align.getByRole("radio", { name: "Section's" })
    ).toHaveAttribute("aria-checked", "true");

    await choose(page, "Align", "Left");
    await expect.poll(() => placeOfImage(page)).toBe("left");
    await choose(page, "Align", "Section's");
    await expect.poll(() => placeOfImage(page)).toBe("center");

    await choose(page, "Width", "Fixed");
    const size = page.getByTestId("inspector").getByLabel("Width set");
    await size.fill("300px");
    await size.press("Enter");
    await expect
      .poll(
        async () =>
          (await canvasBlock(page, IMAGE).first().boundingBox())?.width ?? 0
      )
      .toBeGreaterThan(0);
    await expect.poll(() => placeOfImage(page)).toBe("center");

    await choose(page, "Width", "Fill");
    await expect(group(page, "Align")).toHaveCount(0);
  });

  test("Right at Mobile places it there only", async ({ page }) => {
    const id = await createPage(page.request);
    await openEditor(page, id);
    await selectImage(page);
    await choose(page, "Width", "Fit");
    await expect.poll(() => placeOfImage(page)).toBe("center");

    const devices = page.getByRole("radiogroup", { name: "Device" });
    await devices.getByRole("radio", { name: /^Mobile/ }).click();
    await selectImage(page);
    await choose(page, "Align", "Right");
    await expect.poll(() => placeOfImage(page)).toBe("right");

    await devices.getByRole("radio", { name: /^Desktop/ }).click();
    await selectImage(page);
    await expect.poll(() => placeOfImage(page)).toBe("center");
    await expect(
      group(page, "Align").getByRole("radio", { name: "Section's" })
    ).toHaveAttribute("aria-checked", "true");
  });
});
