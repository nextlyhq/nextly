/**
 * The code-first blocks renderer, served by a real route to a real browser.
 *
 * Everything about `createBlocksPage` was previously checked against intent —
 * unit tests over the read pipeline, the SEO deriver and the resolvers, with a
 * mocked CMS on the other side. Nothing had drawn a page. This boots the
 * playground, writes a `@nextlyhq/blocks-engine` document through the ordinary
 * write path, asks for the URL, and reads what came back.
 *
 * Four properties, in the order they can fail:
 *
 * 1. The document renders at all — the blocks reach markup, not the
 *    unknown-block placeholder. The placeholder is asserted ABSENT because a
 *    resolver that finds nothing still produces a page, and a test looking only
 *    for "the route answered 200" passes against a page of placeholders.
 * 2. A condition-gated node does not ship. `blocks-react` fails closed, and
 *    this is the first time that has been observed in a browser rather than in
 *    a tree filter. The assertion is over the response BODY, not over what is
 *    visible: a node hidden by CSS is still served, and the whole point of the
 *    conditions tier is that the markup never leaves the server.
 * 3. The route's lifecycle scope holds — an unpublished entry 404s.
 * 4. The metadata the blocks declared reaches the document head, including a
 *    canonical carrying this route's mount point.
 *
 * Safe to write against: the suite owns its database and empties it before
 * every run.
 */
import { expect, test, type APIResponse } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

test.describe.configure({ mode: "serial" });

const ENTRIES = "/admin/api/collections/block-pages/entries";

const PUBLISHED_SLUG = "dogfood";
const DRAFT_SLUG = "dogfood-draft";

const PAGE_HEADING = "Rendered by blocks-react";
const BUTTON_LABEL = "Read the docs";

/**
 * The first paragraph's text, which is also the page description.
 *
 * One value rather than two because `core/text` contributes its text as the
 * description through `BlockDefinition.seo`. Asserting the same string in the
 * body and in the head is what shows the block DECLARED the metadata, rather
 * than something copying it off a field of the entry.
 */
const LEAD_PARAGRAPH = "A page assembled from core blocks.";

/**
 * Text that must never reach the client.
 *
 * Carried by a node whose `visibility.conditions` are set, which is the tier
 * that omits a node from server output entirely (as opposed to `devices`, which
 * hides a node that WAS served). Distinctive enough to be searched for in the
 * raw HTML without matching anything else on the page.
 */
const GATED_TEXT = "vip-only-marker-8f21";

/**
 * An authored colour on one node.
 *
 * Deliberately not a colour anything else would produce, so the assertion
 * cannot pass on an inherited or default value. Written in the form
 * `getComputedStyle` reports so the comparison needs no parsing.
 */
const STYLED_HEADING_COLOR = "rgb(17, 85, 204)";

/** A node id. Stable per fixture so a failure names the same node every run. */
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

/**
 * The fixture document.
 *
 * Written as the stored shape rather than built through a helper, because what
 * this test is for is the path from STORED JSON to markup. A builder would
 * assert that the builder and the renderer agree, which is a different and
 * weaker claim.
 */
const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: id("01"),
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      slots: {
        children: [
          {
            id: id("02"),
            type: "core/heading",
            version: 1,
            props: { text: PAGE_HEADING, level: "h1" },
            // An authored node style, so the page has something a compiled
            // stylesheet must carry. Documents in this collection store no
            // compiled artifact, so the rule only exists if the route supplied
            // a compile context — see the styles assertion below.
            styles: { base: { base: { color: STYLED_HEADING_COLOR } } },
          },
          {
            id: id("03"),
            type: "core/text",
            version: 1,
            props: { text: LEAD_PARAGRAPH },
          },
          {
            id: id("04"),
            type: "core/list",
            version: 1,
            props: {
              kind: "unordered",
              items: ["Schema in TypeScript", "Blocks in code"],
            },
          },
          { id: id("05"), type: "core/divider", version: 1, props: {} },
          {
            id: id("06"),
            type: "core/button",
            version: 1,
            props: { label: BUTTON_LABEL, href: "/blocks" },
          },
          {
            id: id("07"),
            type: "core/text",
            version: 1,
            props: { text: GATED_TEXT },
            visibility: {
              conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
            },
          },
        ],
      },
    },
  ],
};

/** Fail with the server's message rather than with a bare status code. */
async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
}

/**
 * Seeds the fixture rows, in a hook rather than in a test.
 *
 * As a test it was separately selectable, and every later test depended on it:
 * `--grep` or a click in the UI picked one of them, skipped the seed, and ran
 * against an empty database. A hook cannot be deselected.
 *
 * **Idempotent, and that is the half a hook alone would not fix.** `slug` is
 * `unique: true`, and CI sets `retries: 1` over a `serial` group — so ONE later
 * failure re-runs the whole group and the seed re-inserts. Measured before
 * fixing: the retry did not merely die on the fixture, it reported a test that
 * had PASSED as failed, because the group's first test is where the hook's
 * error surfaces. A false failure in an unrelated test is worse than the
 * original masking.
 */
