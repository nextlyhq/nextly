/**
 * A fresh site's starter header and footer: the default set the boot seeded,
 * tagged as the starter on the canvas, and drawn around a published page at
 * a phone's width and a laptop's.
 *
 * The browser tests start on a fresh database, so the site default is the
 * boot's own seed. Specs that change the default hold the same lock and put
 * the previous default back, and none edits the starter.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/builder-starter-header-footer.spec
 */
import { expect, type Page } from "@playwright/test";

import { canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.siteDefaultLayout] });

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const TITLE = `Starter check ${STAMP}`;
const SLUG = `starter-check-${STAMP}`;

interface Choices {
  items: {
    id: string;
    title: string;
    regions: { area: string; componentId: string }[];
  }[];
  meta: {
    defaultLayout: string | null;
    regionComponents: Record<string, { untouchedStarter?: string }>;
  };
}

let pageId: string | undefined;

async function choices(page: Page): Promise<Choices> {
  const answer = await page.request.get(`${PLUGIN}/layouts/choices`);
  expect(answer.ok(), `choices: ${answer.status()}`).toBe(true);
  return (await answer.json()) as Choices;
}

/** A published page naming no set, so it is drawn inside the default. */
async function seedPage(page: Page): Promise<string> {
  if (pageId !== undefined) return pageId;
  await gotoAdmin(page, "/");
  const created = await page.request.post(`${API}/collections/pages/entries`, {
    data: {
      title: TITLE,
      slug: SLUG,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "body",
            type: "core/heading",
            version: 1,
            props: { text: "Page body", level: "h1" },
          },
        ],
      },
    },
  });
  expect(
    created.ok(),
    `page: ${created.status()} ${await created.text()}`
  ).toBe(true);
  pageId = ((await created.json()) as { item: { id: string } }).item.id;
  return pageId;
}

test("the site default on a fresh site is Main, holding the untouched starter", async ({
  page,
}) => {
  await seedPage(page);
  const { items, meta } = await choices(page);
  const main = items.find(item => item.id === meta.defaultLayout);
  expect(main?.title).toBe("Main");
  const byArea = Object.fromEntries(
    (main?.regions ?? []).map(r => [r.area, r.componentId])
  );
  expect(Object.keys(byArea).sort()).toEqual(["footer", "header"]);
  expect(meta.regionComponents[byArea.header ?? ""]?.untouchedStarter).toBe(
    "header"
  );
  expect(meta.regionComponents[byArea.footer ?? ""]?.untouchedStarter).toBe(
    "footer"
  );
});

test("tags the starter on the canvas, in the builder only", async ({
  page,
}) => {
  const id = await seedPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  const root = await canvasRoot(page);
  const header = root.locator('[data-nx-region="header"]');
  const footer = root.locator('[data-nx-region="footer"]');
  await expect(header).toContainText("Contact us", { timeout: 30_000 });
  await expect(footer).toContainText("Pages");
  // "©", the year and the name are three texts in a row, spaced by the row.
  await expect(footer).toContainText(
    new RegExp(`©\\s*${String(new Date().getFullYear())}`)
  );

  await expect(header).toHaveAccessibleName(
    "Starter header, from the Main header & footer"
  );
  await expect(footer).toHaveAccessibleName(
    "Starter footer, from the Main header & footer"
  );
  // The starter's tag, shown inside it while the pointer is on it.
  await header.hover();
  await expect(header.locator(".nx-canvas-region__tag")).toHaveText(
    "Starter header · edit or replace"
  );
  await expect(header.locator(".nx-canvas-region__tag")).toBeVisible();
  await footer.scrollIntoViewIfNeeded();
  await footer.hover();
  await expect(footer.locator(".nx-canvas-region__tag")).toHaveText(
    "Starter footer"
  );

  // The published page carries no builder tag.
  const published = await page.request.get(`/${SLUG}`);
  expect(published.ok()).toBe(true);
  const html = await published.text();
  expect(html).toContain("Contact us");
  expect(html).not.toContain("edit or replace");
});

for (const width of [375, 1280]) {
  test(`draws the starter around a published page at ${width}px, its links wrapping on a phone`, async ({
    page,
  }) => {
    await seedPage(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/${SLUG}`);
    const header = page.locator('header[data-nextly-region="header"]');
    await expect(
      header.getByRole("link", { name: "Contact us" })
    ).toHaveAttribute("href", "/contact");
    // The site's name, then its pages (the oldest five), then Contact us.
    const links = header.getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(3);
    // Nothing runs off the side of the screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const nameBox = await links.nth(0).boundingBox();
    const firstPage = links.nth(1);
    const pageBox = await firstPage.boundingBox();
    expect(nameBox !== null && pageBox !== null).toBe(true);
    // The rows the name and the links sit in wrap onto more lines.
    const wraps = await firstPage.evaluate(link => {
      const rows: string[] = [];
      for (let at = link.parentElement; at !== null; at = at.parentElement) {
        if (at.tagName === "HEADER") break;
        const style = getComputedStyle(at);
        if (style.display === "flex") rows.push(style.flexWrap);
      }
      return rows;
    });
    expect(wraps.length).toBeGreaterThan(0);
    expect(wraps.every(value => value === "wrap")).toBe(true);
    if (width === 1280 && nameBox !== null && pageBox !== null) {
      // On a laptop the links sit beside the name.
      expect(Math.abs(pageBox.y - nameBox.y)).toBeLessThan(nameBox.height);
    }
    await page.screenshot({
      path: test.info().outputPath(`starter-${width}-light.png`),
      fullPage: true,
    });
    // The site's dark values, where it follows the visitor's preference.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: test.info().outputPath(`starter-${width}-dark.png`),
      fullPage: true,
    });
  });
}
