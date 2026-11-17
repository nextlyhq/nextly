/**
 * A new Image is an empty state, never a broken file, in the real editor.
 *
 * - Added from the Add panel, an Image draws a box taller than 100px reading
 *   "Add an image" with Upload, Media library, Link and "or drop a file
 *   here", asks for no image file, and stores no address.
 * - A PDF dropped on it says "That file isn't an image" and sends nothing; a
 *   PNG dropped on it shows its progress on the block, then the picture.
 * - Link stores an address that loads as a picture, and says "This link
 *   didn't load an image" with "Try another link" for one that does not,
 *   leaving that Image empty.
 * - In the media library picker a click on a tile chooses it, and a
 *   double-click picks it and closes.
 * - An Image whose library file is gone says so, with Replace.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-image-empty-state.spec
 */
import {
  expect,
  type APIRequestContext,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame, CANVAS_FRAME } from "./support/canvas-frame";
import { pngBuffer } from "./support/media-files";
import { uploadImage } from "./support/media-upload";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-00000000e001";
const IMAGE = "00000000-0000-4000-8000-00000000e002";
const SECOND = "00000000-0000-4000-8000-00000000e003";

/** A draft page of its own holding these nodes, and its id. */
async function createPage(
  request: APIRequestContext,
  nodes: unknown[]
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Image empty state ${stamp}`,
      slug: `image-empty-state-${stamp}`,
      status: "draft",
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

function imageNode(id: string, props: Record<string, unknown> = {}) {
  return { id, type: "core/image", version: 1, props };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

async function saveDraft(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    response =>
      response.url().includes("/collections/pages/entries") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
}

async function storedImage(
  page: Page,
  id: string,
  nodeId: string
): Promise<Record<string, unknown> | undefined> {
  const nodes = await storedPageNodes(page.request, ENTRIES, id);
  return nodes.find(node => node.id === nodeId)?.props as
    | Record<string, unknown>
    | undefined;
}

/** The box an Image with no picture draws on the canvas. */
function emptyBox(page: Page, nodeId: string): Locator {
  return canvasFrame(page).locator(
    `.nx-canvas [data-nx-node="${nodeId}"][data-nx-image-empty]`
  );
}

/** The editor's plate drawn over an Image's box, by what it says. */
function plate(page: Page, says: string | RegExp): Locator {
  return page.locator(".nx-image-state").filter({ hasText: says }).first();
}

/** The frame the canvas is drawn in. */
async function canvasFrameOf(page: Page): Promise<Frame> {
  const frame = await page.locator(CANVAS_FRAME).elementHandle();
  const content = await frame?.contentFrame();
  if (content === null || content === undefined) {
    throw new Error("[e2e] the canvas frame has no document");
  }
  return content;
}

/**
 * Drop one file on an element, as a browser hands a dropped file over: a
 * drag over it, then the drop, with the file in the drag's data. Built in
 * the element's own document, which is the one its events read.
 */
async function dropFile(
  target: Locator,
  where: Page | Frame,
  file: { name: string; type: string; bytes: Buffer }
): Promise<void> {
  const transfer = await where.evaluateHandle(
    ({ name, type, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type }));
      return data;
    },
    { name: file.name, type: file.type, bytes: [...file.bytes] }
  );
  await target.dispatchEvent("dragenter", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

const PNG = {
  name: "dropped.png",
  type: "image/png",
  bytes: pngBuffer(90, 0, { width: 320, height: 180 }),
};
const PDF = {
  name: "brief.pdf",
  type: "application/pdf",
  bytes: Buffer.from("%PDF-1.4\n%e2e\n"),
};

test.describe("a new Image", () => {
  test.describe.configure({ timeout: 180_000 });

  test("is an empty box taller than 100px with its three choices, and asks for no image file", async ({
    page,
  }) => {
    const id = await createPage(page.request, [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Image empty state", level: "h2" },
      },
    ]);
    await openBuilder(page, id);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${HEADING}"]`)
      .click();

    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    const tile = page.getByRole("option", { name: "Image", exact: true });
    await expect(tile).toBeVisible();

    // Every image file asked for from here on, by the page or its canvas.
    const images: string[] = [];
    page.on("request", request => {
      if (request.resourceType() === "image") images.push(request.url());
    });
    await tile.click();

    const box = canvasFrame(page).locator(
      ".nx-canvas [data-nx-image-empty='empty']"
    );
    await expect(box).toHaveCount(1);
    const height = await box.evaluate(
      element => element.getBoundingClientRect().height
    );
    expect(height).toBeGreaterThan(100);

    const added = plate(page, "Add an image");
    await expect(added).toBeVisible();
    for (const name of ["Upload", "Media library", "Link"]) {
      await expect(
        added.getByRole("button", { name, exact: true })
      ).toBeVisible();
    }
    await expect(added.getByText("or drop a file here")).toBeVisible();
    expect(images).toEqual([]);

    await saveDraft(page);
    const nodes = await storedPageNodes(page.request, ENTRIES, id);
    const image = nodes.find(node => node.type === "core/image");
    expect(image?.props).not.toHaveProperty("src");
    expect(image?.props).not.toHaveProperty("mediaId");
  });
});

