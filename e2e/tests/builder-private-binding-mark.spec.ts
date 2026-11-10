/**
 * The editor marks a bound value a visitor will not see.
 *
 * A page binds two headings to the `contact-details` Single: one to `phone`,
 * which the public may read, and one to `internalNote`, which it may not. The
 * published page shows the second one's fallback, so the editor says so: a
 * faint amber outline on that block alone, with a "Visitors won't see this"
 * badge on its edge, which a keyboard reaches and whose tooltip names the
 * field and the fallback, and the same words in the inspector under the
 * bound prop.
 *
 * @module tests/builder-private-binding-mark.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

const SPACER = "00000000-0000-4000-8000-0000001000c0";
const PUBLIC = "00000000-0000-4000-8000-0000001000c1";
const PRIVATE = "00000000-0000-4000-8000-0000001000c2";

const FALLBACK = "Ask us at the front desk";
const BADGE = "Visitors won't see this";

/** A draft page with a heading bound to each field of the Single. */
async function seed(api: APIRequestContext, mark: string): Promise<string> {
  const response = await api.post(PAGES, {
    data: {
      title: `${mark} contact`,
      slug: `private-binding-${mark.toLowerCase()}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          // Above the marked heading, so its badge has room on the screen to
          // sit on the outline's top edge rather than inside its corner.
          {
            id: SPACER,
            type: "core/heading",
            version: 1,
            props: { text: "Contact", level: "h1" },
          },
          {
            id: PUBLIC,
            type: "core/heading",
            version: 1,
            props: { text: "Phone", level: "h2" },
            bindings: {
              text: {
                $bind: "phone",
                source: "single",
                sourceKey: "contact-details",
              },
            },
          },
          {
            id: PRIVATE,
            type: "core/heading",
            version: 1,
            props: { text: "Note", level: "h2" },
            // Narrower than the page, so the badge's right edge is the
            // outline's rather than held in by the edge of the screen.
            styles: { base: { base: { width: "50%" } } },
            bindings: {
              text: {
                $bind: "internalNote",
                source: "single",
                sourceKey: "contact-details",
                fallback: FALLBACK,
              },
            },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("a bound value a visitor will not see", () => {
  test.describe.configure({ timeout: 240_000 });

  test("is marked on its block and in the inspector, and only there", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `P${Date.now().toString(36)}`;
    const id = await seed(page.request, mark);
    await openBuilder(page, id);

    // One badge: the heading bound to the field visitors may read is the
    // control, bound to the same Single the same way.
    const badge = page.getByRole("button", { name: BADGE });
    await expect(badge).toHaveCount(1, { timeout: 30_000 });

    // Over the private heading's corner, never over its own content.
    const root = await canvasRoot(page);
    const heading = await root
      .locator(`[data-nx-node="${PRIVATE}"]`)
      .boundingBox();
    const placed = await badge.boundingBox();
    if (heading === null || placed === null) {
      throw new Error("[e2e] The heading or its badge has no box.");
    }
    expect(placed.y + placed.height).toBeLessThanOrEqual(heading.y + 0.5);
    // The block itself is outlined, just outside its box, and the badge sits
    // on that outline's top-right edge: at rest, the mark is plainly this
    // block's and not the one above it.
    const outlines = page.locator(".nx-visitor-unreadable__outline");
    await expect(outlines).toHaveCount(1);
    const outline = await outlines.boundingBox();
    if (outline === null) throw new Error("[e2e] The outline has no box.");
    expect(outline.x).toBeLessThanOrEqual(heading.x);
    expect(outline.y).toBeLessThanOrEqual(heading.y);
    expect(outline.x + outline.width).toBeGreaterThanOrEqual(
      heading.x + heading.width
    );
    expect(outline.y + outline.height).toBeGreaterThanOrEqual(
      heading.y + heading.height
    );
    expect(
      Math.abs(placed.x + placed.width - (outline.x + outline.width))
    ).toBeLessThan(1);
    expect(Math.abs(placed.y + placed.height - outline.y)).toBeLessThan(2);

    // A keyboard reaches it, and its tooltip says why on focus, not only on
    // hover; Escape puts the tooltip away without moving focus.
    await badge.focus();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(
      `Visitors can't read “internalNote”. They see the fallback: “${FALLBACK}”.`
    );
    await expect(badge).toHaveAccessibleDescription(
      `Visitors can't read “internalNote”. They see the fallback: “${FALLBACK}”.`
    );
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(badge).toBeFocused();

    // Pressing it selects the block, and the inspector says it in words.
    await badge.click();
    await expect(
      page
        .getByRole("note")
        .filter({ hasText: "Visitors can't read “internalNote”." })
    ).toBeVisible();
  });
});
