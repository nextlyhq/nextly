/**
 * Binding an image, and a date's format, from the inspector, as an author
 * does.
 *
 * 1. An image's Source row binds it to the `related-links` Single's upload
 *    field; the field is empty, so the address set as its Fallback is what
 *    the canvas draws.
 * 2. An image bound with an address as its fallback is unbound: visitors saw
 *    that address, so it is kept in Image address, the image is left empty,
 *    the note says so, and the page holds it once saved and opened again.
 * 3. A heading bound to the page's own `createdAt`, seeded with a short date
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
const LOGO = { $bind: "logo", source: "single", sourceKey: "related-links" };

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

/** The node as the saved page holds it. */
async function savedNode(
  api: APIRequestContext,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const response = await api.get(`${PAGES}/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  const { item } = (await response.json()) as {
    item: { content: { nodes: Record<string, unknown>[] } };
  };
  return item.content.nodes[0];
}

test.describe("binding an image and a date's format from the inspector", () => {
  test.describe.configure({ timeout: 240_000 });

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
    await openAt(page, id, IMAGE);

    await page.getByRole("button", { name: "Bind Image to a field" }).click();
    const picker = page.getByRole("listbox", { name: "Fields for Image" });
    await picker
      .getByRole("group", { name: "Related links" })
      .getByRole("option", { name: /^Logo/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: /^Image: bound to Logo of Related links/,
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
