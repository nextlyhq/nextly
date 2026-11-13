/**
 * Import in a browser, from the plugin as it ships: the playground registers
 * it for this suite's server (`NEXTLY_PLAYGROUND_PLUGINS=seo`, set by
 * `e2e/playwright.config.ts`).
 *
 * A WordPress export with Yoast's values is dropped on Import's file step,
 * read and summed up; its values are matched to the page of the same slug,
 * the dry run says what it will set, and the import sets it, which the
 * page's SEO tab then shows as typed for the page. A file that is not an
 * export gets one notice and goes nowhere.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

// The Overview and dashboard SEO specs count pages and problems.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const PAGES = "seo-pages";
const IMPORT = "/plugins/nextlyhq-plugin-seo/pages/import";

/** A suffix that keeps this run's pages apart from a retry's. */
const run = Date.now().toString(36);

/** A WordPress export of one page holding Yoast's title and description. */
function wordPressExport(slug: string): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Old blog</title>
    <item>
      <title><![CDATA[Imported ${run}]]></title>
      <link>https://old.example/seo/${slug}/</link>
      <wp:post_name><![CDATA[${slug}]]></wp:post_name>
      <wp:status><![CDATA[publish]]></wp:status>
      <wp:post_type><![CDATA[post]]></wp:post_type>
      <wp:postmeta><wp:meta_key><![CDATA[_yoast_wpseo_title]]></wp:meta_key><wp:meta_value><![CDATA[Imported title ${run}]]></wp:meta_value></wp:postmeta>
      <wp:postmeta><wp:meta_key><![CDATA[_yoast_wpseo_metadesc]]></wp:meta_key><wp:meta_value><![CDATA[Imported description ${run}.]]></wp:meta_value></wp:postmeta>
    </item>
  </channel>
</rss>`;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("a WordPress export is read, checked and imported in one step", async ({
  page,
}) => {
  const slug = `imported-${run}`;
  const id = await createEntry(page.request, PAGES, {
    title: `Imported ${run}`,
    slug,
  });

  await gotoAdmin(page, IMPORT);
  await expect(
    page.getByRole("heading", { name: "Import SEO values" })
  ).toBeVisible();
  await page.getByRole("radio", { name: /WordPress/ }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "old.WordPress.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(wordPressExport(slug)),
  });
  await expect(page.getByText("old.WordPress.xml")).toBeVisible();
  await expect(
    page.getByText(/1 post or page read\. 1 has Yoast or Rank Math values\./)
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Field in the file")).toBeVisible();
  await page.getByRole("button", { name: "Check the result" }).click();
  await expect(page.getByText(`Imported title ${run}`)).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ values?$/ }).click();
  await expect(page.getByText(/values? imported on 1 page/)).toBeVisible();

  // The page's SEO tab shows the imported title as typed for it.
  await gotoAdmin(page, `/collections/${PAGES}/${id}`);
  await page.getByRole("tab", { name: /^SEO\b/ }).click();
  await expect(page.getByLabel("Title on Google")).toHaveValue(
    `Imported title ${run}`
  );
});

test("a file that is not an export gets one notice and is not sent", async ({
  page,
}) => {
  await gotoAdmin(page, IMPORT);
  await page.getByRole("radio", { name: /WordPress/ }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("just some notes"),
  });
  await expect(
    page.getByText("This isn't a WordPress export file")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});
