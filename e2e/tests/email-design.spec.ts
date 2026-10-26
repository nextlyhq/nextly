/**
 * The Email hub's Design tab against a real server: a changed accent shows in
 * the live preview before it is saved, a layout opens in the same workbench as
 * an email, and the tab is usable at phone, tablet and desktop widths without
 * the page scrolling sideways.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const ACCENT = "#2f6b4f";

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

/** The rendered email, as the preview's frame holds it. */
async function previewHtml(page: Page): Promise<string> {
  return (
    (await page
      .locator('iframe[title="Email preview"]')
      .getAttribute("srcdoc")) ?? ""
  );
}

async function openDesign(page: Page) {
  await gotoAdmin(page, "/email/design");
  await expect(
    page.getByRole("heading", { name: "Brand settings", exact: true })
  ).toBeVisible({ timeout: 30_000 });
}

test("shows a changed accent in the live preview before it is saved", async ({
  page,
}) => {
  await openDesign(page);
  // The first render, from the saved settings.
  await expect
    .poll(() => previewHtml(page), { timeout: 30_000 })
    .toContain("<");
  expect((await previewHtml(page)).toLowerCase()).not.toContain(ACCENT);

  const accent = page.getByLabel("Accent colour", { exact: true });
  await accent.fill(ACCENT);

  await expect
    .poll(async () => (await previewHtml(page)).toLowerCase(), {
      timeout: 30_000,
    })
    .toContain(ACCENT);
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Unsaved changes" })
  ).toBeVisible();

  // Nothing was saved: Discard puts the saved accent back.
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(accent).not.toHaveValue(ACCENT);
  await expect(
    page.getByRole("region", { name: "Unsaved changes" })
  ).toHaveCount(0);
});

test("opens a layout in the workbench", async ({ page }) => {
  await openDesign(page);
  const layouts = page.getByRole("region", { name: "Layouts" }).or(
    page.locator("section", {
      has: page.getByRole("heading", { name: "Layouts" }),
    })
  );
  await expect(layouts.getByText("Built from brand settings")).toBeVisible({
    timeout: 30_000,
  });
  await layouts.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/admin\/email\/messages\/edit\/[^/]+$/);
});

for (const size of WIDTHS) {
  test(`is usable at ${size.name} width without scrolling sideways`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openDesign(page);
    await expect(page.getByRole("heading", { name: "Layouts" })).toBeVisible();
    await expect(
      page.getByLabel("Accent colour", { exact: true })
    ).toBeVisible();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      )
    ).toBe(false);

    await testInfo.attach(`design-${size.width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}
