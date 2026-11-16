/**
 * Binding an image, and a date's format, from the inspector, as an author
 * does.
 *
 * 1. An image's Source row binds it to the `contact-details` Single's upload
 *    field; the field is empty, so the address set as its Fallback is what
 *    the canvas draws.
 * 2. The same image's Fallback is chosen from the media library: the picker
 *    opens on the Fallback row, a search narrows it to this run's upload,
 *    and the first image picked is shown in the row by its picture and file
 *    name, never by its id.
 * 3. An image bound with an address as its fallback is unbound: visitors saw
 *    that address, so it is kept in Image address, the image is left empty,
 *    the note says so, and the page holds it once saved and opened again.
 * 4. A heading bound to the page's own `createdAt`, seeded with a short date
 *    format as the save requires (a date reaches text only through one), is
 *    given a long one from the Format menu, and the canvas reformats it.
 *
 * @module tests/builder-image-binding.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  block,
  canvasRoot,
  clickBlock,
  layerRow,
  openLayers,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const IMAGE = "00000000-0000-4000-8000-0000001000e1";
const HEADING = "00000000-0000-4000-8000-0000001000e2";
const ALT = "Spring banner";

/** The binding the image is seeded with: the Single's empty upload field. */
const LOGO = {
  $bind: "logo",
  source: "single",
  sourceKey: "contact-details",
};

