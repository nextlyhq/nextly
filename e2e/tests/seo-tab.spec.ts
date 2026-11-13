/**
 * The SEO plugin's tab in a browser, from the plugin as it ships: the
 * playground registers it for this suite's server (`NEXTLY_PLAYGROUND_PLUGINS=
 * seo`), extending the `seo-pages` collection and the `seo-home` Single, which
 * no other spec edits.
 *
 * On an entry, a new entry and a Single: the tab is there, its preview shows
 * the page on Google and when shared from values not yet saved, the title and
 * description are shown first with the rest under a closed Advanced, an empty
 * field says what will be used and where it comes from, typing offers one way
 * back to automatic, problems are counted on the tab, and the `seo` group is
 * edited there alone: not among the page's content, and not in the side
 * panel. What the tab sets is saved with the page.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

// The dashboard SEO spec counts this collection's pages before and after it
// writes its own, so pages written here must not land in between.
test.describe.configure({ lock: [LOCK.dashboard], mode: "serial" });

const PAGES = "seo-pages";
const SETTINGS_API = "/admin/api/singles/seo-settings";
const TAB = "SEO";
/** The tab's id, as the address keeps it. */
const TAB_ID = "nextlyhq-plugin-seo.tab";

/** A suffix that keeps this run's pages apart from a retry's. */
const run = Date.now().toString(36);

const seoTab = (page: Page) =>
  page.getByRole("tab", { name: new RegExp(`^${TAB}\\b`) });
const contentTab = (page: Page) =>
  page.getByRole("tab", { name: "Content", exact: true });
const titleField = (page: Page) => page.getByLabel("Title on Google");
const descriptionField = (page: Page) =>
  page.getByLabel("Description on Google");
const searchTitle = (page: Page) => page.getByTestId("seo-search-title");
const sourceOf = (field: Locator) => field.locator("xpath=..");

/** The fields the plugin adds, by the labels they carry as plain fields. */
const SEO_FIELD_LABELS = [
  "Meta Title",
  "Meta Description",
  "Social Share Image",
  "Canonical URL",
  "Hide from search engines",
];

async function expectNoSeoFieldIn(region: Locator): Promise<void> {
  for (const label of SEO_FIELD_LABELS) {
    await expect(region.getByText(label, { exact: true })).toHaveCount(0);
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // No site name, so a page's automatic title is its own title alone. The
  // Settings and Overview specs save one, and either may run first.
  await ok(
    await page.request.patch(SETTINGS_API, {
      data: { siteName: "", _overwrite: true },
    })
  );
});

test("an entry's SEO tab shows the preview, what will be used and where it comes from", async ({
  page,
}) => {
  const id = await createEntry(page.request, PAGES, {
    title: `Surfer SEO vs Rext AI ${run}`,
    slug: `surfer-vs-rext-${run}`,
    excerpt: "Surfer grades drafts; Rext writes them with sources.",
  });
  await gotoAdmin(page, `/collections/${PAGES}/${id}`);

  // The page's own content holds no SEO field, and neither does the panel.
  await expect(seoTab(page)).toBeVisible();
  await expectNoSeoFieldIn(page.locator("main"));
  await expectNoSeoFieldIn(page.getByLabel("Document panel").first());

  await seoTab(page).click();
  // The panel's one read-only SEO line says whether the page is listed.
  await expect(page.getByTestId("seo-status")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`tab=${TAB_ID.replace(".", "\\.")}`));

  // At rest: the page on Google beside its shared card, then the title and
  // the description, and Advanced closed with every other setting inside it.
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByText("On Google")).toBeVisible();
  await expect(page.getByTestId("seo-share-card")).toBeVisible();
  await expect(titleField(page)).toBeVisible();
  await expect(descriptionField(page)).toBeVisible();
  const advanced = page.getByRole("button", { name: /^Advanced/ });
  await expect(advanced).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("switch", { name: "Hide this page from search" })
  ).toBeHidden();

  // Each empty field shows the value that will be used, and its level.
  await expect(titleField(page)).toHaveAttribute(
    "placeholder",
    `Surfer SEO vs Rext AI ${run}`
  );
  await expect(sourceOf(titleField(page))).toContainText(
    "Empty uses the SEO page's title"
  );
  await expect(sourceOf(descriptionField(page))).toContainText(
    "Empty uses the SEO page's excerpt"
  );
  await expect(searchTitle(page)).toHaveText(`Surfer SEO vs Rext AI ${run}`);
  await expect(preview).toContainText(`› seo › surfer-vs-rext-${run}`);

  // Typing updates the preview, and offers one way back.
  await titleField(page).fill("Which fits your workflow?");
  await expect(searchTitle(page)).toHaveText("Which fits your workflow?");
  await expect(sourceOf(titleField(page))).toContainText("Typed for this page");
  await page.getByRole("button", { name: "Go back to automatic" }).click();
  await expect(titleField(page)).toHaveValue("");
  await expect(searchTitle(page)).toHaveText(`Surfer SEO vs Rext AI ${run}`);

  // The shared card follows the same values.
  await expect(page.getByTestId("seo-share-title")).toHaveText(
    `Surfer SEO vs Rext AI ${run}`
  );

  // Advanced uses real switches, and the official address is automatic.
  await advanced.click();
  await expect(
    page.getByRole("switch", { name: "Hide this page from search" })
  ).toBeVisible();
  await expect(page.getByTestId("seo-official-address")).toContainText(
    `/seo/surfer-vs-rext-${run}`
  );
});

