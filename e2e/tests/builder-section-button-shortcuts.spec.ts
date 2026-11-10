/**
 * A Section's overlay and Height, and a Button's Size, in the real editor and
 * on the published page.
 *
 * - On the PUBLISHED page a Section's overlay is laid over its image, and a
 *   Section nested inside it, with an image and no overlay of its own, paints
 *   no overlay at all: the overlay does not inherit.
 * - Height's Full screen stores `min-height: 100svh`, and the canvas draws the
 *   Section at least as tall as its frame.
 * - Size's Small stores the button's own padding tokens scaled, and the canvas
 *   draws the button with less padding than Medium; Full width spans its
 *   container with the label centred.
 * - The overlay is offered only once the Section has an image.
 *
 * @module tests/builder-section-button-shortcuts.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const OUTER = "00000000-0000-4000-8000-00000000d001";
const INNER = "00000000-0000-4000-8000-00000000d002";
const BUTTON = "00000000-0000-4000-8000-00000000d003";

const PAD = {
  blockStart: "24px",
  blockEnd: "24px",
  inlineStart: "24px",
  inlineEnd: "24px",
};

/** A page of the given nodes, returning its id and slug. */
async function createPage(
  request: APIRequestContext,
  nodes: unknown[],
  status: "draft" | "published"
): Promise<{ id: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `shortcuts-${stamp}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Shortcuts ${stamp}`,
      slug,
      status,
      content: { formatVersion: 1, kind: "page", nodes },
    },
  });
  if (!created.ok()) throw new Error(`creating a page: ${created.status()}`);
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return { id, slug };
}

/** A Section with a background, and what it holds. */
function section(
  id: string,
  background: Record<string, unknown> | undefined,
  children: unknown[]
) {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { as: "section" },
    styles: {
      base: {
        base: {
          padding: PAD,
          ...(background === undefined ? {} : { background }),
        },
      },
    },
    slots: { children },
  };
}

/** The alpha of the first layer an element's background paints. */
async function firstLayerAlpha(page: Page, selector: string): Promise<number> {
  const image = await page
    .locator(selector)
    .first()
    .evaluate(element => getComputedStyle(element).backgroundImage);
  // The first colour of the first layer, in any of the forms a browser
  // serializes it: `rgba(r, g, b, a)`, `rgb(r g b / a)`, `color(srgb r g b / a)`.
  const first = /(rgba?|color)\(([^()]*)\)/.exec(image);
  if (first === null) throw new Error(`no colour in ${image}`);
  const inner = first[2] ?? "";
  const slash = inner.split("/");
  if (slash.length === 2) return Number.parseFloat(slash[1] ?? "");
  const parts = inner.split(",");
  return parts.length === 4 ? Number.parseFloat(parts[3] ?? "") : 1;
}

/** Open a node's Style tab and the named section of it. */
async function openStyle(
  page: Page,
  id: string,
  node: string,
  sectionName: string
): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await canvasFrame(page)
    .locator(`.nx-canvas [data-nx-node="${node}"]`)
    .first()
    .click({ position: { x: 6, y: 6 } });
  await expect(page.locator("[data-block-card]")).toBeVisible();
  await page.getByRole("tab", { name: "Style" }).click();
  const heading = page.getByRole("button", {
    name: new RegExp(`^${sectionName}`),
  });
  if ((await heading.getAttribute("aria-expanded")) !== "true") {
    await heading.click();
  }
}

