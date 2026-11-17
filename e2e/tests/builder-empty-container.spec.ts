/**
 * An empty Section in the real editor: a square dashed outline inside its
 * edges and "＋ Add a block, or drop one here" in its middle, drawn so the
 * author's own background, border and corners show exactly as styled.
 *
 * What each asserts, and the broken version it rules out:
 *
 * - The Section's box, background, border and radius are the same with the
 *   editor's marker and with it switched off, and its outline is dashed and
 *   inside its edges. A marker drawn as a border, a radius or a grey tint
 *   changes them.
 * - The published page draws no marker. A rule that reached the site's own
 *   sheet would draw it for visitors.
 * - The words read at 4.5:1 or more, on an opaque plate, on a white, a
 *   near-black and a photographic Section.
 * - Hovering the Section draws a solid outline in the selection colour and a
 *   light tint of it over the area, and leaves the Section's own background
 *   as it was. A hover written on the block itself changes it.
 * - Pressing the words opens the picker aimed inside the Section, and the
 *   Heading chosen lands inside; a Heading dragged from the Add panel onto
 *   it lands inside too; and by keyboard alone, with the caret then in it.
 *
 * Each test makes its own page, named uniquely, so no lock is needed.
 *
 * @module tests/builder-empty-container.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  block,
  boxOf,
  canvasRoot,
  clearSelection,
  structure,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const BLOCK_PAGES = "/admin/api/collections/block-pages/entries";
const INTRO = "00000000-0000-4000-8000-0000000ce001";
const DARK = "00000000-0000-4000-8000-0000000ce002";
const LIGHT = "00000000-0000-4000-8000-0000000ce003";
const PHOTO = "00000000-0000-4000-8000-0000000ce004";

/** The near-black the dark Section is styled with, as computed. */
const NEAR_BLACK = "rgb(17, 24, 39)";

function stamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** An empty Section with the author's own look. */
function emptySection(id: string, name: string, look: object) {
  return {
    id,
    type: "core/section",
    version: 1,
    name,
    props: { as: "section", contained: true },
    styles: { base: { base: { minHeight: "160px", ...look } } },
    slots: { children: [] },
  };
}

/** A heading, then three empty Sections: near-black, white and a photo. */
function content() {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: INTRO,
        type: "core/heading",
        version: 1,
        props: { text: "Empty sections", level: "h2" },
      },
      emptySection(DARK, "Dark", {
        backgroundColor: "#111827",
        color: "#f9fafb",
        border: {
          width: {
            blockStart: "2px",
            blockEnd: "2px",
            inlineStart: "2px",
            inlineEnd: "2px",
          },
          style: "solid",
          color: "#f59e0b",
        },
        borderRadius: "12px",
      }),
      emptySection(LIGHT, "Light", { backgroundColor: "#ffffff" }),
      emptySection(PHOTO, "Photo", {
        background: { url: "/logo-latest-modified.png" },
      }),
    ],
  };
}

