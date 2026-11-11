/**
 * The main menu and the Settings panel after the moves, in a real browser:
 * Email lives under Settings › Site, the panel's groups read Site, People,
 * Developers in that order, user fields open from the Users page with the
 * trail Settings › Users › Fields, and Translations shows only on a site with
 * more than one language.
 *
 * What a unit test cannot see: the rail and panel as the shell actually draws
 * them from the server's answers, and the Translations gate reading the
 * locales the startup request delivers.
 */
import { expect, type Page, type Route } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const rail = (page: Page) => page.getByRole("navigation").first();
const subSidebar = (page: Page) => page.getByTestId("sub-sidebar");

/** The vertical order of texts in the Settings panel, as drawn. */
async function orderOf(page: Page, labels: string[]): Promise<string[]> {
  const tops = await Promise.all(
    labels.map(async label => {
      const box = await subSidebar(page)
        .getByText(label, { exact: true })
        .first()
        .boundingBox();
      return { label, top: box?.y ?? Number.NaN };
    })
  );
  return tops.sort((a, b) => a.top - b.top).map(each => each.label);
}

test("Settings: Site, People, Developers, with Email under Site and no Email in the rail", async ({
  page,
}) => {
  await gotoAdmin(page, "/settings");
  await expect(subSidebar(page)).toBeVisible({ timeout: 30_000 });
  for (const label of ["Site", "People", "Developers"]) {
    await expect(
      subSidebar(page).getByText(label, { exact: true })
    ).toBeVisible();
  }
  expect(await orderOf(page, ["Site", "People", "Developers"])).toEqual([
    "Site",
    "People",
    "Developers",
  ]);
  // Email is a Settings destination, before People; User Fields is not one.
  expect(await orderOf(page, ["General", "Email", "Users"])).toEqual([
    "General",
    "Email",
    "Users",
  ]);
  await expect(
    subSidebar(page).getByRole("link", { name: "User Fields" })
  ).toHaveCount(0);
  await expect(rail(page).getByRole("link", { name: "Email" })).toHaveCount(0);

  await subSidebar(page).getByRole("link", { name: "Email" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/email/);
});

test("user fields open from the Users page, under Settings › Users › Fields", async ({
  page,
}) => {
  await gotoAdmin(page, "/users");
  const fields = page.getByRole("link", { name: "Fields", exact: true });
  await expect(fields).toBeVisible({ timeout: 30_000 });
  await fields.click();
  await expect(page).toHaveURL(/\/admin\/users\/fields$/);
  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail).toContainText("Settings");
  await expect(trail).toContainText("Users");
  await expect(trail).toContainText("Fields");
  // The panel keeps Users highlighted here: the fields are reached from it.
  await expect(
    subSidebar(page).getByRole("link", { name: "Users" })
  ).toHaveAttribute("aria-current", "page");
});

test("Translations shows on the playground's three-language site", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  await expect(
    rail(page).getByRole("link", { name: "Translations" })
  ).toBeVisible({ timeout: 30_000 });
});

/** Cut every `locales` list in a JSON answer down to its first language. */
function oneLanguage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(oneLanguage);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, inner]) =>
        key === "locales" && Array.isArray(inner)
          ? [key, inner.slice(0, 1)]
          : [key, oneLanguage(inner)]
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function serveOneLanguage(route: Route): Promise<void> {
  const response = await route.fetch();
  try {
    const body = (await response.json()) as unknown;
    await route.fulfill({ response, json: oneLanguage(body) });
  } catch {
    await route.fulfill({ response });
  }
}

test("Translations hides on a site with one language", async ({ page }) => {
  // The locales arrive with the startup request and with admin-meta; both
  // are answered here as a one-language site would answer them.
  await page.route("**/admin/api/startup?**", serveOneLanguage);
  await page.route("**/admin/api/admin-meta**", serveOneLanguage);
  await gotoAdmin(page, "/");
  // The rail has settled once Media Library is drawn.
  await expect(
    rail(page).getByRole("link", { name: "Media Library" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    rail(page).getByRole("link", { name: "Translations" })
  ).toHaveCount(0);
});
