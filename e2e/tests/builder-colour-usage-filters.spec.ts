/**
 * The Colours tab's usage filter in the browser: "All" by default, and
 * "Used on this page" following the open page as a block's colour changes,
 * before any save.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { clickBlock, openEditorWith } from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const NODES = [
  {
    id: "filter-text",
    type: "core/text",
    version: 1,
    props: { text: "A page beside the colour filter" },
  },
];

async function openColours(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Design panel" });
  await page.getByRole("navigation", { name: "Editor panels" }).waitFor();
  if (!(await panel.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Design", exact: true })
      .click();
  }
  await panel.getByRole("tab", { name: /^Colours/ }).click();
  return panel;
}

/** The colour rows the Colours tab lists, by the name shown. */
function listed(panel: Locator): Promise<string[]> {
  return panel
    .locator('[data-group="colours"] .nx-vars__row .nx-vars__name')
    .allTextContents();
}

test("Used on this page lists a colour as soon as a block on the page takes it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openEditorWith(page, NODES, "filter-text");
  const panel = await openColours(page);
  const filter = panel.getByRole("radiogroup", { name: "Show colours" });
  await expect(filter.getByRole("radio", { name: "All" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  // The control: under All, Primary is listed, so its absence below is the
  // filter's doing and not an empty list.
  await expect.poll(() => listed(panel)).toContain("Primary");
  await filter.getByRole("radio", { name: "Used on this page" }).click();
  await expect.poll(() => listed(panel)).not.toContain("Primary");

  // The block takes Primary from its colour picker; nothing is saved yet.
  await clickBlock(page, "filter-text");
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const text = inspector.getByRole("button", {
    name: /^Text(\s?has changes)?$/,
  });
  if ((await text.getAttribute("aria-expanded")) !== "true") {
    await text.click();
  }
  await expect(text).toHaveAttribute("aria-expanded", "true");
  await inspector.getByRole("button", { name: /^Colour for Colou?r/ }).click();
  await page
    .getByRole("listbox", { name: "Colour variables" })
    .getByRole("option", { name: /Primary/ })
    .click();

  await openColours(page);
  await expect(
    filter.getByRole("radio", { name: "Used on this page" })
  ).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => listed(panel)).toEqual(["Primary"]);
});