async function createPage(request: APIRequestContext): Promise<string> {
  const t = stamp();
  const created = await request.post(PAGES, {
    data: {
      title: `Empty container ${t}`,
      slug: `empty-container-${t}`,
      status: "draft",
      content: content(),
    },
  });
  expect(created.ok(), `creating the page: ${await created.text()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(async () => (await structure(page)).length).toBe(4);
}

function words(page: Page, name: string): Locator {
  return page.getByRole("button", {
    name: `Add a block, or drop one here, in ${name}`,
  });
}

function picker(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add a block" });
}

/** What the author styles on a block, and its box, as the browser draws it. */
async function styled(page: Page, id: string) {
  return (await block(page, id)).evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      background: style.backgroundColor,
      image: style.backgroundImage,
      border: [
        style.borderTopWidth,
        style.borderTopStyle,
        style.borderTopColor,
        style.borderLeftWidth,
      ].join(" "),
      radius: style.borderTopLeftRadius,
      padding: style.padding,
    };
  });
}

/** The blocks directly inside `parent`, in order. */
async function childrenOf(page: Page, parent: string): Promise<string[]> {
  return (await structure(page))
    .filter(entry => entry.startsWith(`${parent}>`))
    .map(entry => entry.slice(parent.length + 1));
}

test.describe("an empty Section in the editor", () => {
  test.describe.configure({ timeout: 240_000 });

  test("is outlined inside its edges, leaving its box, background, border and corners as styled", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    const dark = await block(page, DARK);
    await expect(dark).toHaveCSS("outline-style", "dashed");
    await expect(dark).toHaveCSS("outline-offset", "-1px");
    const marked = await styled(page, DARK);
    // As the author set them, with no grey laid over the colour.
    expect(marked.background).toBe(NEAR_BLACK);
    expect(marked.border).toBe("2px solid rgb(245, 158, 11) 2px");
    expect(marked.radius).toBe("12px");

    // The marker switched off: nothing the author styles moves.
    await (
      await canvasRoot(page)
    ).evaluate(root => {
      const off = root.ownerDocument.createElement("style");
      off.textContent = "[data-nx-slots]:empty { outline: none !important; }";
      root.ownerDocument.head.append(off);
    });
    await expect(dark).toHaveCSS("outline-style", "none");
    expect(await styled(page, DARK)).toEqual(marked);
  });

  test("keeps its words readable on a near-black, a white and a photo Section, in a contrast check", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    // The words sit on a plate of the editor's own surface, opaque, so the
    // Section's colour or photo beneath cannot change what they are read
    // against. Measured here rather than by axe, which cannot see through
    // the canvas's frame to judge text drawn over it.
    for (const name of ["Dark", "Light", "Photo"]) {
      const control = words(page, name);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      const read = await control.evaluate(button => {
        const plate = button.querySelector(
          ".nx-empty-container-appenders__plate"
        );
        const text = button.querySelector(
          ".nx-empty-container-appenders__words"
        );
        if (plate === null || text === null) return null;
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context === null) return null;
        const rgba = (colour: string): number[] => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = colour;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const luminance = ([r = 0, g = 0, b = 0]: number[]): number => {
          const channel = (value: number) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return (
            0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
          );
        };
        const ground = rgba(getComputedStyle(plate).backgroundColor);
        const ink = rgba(getComputedStyle(text).color);
        const [light, dark] = [luminance(ground), luminance(ink)].sort(
          (a, b) => b - a
        );
        return {
          opacity: ground[3] ?? 0,
          ratio: ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05),
        };
      });
      expect(read, name).not.toBeNull();
      expect(read?.opacity, `${name}: the plate is opaque`).toBe(255);
      expect(
        read?.ratio ?? 0,
        `${name}: the words' contrast`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("hovered, draws a solid outline and a tint as chrome over it, leaving its own background", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    const overlay = words(page, "Dark").locator(
      "xpath=preceding-sibling::*[1]"
    );
    await expect(overlay).toHaveClass(/nx-empty-container-appenders__area/);
    // Near the Section's corner, away from its words.
    const box = await boxOf(page, DARK);
    await page.mouse.move(box.x + 24, box.y + 24, { steps: 4 });
    await expect(overlay).toHaveAttribute("data-pointed", "");
    const drawn = await overlay.evaluate(element => {
      const probe = element.ownerDocument.createElement("span");
      probe.style.color = "var(--nx-builder-select)";
      element.parentElement?.append(probe);
      const select = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return {
        select,
        outline: style.outlineColor,
        outlineStyle: style.outlineStyle,
        tint: style.backgroundColor,
      };
    });
    expect(drawn.outlineStyle).toBe("solid");
    expect(drawn.outline).toBe(drawn.select);
    // A light tint: some of the selection colour, mostly see-through.
    const alpha = Number(/[\d.]+(?=\)$)/.exec(drawn.tint)?.[0] ?? "1");
    expect(drawn.tint, "the tint").not.toBe("rgba(0, 0, 0, 0)");
    expect(alpha).toBeLessThan(0.3);
    // The Section's own colour, untouched underneath.
    expect((await styled(page, DARK)).background).toBe(NEAR_BLACK);
  });

  test("opens the picker inside it from its words, and a Heading chosen there lands inside", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    await clearSelection(page);
    await words(page, "Dark").click();
    await expect(picker(page)).toHaveAccessibleDescription(
      "Adding inside Dark, at the end"
    );
    await picker(page).getByRole("gridcell", { name: "Heading" }).click();
    await expect.poll(() => childrenOf(page, DARK)).toHaveLength(1);
  });

  test("takes a Heading dragged onto it from the Add panel inside", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    const rail = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true });
    if ((await rail.getAttribute("aria-pressed")) !== "true") {
      await rail.click();
    }
    const from = await page
      .getByRole("option", { name: "Heading", exact: true })
      .boundingBox();
    const to = await boxOf(page, LIGHT);
    if (from === null) throw new Error("[e2e] no Heading tile");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 12 });
    await page.mouse.move(to.x + 48, to.y + to.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => childrenOf(page, LIGHT)).toHaveLength(1);
  });

  test("adds a block inside it by keyboard alone, the caret then in it", async ({
    page,
  }) => {
    const id = await createPage(page.request);
    await openBuilder(page, id);
    const add = words(page, "Light");
    for (let press = 0; press < 120; press += 1) {
      if (await add.evaluate(element => element === document.activeElement)) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(add).toBeFocused();
    // Its focus draws the overlay too.
    await expect(add.locator("xpath=preceding-sibling::*[1]")).toHaveCSS(
      "outline-style",
      "solid"
    );
    await page.keyboard.press("Enter");
    await expect(
      picker(page).getByRole("combobox", { name: "Search blocks" })
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => childrenOf(page, LIGHT)).toHaveLength(1);
    const [added] = await childrenOf(page, LIGHT);
    await expect
      .poll(async () =>
        (await canvasRoot(page)).evaluate(root => {
          const active = root.ownerDocument.activeElement;
          return (
            active?.closest("[data-nx-node]")?.getAttribute("data-nx-node") ??
            null
          );
        })
      )
      .toBe(added);
  });
});

test("the published page draws no marker in an empty Section", async ({
  page,
}) => {
  const slug = `empty-published-${stamp()}`;
  const created = await page.request.post(BLOCK_PAGES, {
    data: {
      title: "Empty section, published",
      slug,
      status: "published",
      content: content(),
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const response = await page.goto(`/blocks/${slug}`);
  expect(response?.status()).toBe(200);
  const dark = page.locator("section").filter({ hasNotText: /./ }).first();
  await expect(dark).toHaveCSS("outline-style", "none");
  await expect(dark).toHaveCSS("background-color", NEAR_BLACK);
  // No words, and no height beyond what the author set.
  await expect(page.getByText("Add a block, or drop one here")).toHaveCount(0);
  await expect(dark).toHaveCSS("min-height", "160px");
});
