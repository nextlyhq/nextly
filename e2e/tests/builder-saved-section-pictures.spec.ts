/**
 * The Add panel's Saved sections tab, in the real editor: each saved section
 * shows a small picture of itself, drawn by the canvas's renderer, and the
 * pictures follow the canvas's light or dark preview.
 *
 * What each step asserts, and the broken version it rules out:
 *
 * - Each seeded section's tile holds a drawn picture whose text is the
 *   section's own heading. A tile that kept the plain mark, or a picture of
 *   the wrong section, fails here; so does a host that never handed the
 *   panel its pictures.
 * - The tab the panel opens on (Blocks) holds no picture at all, so opening
 *   the panel never waits on them.
 * - Before the top bar's preview is pressed, the drawn page carries the
 *   site's light theme marker on a light ground, as the canvas starts light.
 *   Once it previews dark the same pictures carry the dark marker and a dark
 *   ground, and light ones again after. A picture drawn in the admin's own
 *   scheme, or one that ignored the preview, fails one side or the other.
 * - A saved section placing a component that no longer exists shows the
 *   section's plain icon instead of a broken picture, and is still offered.
 *
 * Each run seeds its own page and sections, named uniquely, so no lock is
 * needed, and deletes the sections after, so no later spec's Saved sections
 * tab lists them.
 *
 * @module tests/builder-saved-section-pictures
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const PATTERNS = "/admin/api/collections/patterns/entries";

/*
 * The site's theme marker, spelled out rather than imported: this suite
 * imports no product code, and the marker is published contract, so a rename
 * on the engine side must fail here.
 */
const THEME_MARKER = "data-nx-theme";

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

async function created(
  page: Page,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await page.request.post(url, { data });
  expect(answer.ok(), `seeding ${url}: ${answer.status()}`).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

/** A published saved section holding the given blocks, and its id. */
async function seedSection(
  page: Page,
  title: string,
  slug: string,
  nodes: unknown[]
): Promise<string> {
  return await created(page, PATTERNS, {
    title,
    slug,
    granularity: "section",
    status: "published",
    content: { formatVersion: 1, kind: "pattern", nodes },
  });
}

async function openBuilder(page: Page, pageId: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

function railButton(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name, exact: true });
}

/** Open the Add panel from the rail, unless it is open already. */
async function openAdd(page: Page): Promise<void> {
  const add = railButton(page, "Add");
  if ((await add.getAttribute("aria-pressed")) !== "true") await add.click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
}

function tile(page: Page, title: string): Locator {
  return page.getByRole("option", { name: title, exact: true });
}

/** The drawn page in a tile's picture. */
function drawnPage(page: Page, title: string): Locator {
  return tile(page, title).locator(
    '.nx-picture[data-drawn="true"] .nx-picture__page'
  );
}

/** Preview the canvas in a mode on the top bar's switch. */
async function pickPreview(page: Page, mode: "Light" | "Dark"): Promise<void> {
  const darkPreview = page.getByRole("button", {
    name: "Preview in dark mode",
  });
  if (
    (await darkPreview.getAttribute("aria-pressed")) !== String(mode === "Dark")
  ) {
    await darkPreview.click();
  }
  await expect(darkPreview).toHaveAttribute(
    "aria-pressed",
    String(mode === "Dark")
  );
}

/**
 * Each drawn picture in the Saved sections tab carries the mode's marker and
 * its scheme, on a ground of the mode's lightness.
 */
async function expectPicturesIn(
  page: Page,
  titles: readonly string[],
  mode: "light" | "dark"
): Promise<void> {
  await openAdd(page);
  await page.getByRole("tab", { name: "Saved sections" }).click();
  for (const title of titles) {
    await tile(page, title).scrollIntoViewIfNeeded();
    const drawn = drawnPage(page, title);
    await expect(drawn, title).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await pictureLook(drawn)).marker).toBe(mode);
    const look = await pictureLook(drawn);
    expect(look.scheme, title).toBe(mode);
    if (mode === "dark") {
      expect(look.lightness, `${title} ground`).toBeLessThan(0.2);
    } else {
      expect(look.lightness, `${title} ground`).toBeGreaterThan(0.8);
    }
  }
}

