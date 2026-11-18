/**
 * A Section's Background section fits the block panel at every width it can
 * take: its narrowest, the default 320px and its widest.
 *
 * - **Size:** Cover, Fit and Tile each show their whole word, never "Cov".
 * - **The picked image:** its file name, a library file's long generated name,
 *   ends inside the panel. Cut short, it ends in an ellipsis, and the whole
 *   name stays in the text and in the row's tooltip.
 *
 * @module tests/builder-background-fit.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const SECTION = "00000000-0000-4000-8000-00000000b001";
/** A media file's name as the library stores it: a generated id, no spaces. */
const FILE = "8e3ff04d-a404-4fff-9b1c-6d2e5f7a8c90.jpg";
const IMAGE = `/media/${FILE}`;

/** A draft page holding one Section whose background is `IMAGE`. */
async function createPage(page: Page): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Background fit ${stamp}`,
      slug: `background-fit-${stamp}`,
      status: "draft",
      // Without the site's header and footer, whose regions on the canvas
      // would take the click meant for the Section.
      noHeaderFooter: true,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: SECTION,
            type: "core/section",
            version: 1,
            props: { as: "section" },
            styles: {
              base: {
                base: { minHeight: "240px", background: { url: IMAGE } },
              },
            },
            slots: { children: [] },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** Open the builder on a new page, select its Section and open Background. */
async function openBackground(page: Page): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await createPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  const section = canvasFrame(page)
    .locator(`[data-nx-node="${SECTION}"]`)
    .first();
  await expect(section).toBeVisible({ timeout: 60_000 });
  await section.click({ position: { x: 6, y: 6 } });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.locator("[data-block-card]")).toBeVisible();
  await inspector.getByRole("tab", { name: "Style", exact: true }).click();
  const heading = inspector
    .locator('[role="tabpanel"]:not([hidden]) button[aria-expanded]', {
      hasText: /^Background/,
    })
    .first();
  if ((await heading.getAttribute("aria-expanded")) !== "true") {
    await heading.click();
  }
  await expect(
    inspector.getByRole("radiogroup", { name: "Size" })
  ).toBeVisible();
  return inspector;
}

/**
 * Set the inspector `width` wide, or as near as its bounds allow. It widens
 * by the divider's arrow keys, since a drag toward the canvas passes over the
 * canvas's frame, which takes the pointer from the page, and narrows by a drag
 * over the inspector itself.
 */
async function setInspectorWidth(
  page: Page,
  inspector: Locator,
  width: number
): Promise<number> {
  const handle = page.getByRole("separator", { name: "Canvas and inspector" });
  const now = async () =>
    Math.round((await inspector.boundingBox())?.width ?? 0);
  for (let press = 0; press < 40 && (await now()) < width; press++) {
    const before = await now();
    await handle.press("ArrowLeft");
    // At its widest, a key moves nothing.
    if ((await now()) === before) break;
  }
  for (let attempt = 0; attempt < 3 && (await now()) > width; attempt++) {
    const grip = await handle.boundingBox();
    if (grip === null) throw new Error("the divider has no box");
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + ((await now()) - width), y, { steps: 6 });
    await page.mouse.up();
  }
  return now();
}

/** Each size choice's word, and whether it is cut short in its button. */
async function sizeChoices(inspector: Locator) {
  return inspector
    .getByRole("radiogroup", { name: "Size" })
    .getByRole("radio")
    .evaluateAll(buttons =>
      buttons.map(button => ({
        word: button.textContent,
        cut: button.scrollWidth > button.clientWidth,
      }))
    );
}

/** How the picked file's name sits: where its row ends against the panel's edge, and how it is cut. */
async function fileName(inspector: Locator, name: Locator) {
  const edge = (await inspector.boundingBox())?.x ?? 0;
  const width = (await inspector.boundingBox())?.width ?? 0;
  return name.evaluate((element, panelRight) => {
    const row = element.closest(".nx-inspector__media-chosen") ?? element;
    const style = getComputedStyle(element);
    return {
      rowPastEdge: row.getBoundingClientRect().right > panelRight + 1,
      namePastEdge: element.getBoundingClientRect().right > panelRight + 1,
      cut: element.scrollWidth > element.clientWidth,
      ellipsis:
        style.textOverflow === "ellipsis" && style.overflowX === "hidden",
      text: element.textContent,
      tooltip: element.getAttribute("title") ?? "",
    };
  }, edge + width);
}

test.describe("a Section's Background section", () => {
  test.describe.configure({ timeout: 180_000 });

  test("shows each size whole and cuts the picked file's name inside the panel, at its narrowest, 320px and widest", async ({
    page,
  }) => {
    const inspector = await openBackground(page);
    const name = inspector.getByText(FILE, { exact: true });
    await expect(name).toBeVisible();
    // Asked for less than the panel allows: it stops at its narrowest.
    const narrowest = await setInspectorWidth(page, inspector, 200);
    expect(narrowest).toBeLessThan(320);
    for (const target of [narrowest, 320, 520]) {
      const width = await setInspectorWidth(page, inspector, target);
      expect(Math.abs(width - target), `asked ${target}px`).toBeLessThan(4);

      // Soft, so one run reports every width and both defects at once.
      expect.soft(await sizeChoices(inspector), `size at ${width}px`).toEqual([
        { word: "Cover", cut: false },
        { word: "Fit", cut: false },
        { word: "Tile", cut: false },
      ]);
      // From the default width up, the strip starts where the row above it,
      // Position, does: the label column keeps its width.
      if (width >= 320) {
        const [size = 0, position = 0] = await Promise.all(
          ["Size", "Position"].map(
            async group =>
              (
                await inspector
                  .getByRole("radiogroup", { name: group })
                  .boundingBox()
              )?.x ?? 0
          )
        );
        expect
          .soft(Math.abs(size - position), `size's start at ${width}px`)
          .toBeLessThan(2);
      }

      const read = await fileName(inspector, name);
      expect.soft(read.rowPastEdge, `the file's row at ${width}px`).toBe(false);
      expect
        .soft(read.namePastEdge, `the file's name at ${width}px`)
        .toBe(false);
      expect
        .soft(read.ellipsis, `the name's ellipsis at ${width}px`)
        .toBe(true);
      // Up to the default width the name is longer than its room, so it is
      // cut there; the widest panel may have room for all of it.
      if (width <= 320) {
        expect.soft(read.cut, `the name cut at ${width}px`).toBe(true);
      }
      // Cut or not, the whole name is the text read out, and in the tooltip.
      expect.soft(read.text).toBe(FILE);
      expect.soft(read.tooltip).toContain(FILE);
    }
  });
});
