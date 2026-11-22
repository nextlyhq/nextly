/**
 * Many pictures in a Gallery, in the real editor and on the live page.
 *
 * - A Gallery added from the Add panel holds no Image, asks for no picture
 *   file, and reads "Add images" with Upload, Media library and "or drop
 *   files here" in place of an empty container's "+".
 * - "+ Add images" picks four library files and adds them in pick order;
 *   three files dropped on the gallery are uploaded and added after them;
 *   one Undo takes away the three alone.
 * - A click on a picture titles the panel "Picture N · in <gallery>", and
 *   "← Back to the gallery" selects the gallery.
 * - A picture dragged before the first, on the canvas and in Layers, moves
 *   there.
 * - Columns 2 then 4 lay the canvas's grid out in two then four tracks, and
 *   On mobile 2 in two at the site's phone width.
 * - On the live page a gallery set to Enlarge opens a lightbox from each
 *   picture that says nothing itself, and a picture with a link is a link.
 *
 * Each test makes its own page. The site's devices are stored for the file,
 * so it holds the site-style lock.
 *
 * @module tests/gallery-add-images.spec
 */
import {
  expect,
  type APIRequestContext,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  layerRow,
  openLayers,
  pressSave,
  selection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame, CANVAS_FRAME } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { pngBuffer } from "./support/media-files";
import { storeSiteBreakpoints } from "./support/site-breakpoints";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-0000000a0a01";
const GALLERY = "00000000-0000-4000-8000-0000000a0a02";
const PICTURES = [
  "00000000-0000-4000-8000-0000000a0a11",
  "00000000-0000-4000-8000-0000000a0a12",
  "00000000-0000-4000-8000-0000000a0a13",
  "00000000-0000-4000-8000-0000000a0a14",
];
const DEVICES = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};
// The editor's own undo: the suite's browser reports Windows on every host.
const UNDO = "Control+z";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A picture in the media library, named so the picker can find it. */
async function libraryPicture(
  request: APIRequestContext,
  name: string,
  shade: number
): Promise<string> {
  const uploaded = await request.post("/admin/api/media", {
    multipart: {
      file: {
        name,
        mimeType: "image/png",
        buffer: pngBuffer(shade, 0, { width: 320, height: 180 }),
      },
    },
  });
  expect(uploaded.ok(), `uploading: ${uploaded.status()}`).toBe(true);
  const body = (await uploaded.json()) as { item?: { id: string } };
  return String(body.item?.id);
}

function pictureNode(id: string, props: Record<string, unknown>) {
  return { id, type: "core/image", version: 1, props };
}

function galleryNode(children: unknown[], props: Record<string, unknown> = {}) {
  return {
    id: GALLERY,
    type: "core/gallery",
    version: 1,
    name: "Team photos",
    props: { as: "div", ...props },
    slots: { children },
  };
}

