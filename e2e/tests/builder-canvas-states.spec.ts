/**
 * The canvas's states, as an author sees them, held to what WCAG asks of them
 * in both of the editor's themes, and the canvas's quiet: no image fetched
 * again and no error logged while an author works.
 *
 * jsdom applies no stylesheet and paints nothing, so every one of these is a
 * question only a browser can answer.
 *
 * - A state's MARK (a selection ring, a hover outline, a component's frame) is
 *   a user-interface component, held to the 3:1 non-text contrast of WCAG
 *   1.4.11 against the ground it is drawn over. axe judges text, not
 *   outlines, so the ratio is computed here from the colours the browser
 *   resolved, painted to a pixel so any colour syntax reads as RGB.
 * - A state's WORDS (a hovered block's name, a component's tag, an empty
 *   container's prompt, the gap's "+") are text: the tags are pseudo-elements
 *   axe cannot see, so they are held to 4.5:1 here; the rest is scanned by
 *   axe, scoped to the editor's chrome layer.
 *
 * @module builder-canvas-states.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { canvasBlock, canvasFrame, canvasLayer } from "./support/canvas-frame";
import { uploadImage } from "./support/media-upload";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const COMPONENTS = "/admin/api/collections/components/entries";
const HEADING = "00000000-0000-4000-8000-0000000c5a01";
const TEXT = "00000000-0000-4000-8000-0000000c5a02";
const EMPTY = "00000000-0000-4000-8000-0000000c5a03";
const IMAGE = "00000000-0000-4000-8000-0000000c5a04";
const PLACED = "00000000-0000-4000-8000-0000000c5a05";
const MARK = ".nx-canvas-mark";

function stamp(): string {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/** A page with a heading, words, an empty section, an image and a component. */
async function seed(page: Page): Promise<{ id: string; imageUrl: string }> {
  const run = stamp();
  const media = await uploadImage(page.request, run);
  const component = await page.request.post(COMPONENTS, {
    data: {
      title: `Promo ${run}`,
      slug: `promo-${run}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "component",
        nodes: [
          {
            id: "headline",
            type: "core/heading",
            version: 1,
            props: { text: "Built to last", level: "h2" },
          },
        ],
      },
    },
  });
  expect(component.ok(), `creating the component: ${component.status()}`).toBe(
    true
  );
  const componentId = ((await component.json()) as { item: { id: string } })
    .item.id;
  const created = await page.request.post(PAGES, {
    data: {
      title: "Canvas states",
      slug: `canvas-states-${run}`,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "Canvas states", level: "h2" },
          },
          {
            id: TEXT,
            type: "core/text",
            version: 1,
            props: { text: "Some words to hover and to edit." },
          },
          {
            id: EMPTY,
            type: "core/section",
            version: 1,
            props: { as: "section", contained: true },
            slots: { children: [] },
          },
          {
            id: IMAGE,
            type: "core/image",
            version: 1,
            props: { mediaId: media.id, alt: "A swatch" },
          },
          {
            id: PLACED,
            type: "nextly/component-instance",
            version: 1,
            props: { componentId },
          },
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return {
    id: ((await created.json()) as { item: { id: string } }).item.id,
    imageUrl: media.url,
  };
}

/**
 * The contrast ratio between two colours as the browser resolved them, each
 * painted to a pixel so `oklch()`, `color()` and the rest all read as RGB.
 * A translucent colour is composited over `ground`.
 */
async function contrast(
  page: Page,
  foreground: string,
  background: string
): Promise<number> {
  return page.evaluate(
    ([fg, bg]) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("no 2d context");
      const paint = (colour: string, under?: string) => {
        context.clearRect(0, 0, 1, 1);
        if (under !== undefined) {
          context.fillStyle = under;
          context.fillRect(0, 0, 1, 1);
        }
        context.fillStyle = colour;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const ground = paint(bg, "#ffffff");
      const groundColour = `rgb(${ground.slice(0, 3).join(",")})`;
      const a = luminance(paint(fg, groundColour));
      const b = luminance(ground);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    },
    [foreground, background] as const
  );
}

/** The canvas ground a mark is drawn over: the frame's page background. */
async function canvasGround(page: Page): Promise<string> {
  return canvasFrame(page)
    .locator(".nx-canvas")
    .evaluate(element => getComputedStyle(element).backgroundColor);
}

/** A mark's outline colour, and a pseudo-element tag's colours if asked. */
async function markColours(
  page: Page,
  selector: string,
  pseudo?: "::before"
): Promise<{ outline: string; text: string; tagGround: string }> {
  const mark = canvasLayer(page).locator(selector).first();
  await expect(mark).toBeVisible();
  return mark.evaluate((element, which) => {
    const own = getComputedStyle(element);
    const tag = which === undefined ? own : getComputedStyle(element, which);
    return {
      outline: own.outlineColor,
      text: tag.color,
      tagGround: tag.backgroundColor,
    };
  }, pseudo);
}

async function open(page: Page, id: string, theme: "light" | "dark") {
  await gotoAdmin(
    page,
    `/collections/pages/${id}/builder?field=content`,
    theme
  );
  await expect(canvasBlock(page, HEADING)).toBeVisible({ timeout: 30_000 });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`the canvas's states, ${theme}`, () => {
    test.describe.configure({ timeout: 240_000 });

    test("a selection's ring, the toolbar and the hover outline meet WCAG contrast", async ({
      page,
    }) => {
      const { id } = await seed(page);
      await open(page, id, theme);
      const ground = await canvasGround(page);

      await canvasBlock(page, HEADING).click();
      const selected = await markColours(page, `${MARK}[data-mark="selected"]`);
      expect(
        await contrast(page, selected.outline, ground),
        "the selection ring against the page"
      ).toBeGreaterThanOrEqual(3);

      // The toolbar's icons by ratio: the bar holds no text, so there is
      // nothing for axe's contrast rule to read there.
      const bar = page.getByRole("toolbar", { name: "Block actions" });
      await expect(bar).toBeVisible();
      const icon = await bar
        .locator("button svg")
        .first()
        .evaluate(svg => ({
          icon: getComputedStyle(svg).color,
          bar: getComputedStyle(svg.closest(".nx-block-toolbar") ?? svg)
            .backgroundColor,
        }));
      expect(
        await contrast(page, icon.icon, icon.bar),
        "a toolbar icon against the bar"
      ).toBeGreaterThanOrEqual(3);

      // A block the pointer is over, apart from the selected one.
      await canvasBlock(page, TEXT).hover();
      const hovered = await markColours(
        page,
        `${MARK}[data-mark="hovered"][data-hover-label]`,
        "::before"
      );
      expect(
        await contrast(page, hovered.outline, ground),
        "the hover outline against the page"
      ).toBeGreaterThanOrEqual(3);
      expect(
        await contrast(page, hovered.text, hovered.tagGround),
        "the hovered block's name"
      ).toBeGreaterThanOrEqual(4.5);
    });

    test("a component's frame and tag, an empty container and the gap's + meet WCAG contrast", async ({
      page,
    }) => {
      const { id } = await seed(page);
      await open(page, id, theme);
      const ground = await canvasGround(page);

      await canvasFrame(page)
        .locator(`[data-nx-instance="${PLACED}"]`)
        .first()
        .click();
      const placement = await markColours(
        page,
        `${MARK}[data-mark="selected"][data-placement-label]`,
        "::before"
      );
      expect(
        await contrast(page, placement.outline, ground),
        "the component's frame against the page"
      ).toBeGreaterThanOrEqual(3);
      expect(
        await contrast(page, placement.text, placement.tagGround),
        "the component's tag"
      ).toBeGreaterThanOrEqual(4.5);

      // The empty section's prompt, and the + in a gap the pointer is near.
      await expect(
        page.getByRole("button", {
          name: /Drop a block here, or click to add one, in /,
        })
      ).toBeVisible();
      // The first gap's +, named after the block above it.
      const add = page
        .getByRole("button", { name: /^Add a section after / })
        .first();
      const spot = await add.boundingBox();
      if (spot === null) throw new Error("the + is not laid out");
      await page.mouse.move(spot.x - 200, spot.y + spot.height / 2, {
        steps: 4,
      });
      await expect
        .poll(() => add.evaluate(element => getComputedStyle(element).opacity))
        .toBe("1");
      await expectNoAxeViolations(page, { include: "[data-nx-canvas-layer]" });
    });
  });
}

test.describe("the canvas while an author works", () => {
  test.describe.configure({ timeout: 240_000 });

  test("fetches an unchanged image once and logs no error", async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("console", message => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", error => problems.push(error.message));
    const { id, imageUrl } = await seed(page);
    const file = new URL(imageUrl, "http://localhost").pathname;
    const fetched: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname === file) fetched.push(request.url());
    });

    await open(page, id, "light");
    await expect(
      canvasFrame(page).locator(
        `img[data-nx-node="${IMAGE}"], [data-nx-node="${IMAGE}"] img`
      )
    ).toBeVisible();
    await expect
      .poll(() =>
        canvasBlock(page, IMAGE)
          .locator("img")
          .evaluate(image => (image as HTMLImageElement).complete)
      )
      .toBe(true);
    const first = fetched.length;
    // The control: the probe sees the image's own request at all.
    expect(first, "the image's first request is counted").toBeGreaterThan(0);

    // Select, hover, act from the toolbar, and edit text and leave it by
    // Escape: none changes the image.
    await canvasBlock(page, HEADING).click();
    await canvasBlock(page, IMAGE).hover();
    await canvasBlock(page, TEXT).click();
    await page.getByRole("button", { name: "Duplicate" }).click();
    await canvasBlock(page, HEADING).dblclick();
    await page.keyboard.type(" again");
    await page.keyboard.press("Escape");
    await expect(canvasBlock(page, HEADING)).toContainText("again");
    await page.waitForTimeout(500);

    expect(fetched.length, "the image is not fetched again").toBe(first);
    expect(problems, "errors logged while editing").toEqual([]);
  });
});