test.describe("a file dropped on an Image", () => {
  test.describe.configure({ timeout: 180_000 });

  test("refuses a PDF, then uploads a PNG with its progress on the block", async ({
    page,
  }) => {
    const id = await createPage(page.request, [imageNode(IMAGE)]);
    await openBuilder(page, id);
    await expect(emptyBox(page, IMAGE)).toHaveCount(1);
    const added = plate(page, "Add an image");
    await expect(added).toBeVisible();

    // Every upload the editor sends, held until the progress has been seen.
    const uploads: string[] = [];
    let release: () => void = () => undefined;
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route("**/admin/api/media", async route => {
      try {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        uploads.push(route.request().url());
        await released;
        await route.continue();
      } catch {
        // The page closed with the upload held; nothing to answer.
      }
    });

    await dropFile(added, page, PDF);
    await expect(added.getByRole("alert")).toHaveText(
      "That file isn't an image"
    );
    expect(uploads).toEqual([]);
    await expect(emptyBox(page, IMAGE)).toHaveCount(1);

    await dropFile(added, page, PNG);
    const progress = page.getByRole("progressbar", { name: "Uploading" });
    await expect(progress).toBeVisible();
    await expect(page.getByText("Uploading dropped.png")).toBeVisible();
    release();

    const picture = canvasFrame(page).locator(
      `.nx-canvas [data-nx-node="${IMAGE}"] img, .nx-canvas img[data-nx-node="${IMAGE}"]`
    );
    await expect(picture).toHaveCount(1, { timeout: 30_000 });
    await expect(emptyBox(page, IMAGE)).toHaveCount(0);
    expect(uploads).toHaveLength(1);

    // A PDF dropped on the picture it now has changes nothing.
    const frame = await canvasFrameOf(page);
    const before = await picture.getAttribute("src");
    await dropFile(
      frame.locator(`.nx-canvas [data-nx-node="${IMAGE}"]`).first(),
      frame,
      PDF
    );
    await expect(page.getByRole("alert")).toHaveText(
      "That file isn't an image"
    );
    expect(await picture.getAttribute("src")).toBe(before);
    expect(uploads).toHaveLength(1);

    await saveDraft(page);
    expect(await storedImage(page, id, IMAGE)).toHaveProperty("mediaId");
  });
});

