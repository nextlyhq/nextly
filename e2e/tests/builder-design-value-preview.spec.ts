/**
 * A Design size value typed slowly is drawn on the canvas as it is typed,
 * before the field is left, and stored on the site once, when it is: a
 * variable is read by every page, so a write per keystroke would publish
 * each half-typed value on the way.
 *
 * The canvas is read where every page reads a variable, its custom property
 * on the canvas's root; the writes are every request to the site style that
 * is not a read.
 *
 * @module tests/builder-design-value-preview.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";
import { countEveryPage } from "./support/usage-count";

// It writes the site's variables, and puts them back after.
test.describe.configure({ lock: [LOCK.siteStyle] });

const ENTRIES = "/admin/api/collections/pages/entries";
const SITE_STYLE = "/admin/api/singles/site-style";
const TEXT = "00000000-0000-4000-8000-00000000d301";

/** The site's variables as stored. */
async function storedTokens(page: Page): Promise<unknown> {
  const response = await page.request.get(SITE_STYLE);
  expect(response.ok(), `reading the site style: ${response.status()}`).toBe(
    true
  );
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.tokens ?? null;
}

/** One variable's light value, as stored. */
async function storedValue(page: Page, name: string): Promise<unknown> {
  const tokens = (await storedTokens(page)) as {
    tokens?: { name: string; values: { light: string } }[];
  } | null;
  return tokens?.tokens?.find(token => token.name === name)?.values.light;
}

/** Store `tokens` as the site's variables. */
async function seed(page: Page, tokens: unknown): Promise<void> {
  // Dropping a variable is refused until every page is counted.
  await countEveryPage(page.request);
  const written = await page.request.patch(SITE_STYLE, {
    data: { tokens, _overwrite: true },
  });
  expect(written.ok(), `writing the variables: ${written.status()}`).toBe(true);
}

/** A draft page with one text block, opened in the builder. */
async function openNewPage(page: Page): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Design preview ${stamp}`,
      slug: `design-preview-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: TEXT,
            type: "core/text",
            version: 1,
            props: { text: "A page beside the Design panel" },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, TEXT).first()).toBeVisible({
    timeout: 60_000,
  });
}

/** A variable's custom property as the canvas resolves it. */
function canvasValue(page: Page, property: string): Promise<string> {
  return canvasFrame(page)
    .locator("html")
    .evaluate(
      (root, name) => getComputedStyle(root).getPropertyValue(name).trim(),
      property
    );
}

/** Every write this page sends to the site style from now on. */
function watchSiteStyleWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === SITE_STYLE && request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
    }
  });
  return writes;
}

test("a Design size typed slowly is drawn on the canvas before the field is left, and stored once", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const before = await storedTokens(page);
  try {
    await seed(page, {
      tokens: [
        { name: "space.4", kind: "dimension", values: { light: "16px" } },
      ],
    });
    await openNewPage(page);
    await expect.poll(() => canvasValue(page, "--site-space-4")).toBe("16px");

    const panel = page.getByRole("region", { name: "Design panel" });
    if (!(await panel.isVisible())) {
      await page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Design", exact: true })
        .click();
    }
    await panel.getByRole("tab", { name: /^Spacing/ }).click();
    await panel.getByRole("button", { name: /^Space 4,/ }).click();
    const light = page
      .locator(".nx-vars-editor")
      .getByLabel("Light", { exact: true });
    await expect(light).toHaveValue("16");

    const writes = watchSiteStyleWrites(page);
    await light.click();
    await light.press("ControlOrMeta+A");
    // One key at a time, each a longer wait than a held write waits for the
    // author's pause: a value handed to the save as it was typed would be
    // stored part-way through.
    await light.press("2");
    await expect.poll(() => canvasValue(page, "--site-space-4")).toBe("2px");
    await page.waitForTimeout(1_200);
    await light.press("4");
    await expect.poll(() => canvasValue(page, "--site-space-4")).toBe("24px");
    await page.waitForTimeout(1_200);
    // Still in the field: drawn, and nothing stored.
    await expect(light).toBeFocused();
    expect(writes).toEqual([]);
    expect(await storedValue(page, "space.4")).toBe("16px");

    // Leaving the field stores it, once.
    await light.press("Tab");
    await expect.poll(() => storedValue(page, "space.4")).toBe("24px");
    // Long enough for a second write to have been made.
    await page.waitForTimeout(1_500);
    expect(writes).toHaveLength(1);
    expect(await canvasValue(page, "--site-space-4")).toBe("24px");
  } finally {
    await seed(page, before);
  }
});
