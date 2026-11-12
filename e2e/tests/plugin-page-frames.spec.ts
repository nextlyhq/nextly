/**
 * A plugin's own page is drawn from the pieces core's pages are, in the real
 * admin shell.
 *
 * The style-fixture plugin contributes a page per page type, each drawn with
 * `PageFrame` and `PageHeader` from `@nextlyhq/plugin-sdk/admin`, and one page
 * that draws neither. Each is measured in the browser against the content
 * area (`<main>`'s box inside its scrollbar): a list and a workspace run full
 * width, the workspace with no padding; a form is a column of at most 56rem
 * under the page's left edge; an editor has no gutter, its panel against the
 * window's edge; the header's title reads as a core page's; and the page with
 * no frame is drawn inside the shell as a Workspace page.
 *
 * Wide enough that the content panel is past every gutter step, so the gutter
 * is one value on every page measured.
 *
 * @module tests/plugin-page-frames.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { waitForShellAnswers } from "./support/shell-geometry";
import { test } from "./support/test";

const VIEWPORT = { width: 1920, height: 1080 };

/** Where the fixture's pages live, below `/admin`. */
const PAGES = "/plugins/style-fixture";

/** The 56rem form measure, in CSS pixels at the admin's 16px root. */
const FORM_MEASURE = 56 * 16;

/** A box and the padding inside it, rounded so sub-pixels never read as a gap. */
interface Layout {
  left: number;
  right: number;
  top: number;
  width: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

/** The layout of the one element `locator` finds. */
async function layoutOf(locator: Locator): Promise<Layout> {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      padding: {
        top: Math.round(parseFloat(style.paddingTop)),
        right: Math.round(parseFloat(style.paddingRight)),
        bottom: Math.round(parseFloat(style.paddingBottom)),
        left: Math.round(parseFloat(style.paddingLeft)),
      },
    };
  });
}

/**
 * The content area a page is drawn in: `<main>`'s box without its border or
 * a scrollbar, so "full width" means to the edge a page can reach.
 */
async function contentArea(
  page: Page
): Promise<{ left: number; right: number; top: number }> {
  const area = await page
    .locator("#nextly-main-content:visible")
    .evaluate(element => {
      const rect = element.getBoundingClientRect();
      const left = rect.left + element.clientLeft;
      return {
        left: Math.round(left),
        right: Math.round(left + element.clientWidth),
        top: Math.round(rect.top + element.clientTop),
      };
    });
  // A column that never drew would measure zero everywhere, which every
  // comparison below would also agree with.
  expect(
    area.right - area.left,
    "the content area has no width"
  ).toBeGreaterThan(0);
  return area;
}

/** Opens one of the fixture's pages and waits for the shell to settle. */
async function openFramePage(page: Page, path: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await gotoAdmin(page, `${PAGES}/${path}`);
  await waitForShellAnswers(page);
}

/**
 * Every element that says it is a page's frame. One per page: a plugin page
 * that draws its own frame must not be framed again by the admin.
 */
const frames = (page: Page) => page.locator("[data-page-type]");

/** The page header's title, and how it is set. */
async function titleOf(page: Page, name: string) {
  const title = page.getByRole("heading", { level: 1, name });
  await expect(title).toBeVisible({ timeout: 30_000 });
  const area = await contentArea(page);
  const box = await layoutOf(title);
  const type = await title.evaluate(element => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, weight: style.fontWeight };
  });
  return { inset: box.left - area.left, ...type };
}

test("a list page runs full width within the gutter, titled as a core list page is", async ({
  page,
}) => {
  // The core page first: the API keys list, a List page with a page header.
  await page.setViewportSize(VIEWPORT);
  await gotoAdmin(page, "/settings/api-keys");
  await waitForShellAnswers(page);
  const core = await titleOf(page, "API Keys");

  await openFramePage(page, "frame-list");
  const plugin = await titleOf(page, "Fixture list page");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const area = await contentArea(page);
  const frame = await layoutOf(page.getByTestId("frame-list"));
  expect(frame.left, "the frame starts at the area's left edge").toBe(
    area.left
  );
  expect(frame.right, "the frame runs to the area's right edge").toBe(
    area.right
  );
  // Inset by the gutter on both sides, and by nothing else.
  expect(frame.padding.left).toBeGreaterThan(0);
  expect(frame.padding.right).toBe(frame.padding.left);
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page)).toHaveAttribute("data-page-type", "list");

  // Its title sits where a core list page's does, and is set the same way.
  expect(plugin).toEqual(core);
  expect(plugin.inset).toBe(frame.padding.left);
  // Below the bar by the page's vertical rhythm, as a core list page is.
  const title = await layoutOf(
    page.getByRole("heading", { level: 1, name: "Fixture list page" })
  );
  expect(title.top - area.top).toBeGreaterThan(0);
  // Its actions are drawn on the title's line.
  await expect(
    page.getByRole("button", { name: "Fixture action" })
  ).toBeVisible();
});

