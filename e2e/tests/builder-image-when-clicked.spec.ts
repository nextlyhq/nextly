/**
 * An Image's Content settings and its published picture, in the real editor
 * and on the live page.
 *
 * - A library picture's own alt text shows in the "Alt text" field as the
 *   value in use, marked "From the media library"; words typed there replace
 *   it, on the canvas too.
 * - "When clicked: Nothing / Link / Enlarge" shows the link settings only
 *   while Link is chosen.
 * - On the published page a Circle picture cut from a 16:9 file is a circle
 *   (as wide as it is tall), its caption is the figure's `figcaption`, and a
 *   decorative picture carries `alt=""`.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-image-when-clicked.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { pngBuffer } from "./support/media-files";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const BLOCK_PAGES = "/admin/api/collections/block-pages/entries";
const IMAGE = "00000000-0000-4000-8000-00000000c201";
const SECOND = "00000000-0000-4000-8000-00000000c202";
const LIBRARY_ALT = "A surveyor on a hillside";

/** A unique suffix for this run's names. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A 16:9 picture in the media library, with the alt text the library holds. */
async function libraryPicture(request: APIRequestContext): Promise<string> {
  const uploaded = await request.post("/admin/api/media", {
    multipart: {
      file: {
        name: `wide-${stamp()}.png`,
        mimeType: "image/png",
        buffer: pngBuffer(120, 0, { width: 320, height: 180 }),
      },
    },
  });
  expect(uploaded.ok(), `uploading: ${uploaded.status()}`).toBe(true);
  const body = (await uploaded.json()) as { item?: { id: string } };
  const id = String(body.item?.id);
  const described = await request.patch(`/admin/api/media/${id}`, {
    data: { altText: LIBRARY_ALT },
  });
  expect(described.ok(), `describing: ${described.status()}`).toBe(true);
  return id;
}

/** A page in `collection` holding these nodes, and its id. */
async function createPage(
  request: APIRequestContext,
  collection: string,
  nodes: unknown[],
  status: "draft" | "published" = "draft"
): Promise<{ id: string; slug: string }> {
  const slug = `image-when-clicked-${stamp()}`;
  const created = await request.post(collection, {
    data: {
      title: `Image when clicked ${slug}`,
      slug,
      status,
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/** Open the builder on a page and select its Image. */
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

test.describe("an Image's settings and its published picture", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the alt field shows the library's alt text as the value in use, and typed words replace it", async ({
    page,
  }) => {
    const mediaId = await libraryPicture(page.request);
    const { id } = await createPage(page.request, PAGES, [
      { id: IMAGE, type: "core/image", version: 1, props: { mediaId } },
    ]);
    await openImage(page, id);
    const content = page.getByRole("tabpanel", { name: "Content" });
    const alt = content.getByRole("textbox", { name: "Alt text" });
    await expect(alt).toHaveValue(LIBRARY_ALT);
    await expect(content.getByText("From the media library")).toBeVisible();

    await alt.fill("Our survey team at work");
    await alt.press("Enter");
    await expect(
      canvasFrame(page).getByRole("img", { name: "Our survey team at work" })
    ).toBeVisible();
    await expect(content.getByText("From the media library")).toHaveCount(0);
    await expect(
      content.getByRole("button", { name: "Use the media library's alt text" })
    ).toBeVisible();
  });

  test("the link settings show only while When clicked is Link", async ({
    page,
  }) => {
    const mediaId = await libraryPicture(page.request);
    const { id } = await createPage(page.request, PAGES, [
      { id: IMAGE, type: "core/image", version: 1, props: { mediaId } },
    ]);
    await openImage(page, id);
    const content = page.getByRole("tabpanel", { name: "Content" });
    await content.getByRole("button", { name: /^When clicked/ }).click();
    const choices = content.getByRole("radiogroup", { name: "When clicked" });
    const link = content.getByRole("button", { name: /^Link:/ });

    await expect(choices.getByRole("radio", { name: "Nothing" })).toBeChecked();
    await expect(link).toHaveCount(0);
    await choices.getByRole("radio", { name: "Link" }).click();
    await expect(link).toBeVisible();
    await choices.getByRole("radio", { name: "Enlarge" }).click();
    await expect(link).toHaveCount(0);
    await choices.getByRole("radio", { name: "Nothing" }).click();
    await expect(link).toHaveCount(0);
  });

  test("on the published page a Circle cut from a 16:9 picture is round, captioned and alt-texted", async ({
    page,
  }) => {
    const mediaId = await libraryPicture(page.request);
    const circle = ["look:core/image:circle"];
    const { slug } = await createPage(
      page.request,
      BLOCK_PAGES,
      [
        {
          id: IMAGE,
          type: "core/image",
          version: 1,
          props: { mediaId, caption: "Our team" },
          classes: circle,
        },
        {
          id: SECOND,
          type: "core/image",
          version: 1,
          props: { mediaId, decorative: true, href: "/about" },
          classes: circle,
        },
      ],
      "published"
    );
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/blocks/${slug}`);
      const pictures = page.locator(".nx-pb-page img");
      await expect(pictures).toHaveCount(2);
      for (const index of [0, 1]) {
        const picture = pictures.nth(index);
        await expect
          .poll(() =>
            picture.evaluate(element => (element as HTMLImageElement).complete)
          )
          .toBe(true);
        const box = await picture.boundingBox();
        expect(box, `picture ${index} has a box at ${width}px`).not.toBeNull();
        expect(box?.width ?? 0).toBeGreaterThan(50);
        // A circle: as wide as it is tall, never the file's 16:9.
        expect(
          Math.abs((box?.width ?? 0) - (box?.height ?? 0)),
          `picture ${index} at ${width}px is ${box?.width}x${box?.height}`
        ).toBeLessThanOrEqual(1);
      }
      const figure = page.locator(".nx-pb-page figure");
      await expect(figure.locator("img")).toHaveCount(1);
      await expect(figure.locator(":scope > figcaption")).toHaveText(
        "Our team"
      );
      await expect(pictures.first()).toHaveAttribute("alt", LIBRARY_ALT);
      await expect(pictures.nth(1)).toHaveAttribute("alt", "");
      // Nothing runs past a phone's width.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
    }
  });
});