test("what the tab sets is saved with the page, and the content's own fields stay as typed", async ({
  page,
}) => {
  const id = await createEntry(page.request, PAGES, {
    title: `Saved page ${run}`,
    slug: `saved-page-${run}`,
  });
  await gotoAdmin(page, `/collections/${PAGES}/${id}?tab=${TAB_ID}`);
  await titleField(page).fill("A title typed in the tab");
  await page.getByRole("button", { name: /^Advanced/ }).click();
  await page
    .getByRole("switch", { name: "Hide this page from search" })
    .click();
  await expect(
    page.getByText("Hidden from search: Google won't list this page")
  ).toBeVisible();

  // The page's content, typed while the tab was open elsewhere, is kept too.
  await contentTab(page).click();
  await page.getByLabel("Excerpt").fill("An excerpt typed before saving.");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // A read by id answers the entry itself, without an envelope.
  const stored = async () => {
    const read = await page.request.get(
      `/admin/api/collections/${PAGES}/entries/${id}?depth=0`
    );
    return (await read.json()) as {
      excerpt?: string;
      seo?: Record<string, unknown> | null;
    };
  };
  await expect
    .poll(async () => (await stored()).seo?.metaTitle)
    .toBe("A title typed in the tab");
  const item = await stored();
  expect(item.excerpt).toBe("An excerpt typed before saving.");
  expect(item.seo).toMatchObject({ noindex: true });

  await page.reload();
  await seoTab(page).click();
  await expect(titleField(page)).toHaveValue("A title typed in the tab");
  await expect(sourceOf(titleField(page))).toContainText("Typed for this page");
});

test("a page's problems are counted on the tab", async ({ page }) => {
  const id = await createEntry(page.request, PAGES, {
    title: `A title that runs well past the sixty characters Google shows ${run}`,
    slug: `long-title-${run}`,
  });
  await gotoAdmin(page, `/collections/${PAGES}/${id}`);
  /** The count beside the tab's label, as its name says it; none is 0. */
  const countOf = async () => {
    const name = (await seoTab(page).getAttribute("aria-label")) ?? "";
    return Number(/\((\d+) things? to fix\)/.exec(name)?.[1] ?? 0);
  };
  // Too long a title, and no description from any level, besides what the
  // page's structured data lacks on this site.
  await expect(seoTab(page)).toHaveAccessibleName(
    /^SEO \(\d+ things to fix\)$/
  );
  const before = await countOf();
  expect(before).toBeGreaterThanOrEqual(2);

  await seoTab(page).click();
  // Each problem is said above the fields, and the side panel counts them.
  await expect(
    page.getByText("The title is longer than Google shows.")
  ).toBeVisible();
  await expect(page.getByTestId("seo-status")).toHaveText(`${before} to check`);
  await titleField(page).fill("Short");
  await descriptionField(page).fill("A description for the results page.");
  await expect.poll(countOf).toBe(before - 2);
});

test("a new entry has the SEO tab, previewing what is typed before it is saved", async ({
  page,
}) => {
  await gotoAdmin(page, `/collections/${PAGES}/create`);
  await expect(seoTab(page)).toBeVisible();
  await expectNoSeoFieldIn(page.locator("main"));

  await page.getByLabel("Title", { exact: true }).first().fill(`Fresh ${run}`);
  await seoTab(page).click();
  await expect(searchTitle(page)).toHaveText(`Fresh ${run}`);
  await expect(sourceOf(titleField(page))).toContainText(
    "Empty uses the SEO page's title"
  );
});

test("a Single the plugin extends has the same tab, and keeps SEO out of its content", async ({
  page,
}) => {
  await gotoAdmin(page, "/singles/seo-home");
  await expect(seoTab(page)).toBeVisible();
  await expectNoSeoFieldIn(page.locator("main"));

  await page.getByLabel("Summary").fill(`The home of this site ${run}.`);
  await seoTab(page).click();
  await expect(sourceOf(descriptionField(page))).toContainText(
    "Empty uses the SEO home's summary"
  );
  await expect(page.getByTestId("seo-search-description")).toHaveText(
    `The home of this site ${run}.`
  );
});
