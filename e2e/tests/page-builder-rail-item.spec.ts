/**
 * The Page Builder's own rail item, in a browser: it sits right after Forms,
 * it opens the Page Builder overview, its panel lists the four libraries with
 * their counts and the bindings report under its own headings, and the
 * Plugins panel no longer lists any of them.
 *
 * Reads only: nothing here is written, and no number is asserted exactly, so
 * another test adding a pattern meanwhile changes nothing it checks.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** The overview's address under the admin, as the rail item opens it. */
const OVERVIEW = "/plugins/nextlyhq-plugin-page-builder/overview";

const LIBRARIES = ["Patterns", "Components", "Layouts", "Templates"];

/** The rail's entries, each named by its label. */
function rail(page: Page): Locator {
  return page.locator("aside[data-shell-answers] nav");
}

/** The rail's entry labels, top to bottom. */
async function railLabels(page: Page): Promise<string[]> {
  return rail(page)
    .locator("a[aria-label], button[aria-label]")
    .evaluateAll(entries =>
      entries.map(entry => entry.getAttribute("aria-label") ?? "")
    );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("sits right after Forms, and opens the overview and its panel", async ({
  page,
}) => {
  await gotoAdmin(page, "");
  await expect
    .poll(async () => {
      const labels = await railLabels(page);
      const forms = labels.indexOf("Forms");
      return forms >= 0 && labels[forms + 1] === "Page Builder";
    })
    .toBe(true);
  await rail(page)
    .getByRole("link", { name: "Page Builder", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${OVERVIEW}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Page Builder" })
  ).toBeVisible();

  // The overview's libraries, each with its count.
  const library = page.getByRole("region", { name: "Library" });
  for (const kind of ["patterns", "components", "layouts", "templates"]) {
    await expect(
      library
        .getByTestId(`overview-library-${kind}`)
        .getByTestId("overview-library-count")
    ).toHaveText(/^\d+$/);
  }
  // A super-admin may create in each, so each offers New.
  await expect(library.getByRole("link", { name: /^New / })).toHaveCount(4);
  // The playground's Pages declare a Page Builder field.
  await expect(
    page
      .getByRole("region", { name: "Where it is used" })
      .getByRole("link", { name: "Pages", exact: true })
  ).toBeVisible();

  // The panel beside it: the libraries under Library, each with its number,
  // then Bindings to fix under Checks, with a badge only while any need it.
  const panel = page.getByTestId("sub-sidebar");
  const libraryGroup = panel.getByRole("group", { name: "Library" });
  for (const label of LIBRARIES) {
    await expect(
      libraryGroup.getByRole("link", { name: new RegExp(`^${label}, \\d+`) })
    ).toBeVisible();
  }
  await expect(
    panel
      .getByRole("group", { name: "Checks" })
      .getByRole("link", { name: /^Bindings to fix(: \d+.*)?$/ })
  ).toBeVisible();
});

test("leaves the Plugins panel without the Page Builder's items", async ({
  page,
}) => {
  await gotoAdmin(page, "/plugins");
  const panel = page.getByTestId("sub-sidebar");
  await expect(panel.getByText("Plugins", { exact: true })).toBeVisible();
  // The control: the panel lists something besides its heading.
  await expect(panel.getByRole("link").first()).toBeVisible();
  for (const label of [...LIBRARIES, "Bindings to fix"]) {
    await expect(
      panel.getByRole("link", { name: new RegExp(`^${label}\\b`) })
    ).toHaveCount(0);
  }
});
