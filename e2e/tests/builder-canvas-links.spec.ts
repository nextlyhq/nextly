/**
 * A link the page draws on the canvas selects its block and never takes the
 * editor anywhere.
 *
 * The canvas renders blocks as published, so a Button or a Heading with an
 * address is a real anchor, and the browser's default for a click on one is to
 * follow it: out of the editor, with the author's unsaved work at risk. These
 * drive the real browser default, which a unit test cannot: a click, a middle
 * click, and Enter on the focused link.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * blocks field.
 *
 * @module tests/builder-canvas-links
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { CANVAS_FRAME, canvasFrame } from "./support/canvas-frame";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.homepage] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const BUILDER_URL = /\/admin\/singles\/homepage\/builder\?field=layout$/;
/** The playground's canvas route, its `canvasPath`. */
const CANVAS_ROUTE = "/page-builder-canvas";

const NODES = [
  {
    id: "cta",
    type: "core/button",
    version: 1,
    props: { label: "Sign up", href: "/signup" },
  },
  {
    id: "title",
    type: "core/heading",
    version: 1,
    props: { text: "Read the guide", level: "h2", href: "/guide" },
  },
];

async function seed(page: Page): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: { layout: { formatVersion: 1, kind: "page", nodes: NODES } },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/** The anchor a block draws on the canvas. */
function linkOf(page: Page, id: string) {
  // In the canvas's frame, which is where the page is drawn and so where a
  // followed link would navigate.
  return canvasFrame(page)
    .locator(
      `.nx-canvas [data-nx-node="${id}"] a[href], .nx-canvas a[data-nx-node="${id}"][href]`
    )
    .first();
}

async function openBuilder(page: Page): Promise<void> {
  await seed(page);
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(page).toHaveURL(BUILDER_URL);
  await expect(linkOf(page, "cta")).toBeVisible({ timeout: 30_000 });
}

/** The editor is still open, on the same address, with `id` selected. */
async function stayedOn(page: Page, id: string): Promise<void> {
  await expect(canvasFrame(page).locator(".nx-canvas")).toHaveAttribute(
    "data-nx-selected-id",
    id
  );
  await expect(page).toHaveURL(BUILDER_URL);
  // Nor did the FRAME go anywhere: a link followed inside it navigates the
  // frame alone, leaving the editor's own address where it was. The frame
  // holds the site's canvas route, which the playground serves.
  const frame = await page.locator(CANVAS_FRAME).elementHandle();
  const at = (await frame?.contentFrame())?.url() ?? "";
  expect(new URL(at).pathname).toBe(CANVAS_ROUTE);
}

test.describe("a link drawn on the canvas", () => {
  test("clicking a linked button selects it and stays in the editor", async ({
    page,
  }) => {
    await openBuilder(page);
    await linkOf(page, "cta").click();
    await stayedOn(page, "cta");
  });

  test("clicking a linked heading selects it and stays in the editor", async ({
    page,
  }) => {
    await openBuilder(page);
    await linkOf(page, "title").click();
    await stayedOn(page, "title");
  });

  test("a middle click opens no tab, and Enter on the link goes nowhere", async ({
    page,
    context,
  }) => {
    await openBuilder(page);
    const before = context.pages().length;

    await linkOf(page, "cta").click({ button: "middle" });
    await linkOf(page, "cta").focus();
    await page.keyboard.press("Enter");

    // A new tab or a navigation would have happened by the time a fresh click
    // has been handled, so selecting the heading marks the end of both. The
    // selection is cleared first: the block toolbar floats over the block
    // above the selected one, which here is the heading, and would take the
    // click aimed at it.
    const root = canvasFrame(page).locator(".nx-canvas");
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(root).not.toHaveAttribute("data-nx-selected-id", /.+/, {
        timeout: 1_000,
      });
    }).toPass({ timeout: 10_000 });
    await linkOf(page, "title").click();
    await stayedOn(page, "title");
    expect(context.pages()).toHaveLength(before);
  });
});
