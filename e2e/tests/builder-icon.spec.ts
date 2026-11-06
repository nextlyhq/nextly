/**
 * The Icon block, end to end: a published page draws it with no script, the
 * canvas draws it, and the Content tab changes it through the picker, which
 * offers the author's recent icons first.
 *
 * - Published, the SVG is in the server's markup and the page draws it with
 *   JavaScript off, so it ships no script; a decorative icon is hidden from
 *   assistive technology, a labelled one is an image with that name, and a
 *   linked one a link named by its label.
 * - On the canvas the icon is drawn from the same set, loaded when first
 *   needed.
 * - Choosing another icon in the picker redraws the canvas and is stored as
 *   the block's id; the next time the picker opens, it is first under Recent.
 *
 * @module tests/builder-icon.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/** A page with a decorative icon, a labelled one and a linked one. */
async function seed(
  page: Page,
  status: "draft" | "published"
): Promise<{ id: string; slug: string }> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const slug = `icons-${run}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: "Icons",
      slug,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "lead",
            type: "core/heading",
            version: 1,
            props: { text: "Why shop with us", level: "h2" },
          },
          {
            id: "plain",
            type: "core/icon",
            version: 1,
            props: { icon: "lucide:star", label: "" },
          },
          {
            id: "named",
            type: "core/icon",
            version: 1,
            props: { icon: "lucide:truck", label: "Free delivery" },
          },
          {
            id: "linked",
            type: "core/icon",
            version: 1,
            props: {
              icon: "lucide:mail",
              label: "Write to us",
              href: "/contact",
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

test.describe("the Icon block", () => {
  test.describe.configure({ timeout: 180_000 });

  test("is drawn on a published page with JavaScript off", async ({
    page,
    browser,
    baseURL,
  }) => {
    const { slug } = await seed(page, "published");
    const visitor = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
    });
    try {
      const reader = await visitor.newPage();
      const response = await reader.goto(`/${slug}`);
      expect(response?.status()).toBe(200);
      // In the server's markup, not added by a script.
      const html = (await response?.text()) ?? "";
      expect(html).toContain('aria-label="Free delivery"');
      // Decorative: drawn, and hidden from assistive technology.
      const svgs = reader.locator("main svg, body svg");
      await expect(
        reader.getByRole("img", { name: "Free delivery" })
      ).toBeVisible();
      const link = reader.getByRole("link", { name: "Write to us" });
      await expect(link).toHaveAttribute("href", "/contact");
      await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
      const hidden = await svgs.evaluateAll(
        all =>
          all.filter(
            svg =>
              svg.getAttribute("aria-hidden") === "true" &&
              svg.closest("a") === null &&
              svg.querySelector("path,circle,rect,polyline,line") !== null
          ).length
      );
      expect(hidden, "the decorative star").toBeGreaterThanOrEqual(1);
      // Each drawn from the set: stroked shapes, sized by the text.
      const named = reader.getByRole("img", { name: "Free delivery" });
      await expect(named).toHaveAttribute("width", "1em");
      await expect(named).toHaveAttribute("stroke", "currentColor");
    } finally {
      await visitor.close();
    }
  });

  test("is drawn on the canvas, and changed from the Content tab's picker", async ({
    page,
  }) => {
    const { id } = await seed(page, "draft");
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(canvasBlock(page, "lead")).toBeVisible({ timeout: 30_000 });

    // Drawn on the canvas from the same set as the published page.
    const named = canvasFrame(page).getByRole("img", { name: "Free delivery" });
    await expect(named).toBeVisible({ timeout: 30_000 });
    await expect(named.locator("path, circle, rect").first()).toBeAttached();

    await canvasBlock(page, "named").click();
    await page.getByRole("tab", { name: "Content" }).click();
    const content = page.getByRole("tabpanel", { name: "Content" });
    const field = content.getByRole("button", { name: "Icon: Truck" });
    await expect(field).toBeVisible();

    // Search, choose, and the canvas draws the new icon in the old one's place.
    const drawn = (): Promise<string> =>
      canvasBlock(page, "named").evaluate(
        element =>
          (element.matches("svg") ? element : element.querySelector("svg"))
            ?.innerHTML ?? ""
      );
    const truck = await drawn();
    expect(truck).not.toBe("");
    await field.click();
    const search = page.getByRole("combobox", { name: "Search icons" });
    await expect(search).toBeFocused();
    await search.fill("package");
    await page.getByRole("option", { name: "Package", exact: true }).click();
    await expect(
      content.getByRole("button", { name: "Icon: Package" })
    ).toBeVisible();
    await expect.poll(drawn).not.toBe(truck);
    expect(await drawn()).not.toBe("");

    // The next time the picker opens, the icon just chosen leads, under Recent.
    await content.getByRole("button", { name: "Icon: Package" }).click();
    await expect(
      page.getByRole("option", { name: "Package, recent, current" })
    ).toBeVisible();
    await expect(page.getByText("Recent", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      content.getByRole("button", { name: "Icon: Package" })
    ).toBeFocused();
  });
});
