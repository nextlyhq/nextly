/**
 * The admin serves its main screens against a real server and a real database.
 *
 * Deliberately shallow. Its job is the class of failure the other two test
 * layers cannot see at all: the app booting. A column the code selected but the
 * migration never created took every permissions query to a 500, and the
 * admin's retry made it look like an infinite page reload — while every unit
 * test stayed green, because the mock had the column.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const SCREENS = [
  { path: "", name: "Dashboard" },
  { path: "/users", name: "Users" },
  { path: "/users/fields", name: "User Fields" },
  { path: "/security/roles", name: "Roles" },
  { path: "/media", name: "Media" },
];

for (const screen of SCREENS) {
  test(`${screen.name} loads without a server error`, async ({ page }) => {
    const serverErrors: string[] = [];
    const crashes: string[] = [];

    page.on("response", response => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });
    // An uncaught exception, not a console error. Console errors are not a
    // signal here: dev mode reports its own HMR socket, and the dashboard
    // feature-detects seeding with a HEAD it expects to fail, so a failed
    // request is sometimes the answer rather than the problem. 5xx and a
    // thrown exception are unambiguous; "console said error" is not.
    page.on("pageerror", error => crashes.push(error.message));

    await gotoAdmin(page, screen.path);

    // Something rendered, rather than an error boundary's apology.
    await expect(page.locator("main")).toBeVisible();

    expect(serverErrors, "requests that 500'd").toEqual([]);
    expect(crashes, "uncaught exceptions").toEqual([]);
  });
}

test("the seeded roles are present and readable", async ({ page }) => {
  // Nextly seeds Admin, Editor, Author and Viewer as predicates re-resolved on
  // every boot. Asserting through the UI is what proves the boot resolved them
  // against this database, not that the constant lists four names.
  await gotoAdmin(page, "/security/roles");

  // By exact text inside the table body: the cell also carries a "System"
  // badge and a subtitle, so its accessible name is not the role's name.
  for (const role of ["Admin", "Editor", "Author", "Viewer"]) {
    await expect(
      page.locator("tbody").getByText(role, { exact: true }).first()
    ).toBeVisible();
  }
});
