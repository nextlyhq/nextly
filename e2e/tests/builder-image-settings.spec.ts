/**
 * An image's link and focal point, edited in the real editor.
 *
 * - A link set from the Content tab wraps the picture in a link on the
 *   canvas, with its caption outside it, and is stored as the image's own.
 * - The focal point shows beside a Cover fit, moves with the arrow keys as a
 *   radio group does, and the canvas picture takes the point it writes.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-image-settings.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { pngBuffer } from "./support/media-files";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const IMAGE = "00000000-0000-4000-8000-00000000b001";

/** A page holding one image, sized so it has a box to click, with a caption. */
async function createPage(
  request: APIRequestContext,
  styles: Record<string, unknown> = {}
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Image settings ${stamp}`,
      slug: `image-settings-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: IMAGE,
            type: "core/image",
            version: 1,
            props: {
              src: "/example.jpg",
              alt: "The team",
              caption: "Our team",
            },
            // A size of its own: the file is not served, and an image that
            // never loads has no box to click.
            styles: {
              base: { base: { width: "240px", height: "160px", ...styles } },
            },
          },
        ],
      },
    },
  });
  if (!created.ok()) {
    throw new Error(`creating a page failed: ${created.status()}`);
  }
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/**
 * Serve the picture the page names, wider and taller than the block's box,
 * so the picture really has to be cropped or fitted into it.
 */
async function servePicture(
  page: Page,
  size: { width: number; height: number } = { width: 960, height: 640 }
): Promise<void> {
  const picture = pngBuffer(180, 0, size);
  await page.route("**/example.jpg", async route => {
    try {
      await route.fulfill({ contentType: "image/png", body: picture });
    } catch {
      // The page closed before the picture was asked for; nothing to answer.
    }
  });
}

/**
 * How far the canvas picture misses its figure's box, once it has loaded:
 * drawn past its bottom, or short of its width. 0 or less when it fills the
 * width the block gives it and stays inside its height.
 */
async function pictureOverflow(page: Page): Promise<number> {
  const picture = canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${IMAGE}"] img`)
    .first();
  await expect
    .poll(() =>
      picture.evaluate(element => (element as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0);
  return picture.evaluate(element => {
    const figure = element.closest("figure");
    if (figure === null) return Number.NaN;
    const drawn = element.getBoundingClientRect();
    const box = figure.getBoundingClientRect();
    // Past the bottom, or short of the width the block gives it: either way
    // the fit has no box to crop to.
    return Math.max(drawn.bottom - box.bottom, box.width - drawn.width);
  });
}

async function openImage(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${IMAGE}"] img`)
    .first()
    .click();
  await expect(page.locator("[data-block-card]")).toBeVisible();
}

/** The image node as stored, read back through the API. */
async function storedImage(
  page: Page,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const nodes = await storedPageNodes(page.request, ENTRIES, id);
  return nodes.find(node => node.id === IMAGE);
}

test.describe("an image's settings", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a link wraps the picture on the canvas, leaving its caption outside", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openImage(page, id);

    const content = page.getByRole("tabpanel", { name: "Content" });
    await content.getByRole("button", { name: /^Link:/ }).click();
    const search = page.getByRole("combobox", {
      name: "Search pages or paste a URL for link",
    });
    await search.fill("/about");
    await search.press("Enter");

    const figure = canvasFrame(page).locator(
      `.nx-canvas [data-nx-node="${IMAGE}"]`
    );
    const link = figure.locator("a");
    await expect(link).toHaveAttribute("href", "/about");
    await expect(link.locator("img")).toHaveAttribute("alt", "The team");
    await expect(link.locator("figcaption")).toHaveCount(0);
    await expect(figure.locator("figcaption")).toHaveText("Our team");

    await pressSave(page);
    await expect
      .poll(async () => (await storedImage(page, id))?.props, {
        timeout: 15_000,
      })
      .toMatchObject({ href: "/about" });
  });

  test("a long caption does not widen a small picture", async ({ page }) => {
    // The figure is as wide as its picture: a caption longer than the picture
    // wraps under it rather than stretching the picture to its own width.
    const id = await createPage(page.request, {
      width: "auto",
      height: "auto",
    });
    await page.request.patch(`${ENTRIES}/${id}`, {
      data: {
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: IMAGE,
              type: "core/image",
              version: 1,
              props: {
                src: "/example.jpg",
                alt: "The team",
                caption:
                  "A caption much longer than the picture it sits under, which wraps beneath it.",
              },
            },
          ],
        },
      },
    });
    await servePicture(page, { width: 120, height: 80 });
    await openImage(page, id);
    const picture = canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${IMAGE}"] img`)
      .first();
    await expect
      .poll(() =>
        picture.evaluate(element => (element as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0);
    const width = await picture.evaluate(
      element => element.getBoundingClientRect().width
    );
    expect(width).toBeLessThanOrEqual(120.5);
  });

  test("the focal point moves with the arrow keys, and the picture follows it", async ({
    page,
  }) => {
    const id = await createPage(page.request, {
      objectFit: "cover",
      height: "120px",
    });
    await servePicture(page);
    await openImage(page, id);
    // Drawn inside the block's box: a captioned picture is cropped to the
    // room its figure leaves it, not drawn past the figure's edge.
    expect(await pictureOverflow(page)).toBeLessThanOrEqual(0.5);
    await page.getByRole("tab", { name: "Style" }).click();
    // The section the fit and focal point sit in, opened as an author does.
    const size = page.locator('.nx-style-inspector [data-section="size"]');
    if ((await size.getAttribute("data-state")) !== "open") {
      await size.locator(".nx-style-inspector__section-trigger").click();
    }

    const points = page.getByRole("radiogroup", { name: "Focal point" });
    await expect(points).toBeVisible();
    // Nothing set: the middle is the one tab stop, and the readout says so.
    await expect(page.getByText("Center by default")).toBeVisible();
    await points.getByRole("radio", { name: "Center", exact: true }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(
      points.getByRole("radio", { name: "Top", exact: true })
    ).toBeFocused();
    await expect(
      points.getByRole("radio", { name: "Top", exact: true })
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowRight");
    await expect(
      points.getByRole("radio", { name: "Top right", exact: true })
    ).toHaveAttribute("aria-checked", "true");

    // The canvas's picture takes the point, through the figure it sits in.
    const picture = canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${IMAGE}"] img`)
      .first();
    // And it is drawn inside the block's box: a captioned picture is cropped
    // to the room its figure leaves it, not drawn past the figure's edge.
    expect(await pictureOverflow(page)).toBeLessThanOrEqual(0.5);
    await expect
      .poll(() =>
        picture.evaluate(element => getComputedStyle(element).objectPosition)
      )
      .toBe("100% 0%");
  });
});