/** The drawn page's scheme, theme marker and ground lightness (0 to 1). */
async function pictureLook(target: Locator) {
  return await target.evaluate((element, marker) => {
    const style = getComputedStyle(element);
    const channels = (style.backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    const [r = 0, g = 0, b = 0] = channels;
    return {
      scheme: style.colorScheme,
      marker: element.getAttribute(marker),
      lightness: (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255,
    };
  }, THEME_MARKER);
}

test.describe("saved section pictures in the Add panel", () => {
  test.describe.configure({ timeout: 180_000 });

  test("each saved section shows its own picture, which follows the dark preview", async ({
    page,
  }) => {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const hero = `Hero ${tag}`;
    const pricing = `Pricing ${tag}`;
    const orphan = `Orphan ${tag}`;
    const seeded: string[] = [];
    try {
      seeded.push(
        await seedSection(page, hero, `hero-${tag}`, [
          heading("hero-heading", `Hero heading ${tag}`),
        ])
      );
      seeded.push(
        await seedSection(page, pricing, `pricing-${tag}`, [
          heading("pricing-heading", `Pricing heading ${tag}`),
        ])
      );
      // A section placing a component that was never stored: it can't be
      // drawn, so its tile shows the plain icon.
      seeded.push(
        await seedSection(page, orphan, `orphan-${tag}`, [
          {
            id: "orphan-instance",
            type: "nextly/component-instance",
            version: 1,
            props: { componentId: "00000000-0000-4000-8000-0000000dead0" },
          },
        ])
      );
      const pageId = await created(page, PAGES, {
        title: `Pictures ${tag}`,
        slug: `pictures-${tag}`,
        status: "draft",
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("lead", `Lead ${tag}`)],
        },
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: "light" });
      await openBuilder(page, pageId);
      await openAdd(page);

      // The Blocks tab the panel opens on draws no picture.
      await expect(page.getByRole("tab", { name: "Blocks" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      await expect(page.locator(".nx-insert-panel .nx-picture")).toHaveCount(0);

      await page.getByRole("tab", { name: "Saved sections" }).click();
      for (const [title, text] of [
        [hero, `Hero heading ${tag}`],
        [pricing, `Pricing heading ${tag}`],
      ] as const) {
        await tile(page, title).scrollIntoViewIfNeeded();
        const drawn = drawnPage(page, title);
        await expect(drawn, title).toBeVisible({ timeout: 30_000 });
        await expect(drawn).toContainText(text);
        // The picture stands in for the tier's mark.
        await expect(tile(page, title).locator(".nx-block-icon")).toHaveCount(
          0
        );
        // Its text starts from a plain page's, as on the canvas, not from the
        // tile's centred label.
        expect(
          await drawn
            .locator("h2")
            .first()
            .evaluate(element => getComputedStyle(element).textAlign)
        ).toBe("start");
        const look = await pictureLook(drawn);
        expect(look.marker, title).toBe("light");
        expect(look.lightness, `${title} ground`).toBeGreaterThan(0.8);
      }

      // The one that can't be drawn: still offered, with its plain icon.
      await tile(page, orphan).scrollIntoViewIfNeeded();
      await expect(
        tile(page, orphan).locator(
          '.nx-picture[data-state="failed"] .nx-block-icon'
        )
      ).toBeVisible({ timeout: 30_000 });
      await expect(tile(page, orphan).locator(".nx-picture__page")).toHaveCount(
        0
      );

      // Dark, picked in the top bar, on a light device; then Light.
      await pickPreview(page, "Dark");
      await expectPicturesIn(page, [hero, pricing], "dark");
      await pickPreview(page, "Light");
      await expectPicturesIn(page, [hero, pricing], "light");
    } finally {
      for (const id of seeded) {
        await page.request.delete(`${PATTERNS}/${id}`);
      }
    }
  });
});