/** A page of its own holding these nodes: its id and its slug. */
async function createPage(
  request: APIRequestContext,
  nodes: unknown[],
  status: "draft" | "published" = "draft"
): Promise<{ id: string; slug: string }> {
  const slug = `gallery-add-images-${stamp()}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Gallery ${slug}`,
      slug,
      status,
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/** A page holding a gallery of `count` library pictures, and their ids. */
async function pageWithPictures(
  request: APIRequestContext,
  count: number,
  galleryProps: Record<string, unknown> = {}
): Promise<{ id: string; slug: string; media: string[] }> {
  const run = stamp();
  const media: string[] = [];
  for (let index = 0; index < count; index += 1) {
    media.push(
      await libraryPicture(
        request,
        `gallery-${run}-${index}.png`,
        40 + index * 40
      )
    );
  }
  const children = media.map((mediaId, index) =>
    pictureNode(PICTURES[index] ?? `p${index}`, { mediaId })
  );
  const created = await createPage(request, [
    galleryNode(children, galleryProps),
  ]);
  return { ...created, media };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
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

/** The gallery's pictures as saved, in order: each one's props. */
async function storedPictures(
  page: Page,
  id: string
): Promise<Record<string, unknown>[]> {
  const nodes = await storedPageNodes(page.request, ENTRIES, id);
  const gallery = nodes.find(node => node.type === "core/gallery") as
    | {
        slots?: {
          children?: { type: string; props: Record<string, unknown> }[];
        };
      }
    | undefined;
  const children = gallery?.slots?.children ?? [];
  expect(children.every(child => child.type === "core/image")).toBe(true);
  return children.map(child => child.props);
}

/** The gallery's own box on the canvas. */
function galleryOnCanvas(page: Page): Locator {
  return canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${GALLERY}"]`)
    .first();
}

/** How many pictures the canvas draws in the gallery. */
async function picturesOnCanvas(page: Page): Promise<string[]> {
  return (await structure(page))
    .filter(entry => entry.startsWith(`${GALLERY}>`))
    .map(entry => entry.slice(GALLERY.length + 1));
}

/** The editor's plate drawn over an empty gallery. */
function galleryPlate(page: Page): Locator {
  return page
    .locator(".nx-image-state")
    .filter({ hasText: "Add images" })
    .first();
}

/** A Content section, opened if it is closed. */
async function openSection(page: Page, name: string): Promise<Locator> {
  const content = page.getByRole("tabpanel", { name: "Content" });
  const heading = content.getByRole("button", {
    name: new RegExp(`^${name}`),
  });
  if ((await heading.getAttribute("aria-expanded")) !== "true") {
    await heading.click();
  }
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  return content;
}

/** The frame the canvas is drawn in. */
async function canvasDocument(page: Page): Promise<Frame> {
  const frame = await page.locator(CANVAS_FRAME).elementHandle();
  const content = await frame?.contentFrame();
  if (content === null || content === undefined) {
    throw new Error("[e2e] the canvas frame has no document");
  }
  return content;
}

/** Drop files on an element in the canvas, built in the canvas's document. */
async function dropFiles(
  page: Page,
  target: Locator,
  files: { name: string; bytes: Buffer }[]
): Promise<void> {
  const frame = await canvasDocument(page);
  const transfer = await frame.evaluateHandle(
    (all: { name: string; bytes: number[] }[]) => {
      const data = new DataTransfer();
      for (const file of all) {
        data.items.add(
          new File([new Uint8Array(file.bytes)], file.name, {
            type: "image/png",
          })
        );
      }
      return data;
    },
    files.map(file => ({ name: file.name, bytes: [...file.bytes] }))
  );
  await target.dispatchEvent("dragenter", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
}

/** The columns a grid lays out, as the browser computes them. */
async function tracks(gallery: Locator): Promise<number> {
  return gallery.evaluate(
    element =>
      getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean)
        .length
  );
}

test.describe("many pictures in a gallery", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async ({ request }) => {
    await storeSiteBreakpoints(request, DEVICES);
  });
  test.afterAll(async ({ request }) => {
    await storeSiteBreakpoints(request, null);
  });

  test("a gallery added from the Add panel holds no Image, asks for no file, and reads Add images", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, [
      {
        id: HEADING,
        type: "core/heading",
        version: 1,
        props: { text: "Our team", level: "h2" },
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
    const tile = page.getByRole("option", { name: "Gallery", exact: true });
    await expect(tile).toBeVisible();

    // Every picture file asked for from here on, and any that failed.
    const images: string[] = [];
    const broken: string[] = [];
    page.on("request", request => {
      if (request.resourceType() === "image") images.push(request.url());
    });
    page.on("requestfailed", request => {
      if (request.resourceType() === "image") broken.push(request.url());
    });
    await tile.click();

    await expect.poll(async () => (await selection(page)).length).toBe(1);
    const [added] = await selection(page);
    expect(added).not.toBe(HEADING);
    const plate = page
      .locator(".nx-image-state")
      .filter({ hasText: "Add images" });
    await expect(plate).toHaveCount(1);
    await expect(plate).toBeVisible();
    for (const name of ["Upload", "Media library"]) {
      await expect(
        plate.getByRole("button", { name, exact: true })
      ).toBeVisible();
    }
    await expect(plate.getByText("or drop files here")).toBeVisible();
    // No empty container's "+" for it, and no Image inside it.
    await expect(
      page.getByRole("button", {
        name: /Add a block, or drop one here, in Gallery/,
      })
    ).toHaveCount(0);
    expect(
      (await structure(page)).filter(entry => entry.startsWith(`${added}>`))
    ).toEqual([]);
    expect(images).toEqual([]);
    expect(broken).toEqual([]);

    await saveDraft(page);
    const nodes = await storedPageNodes(page.request, ENTRIES, id);
    const gallery = nodes.find(node => node.type === "core/gallery") as
      | { slots?: { children?: unknown[] } }
      | undefined;
    expect(gallery).toBeDefined();
    expect(gallery?.slots?.children ?? []).toEqual([]);
  });

  test("Add images picks four in pick order, three dropped files follow, and one Undo takes the three away", async ({
    page,
  }) => {
    const run = stamp();
    const media: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      media.push(
        await libraryPicture(
          page.request,
          `pick-${run}-${index}.png`,
          30 + index * 50
        )
      );
    }
    const { id } = await createPage(page.request, [galleryNode([])]);
    await openBuilder(page, id);
    await expect(galleryPlate(page)).toBeVisible();
    // A press on the plate selects the gallery.
    await galleryPlate(page).locator(".nx-image-state__title").click();
    await expect(page.locator("[data-block-card] h2")).toHaveText(
      "Team photos · Gallery"
    );
    await page.getByRole("tab", { name: "Content" }).click();
    const content = await openSection(page, "Pictures");
    await content.getByRole("button", { name: "Add images" }).click();

    const dialog = page.getByRole("dialog", { name: "Choose images" });
    await expect(dialog).toBeVisible();
    // Picked out of the order they were uploaded in: 3, 1, 4, 2.
    const order = [2, 0, 3, 1];
    for (const index of order) {
      await dialog
        .getByRole("button", {
          name: new RegExp(`^pick-${run}-${index}\\.png - `),
        })
        .locator("img")
        .click({ position: { x: 40, y: 40 } });
    }
    await dialog.getByRole("button", { name: "Select (4)" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => picturesOnCanvas(page)).toHaveLength(4);

    // Three files dropped on the gallery itself, in the canvas.
    const dropped = [0, 1, 2].map(index => ({
      name: `dropped-${run}-${index}.png`,
      bytes: pngBuffer(60 + index * 60, 0, { width: 320, height: 180 }),
    }));
    await dropFiles(page, galleryOnCanvas(page), dropped);
    await expect
      .poll(() => picturesOnCanvas(page), { timeout: 60_000 })
      .toHaveLength(7);

    await saveDraft(page);
    const seven = await storedPictures(page, id);
    expect(seven.slice(0, 4).map(props => props.mediaId)).toEqual(
      order.map(index => media[index])
    );
    // Each a library file, and nothing else invented on it.
    for (const props of seven) {
      expect(typeof props.mediaId).toBe("string");
      expect(Object.keys(props).sort()).toEqual(["loading", "mediaId"]);
    }

    // One Undo: the three dropped go, the four picked stay.
    await page.locator("[data-block-card]").click();
    await page.keyboard.press(UNDO);
    await expect.poll(() => picturesOnCanvas(page)).toHaveLength(4);
    await saveDraft(page);
    expect(
      (await storedPictures(page, id)).map(props => props.mediaId)
    ).toEqual(order.map(index => media[index]));
  });

  test("a click on a picture titles the panel by its place, with a way back to the gallery", async ({
    page,
  }) => {
    const { id } = await pageWithPictures(page.request, 3);
    await openBuilder(page, id);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${PICTURES[1]}"]`)
      .click();
    const title = page.locator("[data-block-card] h2");
    await expect(title).toHaveText("Picture 2 · in Team photos");
    await page.getByRole("button", { name: "← Back to the gallery" }).click();
    await expect(title).toHaveText("Team photos · Gallery");
    expect(await selection(page)).toEqual([GALLERY]);
  });

  test("a picture dragged before the first moves there, on the canvas and in Layers", async ({
    page,
  }) => {
    const { id } = await pageWithPictures(page.request, 3);
    const [first, second, third] = PICTURES;
    await openBuilder(page, id);
    await expect
      .poll(() => picturesOnCanvas(page))
      .toEqual([first, second, third]);

    // On the canvas: the third picture, over the first one's leading half.
    const from = await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${third}"]`)
      .boundingBox();
    const onto = await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${first}"]`)
      .boundingBox();
    if (from === null || onto === null) throw new Error("[e2e] no picture box");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      from.x + from.width / 2,
      from.y + from.height / 2 + 14,
      {
        steps: 4,
      }
    );
    await page.mouse.move(
      onto.x + onto.width * 0.15,
      onto.y + onto.height / 2,
      {
        steps: 20,
      }
    );
    await page.mouse.up();
    await expect
      .poll(() => picturesOnCanvas(page))
      .toEqual([third, first, second]);

    // In Layers: the last row, over the first row's upper half. A picture
    // selected on the canvas opens the gallery's row to show it.
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${second}"]`)
      .click();
    await openLayers(page);
    await expect(layerRow(page, second ?? "")).toBeVisible();
    const row = await layerRow(page, second ?? "").boundingBox();
    const top = await layerRow(page, third ?? "").boundingBox();
    if (row === null || top === null) throw new Error("[e2e] a row has no box");
    const x = row.x + 48;
    await page.mouse.move(x, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, row.y + row.height / 2 + 6, { steps: 3 });
    await page.mouse.move(x, top.y + top.height * 0.25, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() => picturesOnCanvas(page))
      .toEqual([second, third, first]);

    await saveDraft(page);
    const nodes = await storedPageNodes(page.request, ENTRIES, id);
    const gallery = nodes.find(node => node.id === GALLERY) as
      | { slots?: { children?: { id: string }[] } }
      | undefined;
    expect(gallery?.slots?.children?.map(child => child.id)).toEqual([
      second,
      third,
      first,
    ]);
  });

  test("Columns 2 then 4, and On mobile 2, lay the canvas's grid out to match", async ({
    page,
  }) => {
    const { id } = await pageWithPictures(page.request, 4);
    await openBuilder(page, id);
    const gallery = galleryOnCanvas(page);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${PICTURES[0]}"]`)
      .click();
    await page.getByRole("button", { name: "← Back to the gallery" }).click();
    await page.getByRole("tab", { name: "Content" }).click();
    const content = await openSection(page, "Layout");
    const columns = content.getByRole("radiogroup", { name: "Columns" });
    const mobile = content.getByRole("radiogroup", { name: "On mobile" });
    // Nothing stored: the block's own grid, three across.
    await expect(columns.getByRole("radio", { name: "3" })).toBeChecked();
    await expect(mobile.getByRole("radio", { name: "1" })).toBeChecked();
    await expect.poll(() => tracks(gallery)).toBe(3);

    await columns.getByRole("radio", { name: "2" }).click();
    await expect.poll(() => tracks(gallery)).toBe(2);
    await columns.getByRole("radio", { name: "4" }).click();
    await expect.poll(() => tracks(gallery)).toBe(4);
    await mobile.getByRole("radio", { name: "2" }).click();
    await expect(mobile.getByRole("radio", { name: "2" })).toBeChecked();

    // At the site's phone width the canvas draws the phone's count.
    await page
      .getByRole("radiogroup", { name: "Device" })
      .getByRole("radio", { name: /^Mobile/ })
      .click();
    await expect.poll(() => tracks(gallery)).toBe(2);

    await saveDraft(page);
    const nodes = await storedPageNodes(page.request, ENTRIES, id);
    const stored = nodes.find(node => node.id === GALLERY) as
      | { styles?: Record<string, Record<string, Record<string, unknown>>> }
      | undefined;
    expect(stored?.styles?.base?.base?.gridTemplateColumns).toBe(
      "repeat(4, minmax(0, 1fr))"
    );
    expect(stored?.styles?.base?.mobile?.gridTemplateColumns).toBe(
      "repeat(2, minmax(0, 1fr))"
    );
  });

  test("on the live page a gallery set to Enlarge opens its pictures large, and a linked one links", async ({
    page,
  }) => {
    const run = stamp();
    const media: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      media.push(
        await libraryPicture(
          page.request,
          `live-${run}-${index}.png`,
          50 + index * 50
        )
      );
    }
    const alts = ["The north ridge", "The survey camp", "The valley floor"];
    const { slug, id } = await createPage(
      page.request,
      [
        galleryNode(
          [
            pictureNode(PICTURES[0] ?? "", { mediaId: media[0], alt: alts[0] }),
            pictureNode(PICTURES[1] ?? "", {
              mediaId: media[1],
              alt: alts[1],
              whenClicked: "link",
              href: "/about",
            }),
            pictureNode(PICTURES[2] ?? "", { mediaId: media[2], alt: alts[2] }),
          ],
          { whenClicked: "enlarge" }
        ),
      ],
      "published"
    );

    // In the editor, a picture that says nothing follows the gallery.
    await openBuilder(page, id);
    await canvasFrame(page)
      .locator(`.nx-canvas [data-nx-node="${PICTURES[0]}"]`)
      .click();
    await page.getByRole("tab", { name: "Content" }).click();
    const content = await openSection(page, "When clicked");
    await expect(
      content
        .getByRole("radiogroup", { name: "When clicked" })
        .getByRole("radio", { name: "Same as the gallery (Enlarge)" })
    ).toBeChecked();

    await page.goto(`/${slug}`);
    for (const alt of [alts[0], alts[2]]) {
      const opener = page.getByRole("button", { name: `Enlarge: ${alt}` });
      await expect(opener).toHaveCount(1);
      await opener.click();
      await expect(page.locator("[data-nx-lightbox]:popover-open")).toHaveCount(
        1
      );
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-nx-lightbox]:popover-open")).toHaveCount(
        0
      );
    }
    const linked = page.locator(".nx-pb-page a[href='/about']");
    await expect(linked).toHaveCount(1);
    await expect(linked.getByRole("img", { name: alts[1] })).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: `Enlarge: ${alts[1]}` })
    ).toHaveCount(0);
  });
});
