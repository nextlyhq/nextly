/**
 * The form editor in the admin's frame, against a real server: each page of a
 * form has its own address, which a reload keeps; the editor is one page with
 * one banner and one heading, its controls in the admin's bar; the Forms panel
 * starts folded; an edit survives a trip between pages and is saved once; and
 * leaving with unsaved changes asks first.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { waitForShellAnswers } from "./support/shell-geometry";

/** The form editor's pages, by tab label, and the address segment of each. */
const PAGES: [string, string][] = [
  ["Builder", ""],
  ["Preview", "/preview"],
  ["Settings", "/settings"],
  ["Notifications", "/notifications"],
  ["Submissions", "/submissions"],
];

const formPages = (page: Page) =>
  page.getByRole("navigation", { name: "Form pages" });

const tab = (page: Page, label: string) =>
  formPages(page).getByRole("link", { name: new RegExp(`^${label}`) });

const bar = (page: Page) => page.locator('[data-slot="form-editor-bar"]');

/** The form editor's save state, as the bar says it. */
const saveState = (page: Page) => bar(page).getByRole("status");

/** Adds a field through the picker: its type, found by search, and a label. */
async function addField(page: Page, search: string, label: string) {
  await page.getByRole("button", { name: "Add field" }).first().click();
  const picker = page.getByRole("dialog");
  const search_ = picker.getByRole("combobox", { name: "Search field types" });
  await search_.fill(search);
  await search_.press("Enter");
  await picker.getByRole("textbox", { name: "Label" }).fill(label);
  await picker.getByRole("button", { name: "Add field" }).click();
  await expect(picker).toHaveCount(0);
}

/**
 * A saved form with one field, opened at its edit address; answers that
 * address, below `/admin`.
 */
async function savedForm(page: Page, name: string): Promise<string> {
  await gotoAdmin(page, "/collections/forms/create");
  await tab(page, "Settings").click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await tab(page, "Builder").click();
  await addField(page, "email", "Email");
  await bar(page).getByRole("button", { name: "Save", exact: true }).click();
  // A new form carries on at its own address. Dev cold-compiles routes.
  await expect(page).toHaveURL(/\/collections\/forms\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  await expect(saveState(page)).toHaveText("All changes saved");
  return new URL(page.url()).pathname.replace(/^\/admin/, "");
}

/**
 * The seeded "Meetup sign-up" form (the playground's sample forms are seeded
 * on every run), opened from the forms list; answers its address below
 * `/admin`. For the cases that only look: creating a form for each costs
 * the server's request budget, which the run would otherwise spend.
 */
async function seededForm(page: Page): Promise<string> {
  await gotoAdmin(page, "/collections/forms");
  await page
    .getByRole("button", { name: /Meetup sign-up/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/collections\/forms\/(?!create$)[^/]+$/, {
    timeout: 30_000,
  });
  return new URL(page.url()).pathname.replace(/^\/admin/, "");
}

test("opens each page of a form at its own address, directly and on reload", async ({
  page,
}) => {
  const form = await seededForm(page);

  for (const [label, segment] of PAGES) {
    await gotoAdmin(page, `${form}${segment}`);
    await expect(tab(page, label)).toHaveAttribute("aria-current", "page", {
      timeout: 30_000,
    });
    await page.reload();
    await expect(tab(page, label)).toHaveAttribute("aria-current", "page", {
      timeout: 30_000,
    });
    // One page current at a time.
    await expect(formPages(page).locator('[aria-current="page"]')).toHaveCount(
      1
    );
  }
});

test("is an Editor page at 1920px: one banner, one heading, edge to edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const form = await seededForm(page);
  await gotoAdmin(page, form);
  await waitForShellAnswers(page);

  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Meetup sign-up" })
  ).toBeVisible();
  // The controls are in that one banner, not in a bar of the page's own.
  await expect(
    page.getByRole("banner").locator('[data-slot="form-editor-bar"]')
  ).toBeVisible();
  // An Editor page: its frame runs to the window's right edge, where the
  // field settings dock.
  const frame = page.locator('[data-page-type="editor"]');
  await expect(frame).toHaveCount(1);
  const box = await frame.boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1920);
});

test("starts with the Forms panel folded, docks a field's settings at the edge, and the toggle brings the panel back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const form = await seededForm(page);
  // A fresh visit: the choice is remembered only once the reader makes one.
  await page.evaluate(() => window.localStorage.clear());
  await gotoAdmin(page, form);
  await waitForShellAnswers(page);

  const panel = page.getByTestId("sub-sidebar");
  await expect(panel).toBeHidden();

  // With the panel folded, a selected field's settings dock against the
  // window's right edge, as tall as the window, the outline keeping the rest.
  // Checked here rather than on a page of its own: every page load spends the
  // server's per-minute request budget, which the run would otherwise exhaust.
  await page
    .getByRole("list", { name: "Form fields" })
    .getByRole("button", { name: /^Email/ })
    .first()
    .click();
  const settings = page.getByRole("complementary", { name: "Field settings" });
  await expect(settings).toBeVisible();
  const box = await settings.boundingBox();
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1440);
  expect(box?.height ?? 0).toBeGreaterThan(700);
  const outline = await page
    .getByRole("list", { name: "Form fields" })
    .boundingBox();
  expect(outline?.width ?? 0).toBeGreaterThan(600);

  await page.getByRole("button", { name: "Show the panel" }).click();
  await expect(panel).toBeVisible();
});

test("keeps an edit on Builder through a trip to Settings, and saves it once", async ({
  page,
}) => {
  const form = await savedForm(page, "E2E Round Trip Form");
  await gotoAdmin(page, form);
  await addField(page, "number", "Guests");
  await expect(saveState(page)).toHaveText("1 unsaved change");

  await tab(page, "Settings").click();
  await expect(page).toHaveURL(new RegExp(`${form}/settings$`));
  await expect(saveState(page)).toHaveText("1 unsaved change");
  await tab(page, "Builder").click();
  await expect(page).toHaveURL(new RegExp(`${form}$`));
  await expect(
    page.getByRole("button", { name: /^Guests/ }).first()
  ).toBeVisible();

  // One save sends the form once.
  const saves: string[] = [];
  page.on("request", request => {
    if (request.method() === "PATCH" && request.url().includes("/entries/")) {
      saves.push(request.url());
    }
  });
  await bar(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(saveState(page)).toHaveText("All changes saved", {
    timeout: 30_000,
  });
  expect(saves).toHaveLength(1);

  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Guests/ }).first()
  ).toBeVisible({
    timeout: 30_000,
  });
});

test("asks before leaving a form with unsaved changes", async ({ page }) => {
  const form = await savedForm(page, "E2E Guarded Leave Form");
  await gotoAdmin(page, form);
  await addField(page, "text", "Company");

  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    // The breadcrumb names the collection by its label.
    .getByRole("link", { name: /^Forms?$/ })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${form}$`));
});

test("the bar and its status menu pass the accessibility check", async ({
  page,
}) => {
  const form = await seededForm(page);
  await gotoAdmin(page, form);
  await expectNoAxeViolations(page, {
    include: '[data-slot="form-editor-bar"]',
  });
  await expectNoAxeViolations(page, {
    include: '[data-slot="page-tabs"]',
  });

  await bar(page)
    .getByRole("button", { name: /^Status:/ })
    .click();
  await expect(
    page.getByRole("menuitemradio", { name: /^Live/ })
  ).toBeVisible();
  await expectNoAxeViolations(page, { include: '[role="menu"]' });
});