test("a form page is a column of at most 56rem under the page's left edge", async ({
  page,
}) => {
  await openFramePage(page, "frame-form");
  await expect(
    page.getByRole("heading", { level: 1, name: "Fixture form page" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page)).toHaveAttribute("data-page-type", "form");

  const area = await contentArea(page);
  const header = await layoutOf(
    page.getByTestId("frame-form").locator('[data-slot="page-header"]')
  );
  const content = await layoutOf(page.getByTestId("frame-form-content"));

  // The column: the header and the content share it.
  expect(content.left).toBe(header.left);
  expect(content.width).toBe(header.width);
  // At most the form measure, and filling it at this width rather than
  // shrinking to its content.
  expect(header.width).toBeLessThanOrEqual(FORM_MEASURE);
  expect(header.width).toBeGreaterThan(FORM_MEASURE - 2);
  // Left aligned: inset by the gutter at the left, with the surplus at the
  // right. A centred column would sit as far from one edge as the other.
  const leftGap = header.left - area.left;
  const rightGap = area.right - header.right;
  expect(leftGap).toBeGreaterThan(0);
  expect(leftGap).toBeLessThanOrEqual(32);
  expect(rightGap).toBeGreaterThan(leftGap + 300);
});

test("an editor page has no gutter: its panel meets the window's edge", async ({
  page,
}) => {
  await openFramePage(page, "frame-editor");
  await expect(
    page.getByRole("heading", { level: 1, name: "Fixture editor page" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page)).toHaveAttribute("data-page-type", "editor");

  const area = await contentArea(page);
  const frame = await layoutOf(page.getByTestId("frame-editor"));
  expect(frame.left).toBe(area.left);
  expect(frame.right).toBe(area.right);
  // No gutter and no vertical rhythm: the editor starts under the bar.
  expect(frame.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(frame.top).toBe(area.top);

  const panel = await layoutOf(page.getByTestId("frame-editor-panel"));
  expect(panel.right, "the panel meets the window's edge").toBe(VIEWPORT.width);
  expect(panel.right).toBe(area.right);
});

test("a workspace page runs full width with no padding", async ({ page }) => {
  await openFramePage(page, "frame-workspace");
  const title = page.getByRole("heading", {
    level: 1,
    name: "Fixture workspace page",
  });
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page)).toHaveAttribute("data-page-type", "workspace");

  const area = await contentArea(page);
  const frame = await layoutOf(page.getByTestId("frame-workspace"));
  expect(frame.left).toBe(area.left);
  expect(frame.right).toBe(area.right);
  expect(frame.top).toBe(area.top);
  expect(frame.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  // Nothing around it adds any either: its title starts at the area's corner.
  const box = await layoutOf(title);
  expect(box.left).toBe(area.left);
});

test("a page with no frame is drawn inside the shell as a Workspace page", async ({
  page,
}) => {
  await openFramePage(page, "frame-none");
  const content = page.getByTestId("frame-none-content");
  await expect(content).toBeVisible({ timeout: 30_000 });

  // Inside the shell: the admin's bar and its rail are drawn around it.
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("rail-account")).toBeVisible();
  const main = page.locator("#nextly-main-content:visible");
  expect(
    await main.evaluate(
      (element, testId) =>
        element.contains(document.querySelector(`[data-testid="${testId}"]`)),
      "frame-none-content"
    )
  ).toBe(true);

  // The admin framed it, once, as a Workspace page.
  await expect(frames(page)).toHaveCount(1);
  const frame = page.locator("[data-plugin-page]");
  await expect(frame).toHaveAttribute("data-page-type", "workspace");

  const area = await contentArea(page);
  const box = await layoutOf(frame);
  expect(box.left).toBe(area.left);
  expect(box.right).toBe(area.right);
  expect(box.top).toBe(area.top);
  expect(box.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  // So the page's own content starts at the area's corner.
  const inner = await layoutOf(content);
  expect(inner.left).toBe(area.left);
  expect(inner.top).toBe(area.top);
});