test.describe("a Section's overlay and Height, a Button's Size", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an overlay covers its own image on the published page, and no nested one", async ({
    page,
  }) => {
    const { slug } = await createPage(
      page.request,
      [
        section(
          OUTER,
          { url: "/outer.png", overlay: "#000000", overlayStrength: 60 },
          [section(INNER, { url: "/inner.png" }, [])]
        ),
      ],
      "published"
    );
    await page.goto(`/${slug}`);
    const outer = ".nx-pb-page > section";
    const inner = ".nx-pb-page section section";
    await expect(page.locator(inner)).toHaveCount(1);
    expect(await firstLayerAlpha(page, outer)).toBeCloseTo(0.6, 2);
    // The nested Section's own image alone: no layer in front of it, the
    // parent's overlay stopped at the parent.
    const innerImage = await page
      .locator(inner)
      .evaluate(element => getComputedStyle(element).backgroundImage);
    expect(innerImage).toContain("inner.png");
    expect(innerImage).not.toContain("gradient");
  });

  test("Full screen stores 100svh and draws the Section at the frame.s height", async ({
    page,
  }) => {
    const { id } = await createPage(
      page.request,
      [section(OUTER, undefined, [])],
      "draft"
    );
    await openStyle(page, id, OUTER, "Size");
    await page.getByRole("radio", { name: "Full screen" }).click();
    const drawn = canvasFrame(page).locator(
      `.nx-canvas [data-nx-node="${OUTER}"]`
    );
    await expect
      .poll(async () =>
        drawn.evaluate(element => {
          // Layout pixels, which the canvas's scale leaves alone: the Section
          // is laid out at least as tall as the frame it is drawn in.
          const frame = element.ownerDocument.defaultView;
          return (
            (frame?.innerHeight ?? 0) - (element as HTMLElement).offsetHeight
          );
        })
      )
      .toBeLessThanOrEqual(2);
    await pressSave(page);
    await expect
      .poll(async () => {
        const nodes = await storedPageNodes(page.request, ENTRIES, id);
        return JSON.stringify(nodes.find(node => node.id === OUTER)?.styles);
      })
      .toContain('"minHeight":"100svh"');
  });

  test("Small scales the button's own padding, drawn smaller than Medium", async ({
    page,
  }) => {
    const { id } = await createPage(
      page.request,
      [
        section(OUTER, undefined, [
          {
            id: BUTTON,
            type: "core/button",
            version: 1,
            props: { label: "Get started", href: "/start" },
          },
        ]),
      ],
      "draft"
    );
    await openStyle(page, id, BUTTON, "Size");
    const drawn = canvasFrame(page).locator(
      `.nx-canvas [data-nx-node="${BUTTON}"]`
    );
    const paddingTop = () =>
      drawn.evaluate(element =>
        Number.parseFloat(getComputedStyle(element).paddingTop)
      );
    const medium = await paddingTop();
    expect(medium).toBeGreaterThan(0);
    await page.getByRole("radio", { name: "Small" }).click();
    await expect.poll(paddingTop).toBeCloseTo(medium * 0.75, 1);
    // Full width spans the button's container, its label centred in it as a
    // `<button>`'s would be, though this one is a link.
    await page.getByRole("switch", { name: "Full width" }).click();
    await expect
      .poll(async () =>
        drawn.evaluate(element => {
          const parent = element.parentElement;
          if (parent === null) return "no container";
          const inner =
            parent.clientWidth -
            Number.parseFloat(getComputedStyle(parent).paddingLeft) -
            Number.parseFloat(getComputedStyle(parent).paddingRight);
          // Narrowed by what it has, not by `instanceof`: the element is the
          // canvas frame's, whose HTMLElement is not this window's.
          if (!("offsetWidth" in element)) return "not laid out";
          // Both in layout pixels, which the canvas's zoom scales alike.
          const wide = Math.abs(element.offsetWidth - inner) <= 2;
          return `${String(wide)} ${getComputedStyle(element).textAlign}`;
        })
      )
      .toBe("true center");
    await pressSave(page);
    await expect
      .poll(async () => {
        const nodes = await storedPageNodes(page.request, ENTRIES, id);
        const outer = nodes.find(node => node.id === OUTER) as
          | { slots?: { children?: { id: string; styles?: unknown }[] } }
          | undefined;
        return JSON.stringify(
          outer?.slots?.children?.find(node => node.id === BUTTON)?.styles
        );
      })
      .toContain('{"$token":"button.padding-y","times":0.75}');
  });

  test("the overlay is offered once the Section has an image", async ({
    page,
  }) => {
    const { id } = await createPage(
      page.request,
      [section(OUTER, undefined, [])],
      "draft"
    );
    await openStyle(page, id, OUTER, "Background");
    // Not drawn at all, hidden or not.
    await expect(
      page.locator("label", { hasText: "Overlay strength" })
    ).toHaveCount(0);
    const { id: withImage } = await createPage(
      page.request,
      [section(OUTER, { url: "/outer.png" }, [])],
      "draft"
    );
    await openStyle(page, withImage, OUTER, "Background");
    await expect(page.getByText("Overlay strength")).toBeVisible();
  });
});
