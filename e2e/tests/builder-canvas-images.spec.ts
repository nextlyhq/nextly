/**
 * Images and buttons on the editor's canvas: drawn, and still there when the
 * author selects another block.
 *
 * Both render asynchronously, and the canvas renders the page in the browser.
 * An image chosen from the media library drew no picture on the canvas while
 * the published page showed it, and selecting a block could make every button
 * on the page vanish for a moment while it was drawn again.
 *
 * @module tests/builder-canvas-images.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/**
 * A 64-pixel square PNG: large enough to be pressed on the canvas, where a
 * one-pixel image gives a pointer nowhere to land.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwFfGZMa3hCH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBmGYxWlLxJbIAAAAASUVORK5CYII=",
  "base64"
);

/** Store an image in the media library; returns its id and address. */
async function uploadImage(
  request: APIRequestContext,
  run: string
): Promise<{ id: string; url: string }> {
  const uploaded = await request.post("/admin/api/media", {
    multipart: {
      file: { name: `canvas-${run}.png`, mimeType: "image/png", buffer: PNG },
    },
  });
  expect(uploaded.ok(), `uploading: ${uploaded.status()}`).toBe(true);
  const body = (await uploaded.json()) as {
    item?: { id: string; url: string };
    id?: string;
    url?: string;
  };
  return {
    id: String(body.item?.id ?? body.id),
    url: String(body.item?.url ?? body.url),
  };
}

/** A page holding a library image, an image by address, and a button. */
async function seed(page: Page): Promise<string> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const media = await uploadImage(page.request, run);
  const created = await page.request.post(PAGES, {
    data: {
      title: "Canvas images",
      slug: `canvas-images-${run}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "library",
            type: "core/image",
            version: 1,
            props: { mediaId: media.id, alt: "From the library" },
          },
          {
            id: "address",
            type: "core/image",
            version: 1,
            props: { src: media.url, alt: "By its address" },
          },
          {
            id: "cta",
            type: "core/button",
            version: 1,
            props: { label: "Get started", href: "/signup" },
          },
          {
            id: "lead",
            type: "core/text",
            version: 1,
            props: { text: "Some words to select." },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(canvasBlock(page, "lead")).toBeVisible({ timeout: 30_000 });
}

test.describe("the canvas's images and buttons", () => {
  test.describe.configure({ timeout: 180_000 });

  test("draws an image from the media library and one by its address", async ({
    page,
  }) => {
    await openBuilder(page, await seed(page));
    const frame = canvasFrame(page);
    for (const alt of ["From the library", "By its address"]) {
      const image = frame.getByRole("img", { name: alt });
      await expect(image, alt).toBeVisible();
      // Loaded, not just placed: a broken address draws no pixels.
      await expect
        .poll(() =>
          image.evaluate(element => (element as HTMLImageElement).naturalWidth)
        )
        .toBeGreaterThan(0);
    }
  });

  test("keeps every image and button drawn while the author selects blocks", async ({
    page,
  }) => {
    await openBuilder(page, await seed(page));
    const frame = canvasFrame(page);
    await expect(
      frame.getByRole("img", { name: "By its address" })
    ).toBeVisible();
    await expect(frame.getByText("Get started")).toBeVisible();

    // Watched every frame, inside the canvas: a moment without a box is the
    // blink an author sees, however short.
    const canvasPage = page.frames().find(frame => frame !== page.mainFrame());
    if (canvasPage === undefined) throw new Error("[e2e] no canvas frame");
    await canvasPage.evaluate(() => {
      const watched = ['[data-nx-node="cta"]', '[data-nx-node="address"]'];
      const record = window as unknown as { __nxBlinked: string[] };
      record.__nxBlinked = [];
      const look = (): void => {
        for (const selector of watched) {
          const element = document.querySelector(selector);
          if (element === null || element.getClientRects().length === 0) {
            record.__nxBlinked.push(selector);
          }
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });

    // The button is drawn as a link, which a press on the canvas does not
    // select; it is watched while the blocks around it are.
    for (const id of ["lead", "address", "lead", "library", "lead"]) {
      await canvasBlock(page, id).click();
      await expect(canvasBlock(page, id)).toHaveAttribute(
        "data-nx-selected",
        "primary"
      );
    }
    expect(
      await canvasPage.evaluate(
        () => (window as unknown as { __nxBlinked: string[] }).__nxBlinked
      ),
      "no image or button went missing while blocks were selected"
    ).toEqual([]);
  });

  test("draws an image again when its own props are edited", async ({
    page,
  }) => {
    await openBuilder(page, await seed(page));
    const frame = canvasFrame(page);
    await canvasBlock(page, "address").click();
    const alt = page.getByRole("textbox", { name: "Alt text" });
    await alt.fill("An edited description");
    await alt.press("Enter");
    await expect(
      frame.getByRole("img", { name: "An edited description" })
    ).toBeVisible();
  });
});