test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");

  // Its own context: `request` is test-scoped and cannot be taken by a
  // `beforeAll`. The signed-in state is the same one every test runs with.
  const api = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });

  try {
    for (const row of [
      {
        title: "Dogfood",
        slug: PUBLISHED_SLUG,
        content: DOCUMENT,
        status: "published",
      },
      {
        title: "Dogfood draft",
        slug: DRAFT_SLUG,
        content: DOCUMENT,
        status: "draft",
      },
    ]) {
      const created = await api.post(ENTRIES, { data: row });

      // 409 IS the success case on a retry: the unique index on `slug` is what
      // reports "this run already seeded me". Asking the list endpoint first
      // looked tidier and was wrong — it answered without the draft row, so the
      // check passed for one slug and not the other. The index is the authority
      // on whether a slug is taken; nothing else has to agree with it.
      if (created.status() === 409) continue;
      await expectOk(created, `seeding ${row.slug}`);
    }
  } finally {
    await api.dispose();
  }
});

test("renders every block in the document", async ({ page }) => {
  const failed: string[] = [];
  page.on("requestfailed", request =>
    failed.push(`${request.method()} ${request.url()}`)
  );

  const response = await page.goto(`/blocks/${PUBLISHED_SLUG}`);
  expect(response?.status()).toBe(200);

  // First, because it is what makes every assertion below mean anything: a
  // resolver that resolves nothing still renders a page, so "the route answered
  // 200" is not the same claim as "the blocks drew".
  //
  // Asserted on the attribute rather than on the placeholder's wording. The
  // wording exists only in development — a production build renders the
  // placeholder as an empty `hidden` div carrying the same attribute and no
  // text at all, so a text assertion would quietly stop covering anything in
  // exactly the build a performance measurement uses.
  await expect(page.locator("[data-nx-block-placeholder]")).toHaveCount(0);

  // One assertion per block type, so a failure names which block stopped
  // rendering instead of reporting that "the page" is wrong.
  await expect(page.getByRole("heading", { name: PAGE_HEADING })).toBeVisible();
  await expect(page.getByText(LEAD_PARAGRAPH)).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("link", { name: BUTTON_LABEL })).toBeVisible();
  await expect(page.locator("hr")).toHaveCount(1);

  // The container reached markup as a landmark and the blocks are INSIDE it —
  // asserted as containment rather than as a count of `<section>` on the page,
  // which would also pass if the section rendered empty beside its children.
  await expect(
    page.locator("section").getByRole("heading", { name: PAGE_HEADING })
  ).toBeVisible();

  expect(failed).toEqual([]);
});

test("an authored node style is compiled and applied", async ({ page }) => {
  await page.goto(`/blocks/${PUBLISHED_SLUG}`);

  const heading = page.getByRole("heading", { name: PAGE_HEADING });

  // The class is emitted unconditionally, so its presence proves nothing about
  // whether any rule defines it. The COMPUTED colour is the only thing that
  // separates "a stylesheet was compiled and served" from "a class name was
  // printed onto an unstyled page", which is what a route with no compiled
  // artifact and no compile context produces.
  await expect(heading).toHaveCSS("color", STYLED_HEADING_COLOR);
});

test("a condition-gated node is never sent to the client", async ({
  request,
}) => {
  // Read as raw HTML rather than through the page: a node the renderer removed
  // and a node CSS is hiding look identical to a visibility assertion, and only
  // one of them is the guarantee conditions make.
  const response = await request.get(`/blocks/${PUBLISHED_SLUG}`);
  expect(response.status()).toBe(200);

  const html = await response.text();
  // The positive control. Without it, a fixture that failed to store its
  // document at all satisfies "the gated text is absent" by serving an empty
  // page, and reports clean.
  expect(html).toContain(PAGE_HEADING);
  expect(html).not.toContain(GATED_TEXT);
});

test("an unpublished entry is not served", async ({ page }) => {
  const response = await page.goto(`/blocks/${DRAFT_SLUG}`);
  expect(response?.status()).toBe(404);
});

test("block-declared metadata reaches the head", async ({ page }) => {
  await page.goto(`/blocks/${PUBLISHED_SLUG}`);

  // `core/heading` declares the title through its `seo` hook.
  await expect(page).toHaveTitle(PAGE_HEADING);

  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    LEAD_PARAGRAPH
  );

  // The mount point is the host's to add: the helper resolves slugs within a
  // collection and does not know which segment of the app it was wired under.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/blocks/${PUBLISHED_SLUG}$`)
  );
});
