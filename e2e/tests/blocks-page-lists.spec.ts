/**
 * A page's lists, served by a real route to a visitor who is not signed in.
 *
 * The route passes no `data`, so a `core/collection-loop` reads through the
 * route's public reader by default. What that must mean on a live page:
 *
 * 1. The loop lists exactly the published entries: one copy of its template
 *    per published row, and none for a draft.
 * 2. A stored sort the reader refuses (a field that does not exist) lists in
 *    id order instead of emptying the loop.
 *
 * The loop's template is static text, so entries are counted by its drawn
 * copies.
 * The loops list this file's own pages by their slug, because other specs
 * publish pages of their own while it runs, and the expected count is read
 * from the signed-in list endpoint with the same filter, in the same test.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { fileAccount, test } from "./support/test";

test.describe.configure({ mode: "serial" });

const ENTRIES = "/admin/api/collections/block-pages/entries";

const LIST_SLUG = "lists-public-reader";
const OTHER_SLUG = "lists-public-reader-other";
const DRAFT_SLUG = "lists-public-reader-draft";

/** Text drawn once per entry by each loop. Distinct, so each loop is counted alone. */
const SORTED_ITEM = "sorted-list-item-5c1e";
const REFUSED_SORT_ITEM = "refused-sort-item-9d42";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000009${suffix}`;

/** A loop over this collection, its template one text block. */
function loop(nodeId: string, textId: string, sort: string, text: string) {
  return {
    id: id(nodeId),
    type: "core/collection-loop",
    version: 1,
    // Only this file's own pages: other specs publish block pages meanwhile.
    props: {
      collection: "block-pages",
      limit: 100,
      sort,
      filters: [{ field: "slug", op: "contains", value: LIST_SLUG }],
    },
    slots: {
      children: [
        {
          id: id(textId),
          type: "core/text",
          version: 1,
          props: { text },
        },
      ],
    },
  };
}

const LIST_DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    loop("10", "11", "-title", SORTED_ITEM),
    loop("20", "21", "no_such_field", REFUSED_SORT_ITEM),
  ],
};

const EMPTY_DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

async function seed(api: APIRequestContext): Promise<void> {
  for (const row of [
    {
      title: "Lists",
      slug: LIST_SLUG,
      content: LIST_DOCUMENT,
      status: "published",
    },
    {
      title: "Listed",
      slug: OTHER_SLUG,
      content: EMPTY_DOCUMENT,
      status: "published",
    },
    {
      title: "Never listed",
      slug: DRAFT_SLUG,
      content: EMPTY_DOCUMENT,
      status: "draft",
    },
  ]) {
    const created = await api.post(ENTRIES, { data: row });
    // 409 is a retry finding its own rows: the slug is unique.
    if (created.status() === 409) continue;
    if (!created.ok()) {
      throw new Error(
        `seeding ${row.slug} failed: ${created.status()} ${await created.text()}`
      );
    }
  }
}

/** How many of this file's block pages the list endpoint holds under `status`. */
async function total(api: APIRequestContext, status: string): Promise<number> {
  const response = await api.get(
    `${ENTRIES}?limit=1&status=${status}&where[slug][contains]=${LIST_SLUG}`
  );
  if (!response.ok()) {
    throw new Error(
      `counting failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { meta: { total: number } };
  return body.meta.total;
}

test("a page lists the published entries only, and survives a refused sort", async ({
  playwright,
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    await seed(api);
    const published = await total(api, "published");
    // The control: a draft exists, so a list of everything would be longer.
    expect(await total(api, "all")).toBeGreaterThan(published);

    // A visitor with no session at all.
    const visitor = await browser.newContext({ storageState: undefined });
    try {
      const page = await visitor.newPage();
      const response = await page.goto(`${baseURL}/blocks/${LIST_SLUG}`);
      expect(response?.status()).toBe(200);
      // Counted as drawn elements, not as text in the HTML: the response also
      // carries each text in the payload Next.js embeds for the client.
      await expect(page.getByText(SORTED_ITEM, { exact: true })).toHaveCount(
        published
      );
      await expect(
        page.getByText(REFUSED_SORT_ITEM, { exact: true })
      ).toHaveCount(published);
    } finally {
      await visitor.close();
    }
  } finally {
    await api.dispose();
  }
});