/** A published page holding one node, as given. */
async function seed(
  api: APIRequestContext,
  mark: string,
  node: Record<string, unknown>
): Promise<string> {
  const response = await api.post(PAGES, {
    data: {
      title: `Image binding ${mark}`,
      slug: `image-binding-${mark}`,
      status: "published",
      content: { formatVersion: 1, kind: "page", nodes: [node] },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function openAt(page: Page, id: string, nodeId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(await block(page, nodeId)).toBeVisible({ timeout: 60_000 });
  await clickBlock(page, nodeId);
}

/**
 * Open a page and select an image with nothing to draw yet. It has no box on
 * the canvas, so it is selected from Layers, as an author selects one.
 */
async function openUndrawnAt(
  page: Page,
  id: string,
  nodeId: string
): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await openLayers(page);
  await layerRow(page, nodeId).click();
}

/** The node as the saved page holds it. */
async function savedNode(
  api: APIRequestContext,
  id: string
): Promise<Record<string, unknown> | undefined> {
  // `draft=true`: a Save on a published page is held as its working draft
  // until it is published again.
  const response = await api.get(`${PAGES}/${id}?draft=true`);
  expect(response.ok(), await response.text()).toBe(true);
  // A read by id answers the entry itself, without a mutation's envelope.
  const entry = (await response.json()) as {
    content: { nodes: Record<string, unknown>[] };
  };
  return entry.content.nodes[0];
}

test.describe("binding an image and a date's format from the inspector", () => {
  test.describe.configure({ timeout: 240_000 });

  // A Single no one has saved has no document yet, and the picker lists only
  // those it can read; reading it through the API makes one.
  test.beforeEach(async ({ page }) => {
    const single = await page.request.get("/admin/api/singles/contact-details");
    expect(single.ok(), await single.text()).toBe(true);
  });

  test("binds an image to an upload field and draws its address fallback", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = Date.now().toString(36);
    const media = await uploadImage(page.request, mark);
    const id = await seed(page.request, mark, {
      id: IMAGE,
      type: "core/image",
      version: 1,
      props: { alt: ALT },
    });
    await openUndrawnAt(page, id, IMAGE);

    await page.getByRole("button", { name: "Bind Image to a field" }).click();
    const picker = page.getByRole("listbox", { name: "Fields for Image" });
    await picker
      .getByRole("group", { name: "Contact details" })
      .getByRole("option", { name: /^Logo/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: /^Image: bound to Logo of Contact details/,
      })
    ).toBeVisible();

    const fallback = page.getByRole("textbox", { name: "Fallback" });
    await fallback.fill(media.url);
    await fallback.press("Enter");
    // Named in full once stored, and drawn: the field it binds is empty.
    await expect(
      page.getByRole("textbox", { name: `Fallback: ${media.url}` })
    ).toBeVisible();
    const drawn = canvasFrame(page).getByRole("img", { name: ALT });
    await expect
      .poll(() => drawn.getAttribute("src"), { timeout: 30_000 })
      .toContain(new URL(media.url, page.url()).pathname);
  });

  test("chooses an image's fallback from the media library", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = Date.now().toString(36);
    const media = await uploadImage(page.request, mark);
    const id = await seed(page.request, mark, {
      id: IMAGE,
      type: "core/image",
      version: 1,
      props: { alt: ALT },
    });
    await openUndrawnAt(page, id, IMAGE);

    await page.getByRole("button", { name: "Bind Image to a field" }).click();
    await page
      .getByRole("listbox", { name: "Fields for Image" })
      .getByRole("group", { name: "Contact details" })
      .getByRole("option", { name: /^Logo/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: /^Image: bound to Logo of Contact details/,
      })
    ).toBeVisible();

    await page.getByRole("button", { name: "Choose from library" }).click();
    const search = page.getByRole("combobox", {
      name: "Find an image, or paste an address",
    });
    await expect(search).toBeFocused();
    // Narrowed to this run's upload, so an image another spec uploaded at
    // the same moment is not the first one.
    await search.fill(`canvas-${mark}`);
    const first = page
      .getByRole("listbox", { name: "Images in the media library" })
      .getByRole("option")
      .first();
    const named = new RegExp(`^canvas-${mark}`);
    await expect(first).toHaveAccessibleName(named, { timeout: 30_000 });
    await first.click();

    // Shown by its picture and its file name, in the address field's place.
    const row = page.getByRole("group", { name: /^Fallback: canvas-/ });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("title", /^Fallback: canvas-/);
    await expect(row.locator("img")).toHaveAttribute("src", /\S/);
    await expect(row).not.toContainText(media.id);
    await expect(page.getByRole("textbox", { name: /^Fallback/ })).toHaveCount(
      0
    );
  });

  test("unbinds from an image address into Image address, through a save", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = Date.now().toString(36);
    const media = await uploadImage(page.request, mark);
    const id = await seed(page.request, mark, {
      id: IMAGE,
      type: "core/image",
      version: 1,
      props: { alt: ALT },
      bindings: { mediaId: { ...LOGO, fallback: media.url } },
    });
    await openAt(page, id, IMAGE);

    await page.getByRole("button", { name: /^Image: bound to Logo/ }).click();
    await page
      .getByRole("menuitem", { name: "Unbind, keep the image" })
      .click();
    // Visitors saw the fallback's address: kept where an address goes.
    await expect(
      page.getByRole("status").filter({ hasText: "Unbound." })
    ).toHaveText(/so it's kept in Image address\.$/, { timeout: 30_000 });
    await expect(page.getByRole("radio", { name: "URL" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(
      page.getByRole("textbox", { name: "Image address" })
    ).toHaveValue(media.url);

    const saved = page.waitForResponse(
      response =>
        response.url().includes("/collections/pages/entries") &&
        ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
        response.ok()
    );
    await pressSave(page);
    await saved;
    const node = await savedNode(page.request, id);
    expect(node?.props).toMatchObject({ alt: ALT, src: media.url });
    expect(node?.props).not.toHaveProperty("mediaId");
    expect(node?.bindings).toBeUndefined();

    await openAt(page, id, IMAGE);
    await expect(
      page.getByRole("textbox", { name: "Image address" })
    ).toHaveValue(media.url);
    await expect(
      page.getByRole("button", { name: /^Image: bound to/ })
    ).toHaveCount(0);
  });

  test("reformats a bound date when another Format is chosen", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = Date.now().toString(36);
    const id = await seed(page.request, mark, {
      id: HEADING,
      type: "core/heading",
      version: 1,
      props: { text: "Its own heading", level: "h2" },
      bindings: {
        text: {
          $bind: "createdAt",
          format: { type: "date", options: { dateStyle: "short" } },
        },
      },
    });
    await openAt(page, id, HEADING);
    const heading = async (): Promise<string> =>
      (await (await canvasRoot(page))
        .locator(`[data-nx-node="${HEADING}"]`)
        .textContent()) ?? "";

    // The short date first, in the page's language (English): "11/8/26".
    const format = page.getByRole("combobox", { name: "Format" });
    await expect(format).toHaveText("Short date", { timeout: 30_000 });
    await expect
      .poll(heading, { timeout: 30_000 })
      .toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);

    await format.click();
    await page.getByRole("option", { name: "Long date" }).click();
    // The page's language is English: "November 8, 2026".
    await expect
      .poll(heading, { timeout: 30_000 })
      .toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });
});
