/**
 * The Email hub against a real server: entered from the main navigation, each
 * tab visited, every URL email had under Settings landing in its place in the
 * hub, a new email started from the dialog, a form's notification linking to
 * its email, and every tab usable at phone, tablet and desktop widths without
 * the page scrolling sideways.
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.email] });

const TABS = [
  {
    name: "Messages",
    path: "/email",
    // A fresh install's emails, under their owner.
    // Visible only: below tablet width the table is hidden and the cards
    // carry the same names.
    loaded: (page: Page) =>
      page.getByText("Welcome").filter({ visible: true }).first(),
  },
  {
    name: "Design",
    path: "/email/design",
    loaded: (page: Page) => page.getByRole("heading", { name: "Layouts" }),
  },
  {
    name: "Sending",
    path: "/email/sending",
    loaded: (page: Page) =>
      page.getByRole("searchbox").or(page.getByRole("textbox")).first(),
  },
] as const;

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

/** Whether the page scrolls sideways, which no width may make it do. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

const hubHeading = (page: Page) =>
  page.getByRole("heading", { name: "Email", exact: true, level: 1 });

test("enters the hub from the main navigation and visits each tab", async ({
  page,
}) => {
  await gotoAdmin(page, "");
  const rail = page.getByRole("navigation").first();
  await rail.locator('a[href="/admin/email"]').click();

  await expect(page).toHaveURL(/\/admin\/email$/);
  await expect(hubHeading(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Messages" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  // The emails a fresh install sends, under their owner.
  await expect(page.getByRole("link", { name: "Welcome" }).first()).toBeVisible(
    { timeout: 30_000 }
  );

  for (const tab of TABS.slice(1)) {
    await page.getByRole("tab", { name: tab.name }).click();
    await expect(page).toHaveURL(new RegExp(`/admin${tab.path}$`));
    await expect(page.getByRole("tab", { name: tab.name })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  }
});

test.describe("the email URLs under Settings", () => {
  const ID = "3f6c1d2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f";
  const MOVED = [
    ["/settings/email-templates", "/email"],
    ["/settings/email-templates/create", "/email/messages/create"],
    [`/settings/email-templates/edit/${ID}`, `/email/messages/edit/${ID}`],
    ["/settings/email-providers", "/email/sending"],
    ["/settings/email-providers/create", "/email/sending/create"],
    [`/settings/email-providers/edit/${ID}`, `/email/sending/edit/${ID}`],
  ] as const;

  for (const [old, now] of MOVED) {
    test(`${old} lands on ${now}`, async ({ page }) => {
      await gotoAdmin(page, old);
      await expect(page).toHaveURL(new RegExp(`/admin${now}$`), {
        timeout: 30_000,
      });
    });
  }

  test("keeps a link's query, so a duplicate still opens a copy", async ({
    page,
  }) => {
    await gotoAdmin(page, `/settings/email-templates/create?duplicate=${ID}`);
    await expect(page).toHaveURL(
      new RegExp(`/admin/email/messages/create\\?duplicate=${ID}$`),
      { timeout: 30_000 }
    );
  });
});

test("starts a new email from the dialog, named", async ({ page }) => {
  await gotoAdmin(page, "/email");
  await page.getByRole("button", { name: "New email" }).click();
  const dialog = page.getByRole("dialog", { name: "New email" });
  await dialog.getByLabel("Name").fill("Back-in-stock alert");
  await dialog.getByRole("button", { name: "Create email" }).click();

  await expect(page).toHaveURL(/\/admin\/email\/messages\/create\?name=/, {
    timeout: 30_000,
  });
  await expect(page.locator('input[name="name"]')).toHaveValue(
    "Back-in-stock alert",
    { timeout: 30_000 }
  );
});

test("links a form's notification to its email in the hub", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/forms/create");
  await page.getByRole("textbox", { name: "Form Name" }).fill("E2E Email Link");
  await page.getByRole("tab", { name: "Notifications" }).click();
  await page.getByRole("button", { name: "Add notification" }).first().click();

  await page.getByRole("combobox", { name: "Email template" }).click();
  // The first template after "Select a template".
  await page.getByRole("option").nth(1).click();

  const link = page.getByRole("link", { name: /in Email/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/admin\/email\/messages\/edit\/[^/]+$/);

  // The link opens the email's editor.
  await page.goto(href as string);
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator('input[name="name"]')).not.toHaveValue("", {
    timeout: 30_000,
  });
});

for (const size of WIDTHS) {
  test(`every tab is usable at ${size.width} without scrolling sideways`, async ({
    page,
  }, testInfo) => {
    // Three tabs, each a page load on a dev server.
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const tab of TABS) {
      await gotoAdmin(page, tab.path);
      await expect(hubHeading(page)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("tab", { name: tab.name })).toBeVisible();
      // Let the tab's content arrive before judging the width. Not network
      // idle: a dev server's reload socket keeps the network busy forever.
      await expect(tab.loaded(page)).toBeVisible({ timeout: 30_000 });
      expect(await scrollsSideways(page), `${tab.name} at ${size.width}`).toBe(
        false
      );
      await testInfo.attach(`${tab.name.toLowerCase()}-${size.width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  });
}

test("shows each email as a card at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAdmin(page, "/email");
  await expect(page.getByRole("article").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("table", { name: "Emails" })).toBeHidden();
});