test.describe("an Image's Link", () => {
  test.describe.configure({ timeout: 180_000 });

  test("shows a picture that loads, and says one that does not didn't load an image", async ({
    page,
  }) => {
    const good = "/e2e-image-empty-state-team.png";
    await page.route(`**${good}`, async route => {
      try {
        await route.fulfill({
          contentType: "image/png",
          body: pngBuffer(140, 0, { width: 320, height: 180 }),
        });
      } catch {
        // The page closed first.
      }
    });
    await page.route("https://example.com/nothing.png", async route => {
      try {
        await route.fulfill({ status: 404, body: "" });
      } catch {
        // The page closed first.
      }
    });
    const id = await createPage(page.request, [
      imageNode(IMAGE),
      imageNode(SECOND),
    ]);
    await openBuilder(page, id);
    await expect(page.locator(".nx-image-state")).toHaveCount(2);

    const first = page.locator(".nx-image-state").nth(0);
    await first.getByRole("button", { name: "Link", exact: true }).click();
    await first.getByLabel("Image address").fill(good);
    await first.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      canvasFrame(page).locator(`.nx-canvas img[src="${good}"]`)
    ).toHaveCount(1);

    // The first Image has its picture, so the second's plate is the one left.
    await expect(page.locator(".nx-image-state")).toHaveCount(1);
    const second = page.locator(".nx-image-state").first();
    await second.getByRole("button", { name: "Link", exact: true }).click();
    await second
      .getByLabel("Image address")
      .fill("https://example.com/nothing.png");
    await second.getByRole("button", { name: "Add", exact: true }).click();
    await expect(second.getByRole("alert")).toHaveText(
      "This link didn't load an image"
    );
    await expect(emptyBox(page, SECOND)).toHaveCount(1);
    await second.getByRole("button", { name: "Try another link" }).click();
    await expect(second.getByLabel("Image address")).toHaveValue(
      "https://example.com/nothing.png"
    );
    await expect(second.getByLabel("Image address")).toBeFocused();

    await saveDraft(page);
    expect(await storedImage(page, id, IMAGE)).toMatchObject({ src: good });
    expect(await storedImage(page, id, SECOND)).not.toHaveProperty("src");
  });
});

test.describe("the media library picker, from an Image", () => {
  test.describe.configure({ timeout: 180_000 });

  test("chooses a tile by a click on it, and picks and closes on a double-click", async ({
    page,
  }) => {
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const uploaded = await uploadImage(page.request, run);
    const id = await createPage(page.request, [imageNode(IMAGE)]);
    await openBuilder(page, id);

    await plate(page, "Add an image")
      .getByRole("button", { name: "Media library", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Choose an image" });
    await expect(dialog).toBeVisible();
    const tile = dialog.getByRole("button", {
      name: new RegExp(`^canvas-${run}\\.png - `),
    });
    await expect(tile).toBeVisible();
    const select = dialog.getByRole("button", { name: /^Select/ });
    await expect(select).toBeDisabled();
    // On the picture, away from its corner checkbox.
    await tile.locator("img").click({ position: { x: 40, y: 40 } });
    await expect(select).toHaveText("Select (1)");
    await expect(select).toBeEnabled();

    await tile.locator("img").dblclick({ position: { x: 40, y: 40 } });
    await expect(dialog).toBeHidden();
    await expect(
      canvasFrame(page).locator(`.nx-canvas [data-nx-node="${IMAGE}"]`)
    ).not.toHaveAttribute("data-nx-image-empty");

    await saveDraft(page);
    expect(await storedImage(page, id, IMAGE)).toMatchObject({
      mediaId: uploaded.id,
    });
  });
});

test.describe("an Image whose library file is gone", () => {
  test.describe.configure({ timeout: 180_000 });

  test("says the file is missing, with Replace", async ({ page }) => {
    const id = await createPage(page.request, [
      imageNode(IMAGE, { mediaId: "00000000-0000-4000-8000-0000000dead0" }),
    ]);
    await openBuilder(page, id);
    await expect(
      canvasFrame(page).locator(
        `.nx-canvas [data-nx-node="${IMAGE}"][data-nx-image-empty="missing"]`
      )
    ).toHaveCount(1);
    const missing = plate(page, "This image's file is missing");
    await expect(missing).toBeVisible();
    await expect(
      missing.getByRole("button", { name: "Replace", exact: true })
    ).toBeVisible();
    await expect(page.getByText("Add an image")).toHaveCount(0);
  });
});
