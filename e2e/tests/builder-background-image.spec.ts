/**
 * A Section's background image is chosen, not typed: from the Media library,
 * with a thumbnail, Replace and Remove, and placed with the nine-point picker.
 * The canvas follows each choice, and Remove clears only the image.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const SECTION = "00000000-0000-4000-8000-00000000b001";

/** A draft page holding one Section with these background values. */
async function createPage(
  request: APIRequestContext,
  background: Record<string, unknown> | undefined
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Picker page ${stamp}`,
      slug: `background-image-${stamp}`,
      status: "draft",
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
                base: {
                  minHeight: "240px",
                  ...(background === undefined ? {} : { background }),
                },
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

/** Open the builder on the page, select the Section, and open Background. */
async function openBackground(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await sectionOnCanvas(page).click({ position: { x: 6, y: 6 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  await page.getByRole("tab", { name: "Style" }).click();
  // The section's heading is the button that folds; a control inside may be
  // named after the section too.
  // The heading comes first; the position picker's "as CSS" button also
  // folds, but holds no words.
  const heading = page
    .locator('[role="tabpanel"]:not([hidden]) button[aria-expanded]', {
      hasText: /^Background/,
    })
    .first();
  if ((await heading.getAttribute("aria-expanded")) !== "true") {
    await heading.click();
  }
}

function sectionOnCanvas(page: Page) {
  return canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${SECTION}"]`)
    .first();
}

/** The Section's computed background, as the canvas draws it. */
async function drawnBackground(
  page: Page
): Promise<{ image: string; position: string }> {
  return sectionOnCanvas(page).evaluate(element => {
    const style = getComputedStyle(element);
    return {
      image: style.backgroundImage,
      position: style.backgroundPosition,
    };
  });
}

/** Pick the uploaded file named for `run` from the library dialog. */
async function pickFromLibrary(page: Page, run: string): Promise<void> {
  await page.getByRole("button", { name: "Choose Background image" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose background image" });
  await expect(dialog).toBeVisible();
  const tile = dialog.getByRole("button", {
    name: new RegExp(`^canvas-${run}\\.png - `),
  });
  await tile.locator("img").dblclick({ position: { x: 40, y: 40 } });
  await expect(dialog).toBeHidden();
}

test.describe("a Section's background image", () => {
  test.describe.configure({ timeout: 180_000 });

  test("is picked from the Media library, replaced and removed, and the canvas follows", async ({
    page,
  }) => {
    const first = `${Date.now()}-a`;
    const second = `${Date.now()}-b`;
    await uploadImage(page.request, first);
    await uploadImage(page.request, second);
    const id = await createPage(page.request, undefined);
    await openBackground(page, id);

    // No address typed as CSS: a library, an upload or a link.
    await expect(
      page.getByRole("textbox", { name: "Image link" })
    ).toBeVisible();

    await pickFromLibrary(page, first);
    await expect(page.getByText(`canvas-${first}.png`)).toBeVisible();
    await expect
      .poll(async () => (await drawnBackground(page)).image)
      .toContain(`canvas-${first}`);

    // Replace swaps the image.
    await expect(
      page.getByRole("button", { name: "Choose Background image" })
    ).toHaveText("Replace");
    await pickFromLibrary(page, second);
    await expect
      .poll(async () => (await drawnBackground(page)).image)
      .toContain(`canvas-${second}`);

    // The top right point places it there.
    await page
      .getByRole("radiogroup", { name: "Position" })
      .getByRole("radio", { name: "Top right" })
      .click();
    await expect
      .poll(async () => (await drawnBackground(page)).position)
      .toBe("100% 0%");

    // Remove clears the image, and only the image.
    await page.getByRole("button", { name: "Remove background image" }).click();
    await expect
      .poll(async () => (await drawnBackground(page)).image)
      .not.toContain("canvas-");
    await expect(
      page
        .getByRole("radiogroup", { name: "Position" })
        .getByRole("radio", { name: "Top right" })
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("textbox", { name: "Image link" })
    ).toBeVisible();
  });

  test("reads a position the nine points can't make as Custom", async ({
    page,
  }) => {
    const id = await createPage(page.request, {
      url: "/hills.jpg",
      position: "30% 70%",
    });
    await openBackground(page, id);
    await expect(page.getByText("Custom: 30% 70%")).toBeVisible();
  });
});
