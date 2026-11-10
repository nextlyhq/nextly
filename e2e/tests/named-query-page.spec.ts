/**
 * A page whose collection lists take a named query as their source, served
 * by the public route to a visitor who is not signed in.
 *
 * The queries are the playground's (`apps/playground/src/named-queries.ts`):
 *
 * 1. **The page refreshes on everything the query declares.** "Blog posts
 *    with a story" lists blog posts, and reads a story's title and the
 *    homepage's title beside them. A published page is cached, tagged by
 *    what its reads touch; a named query's result is tagged by every
 *    collection and Single it DECLARES. So renaming the story (a collection
 *    it reads that is not its result) and retitling the homepage (a Single
 *    it reads) each refresh the page. Were the result tagged by its rows'
 *    collection alone, neither change would ever reach it.
 * 2. **A field the public may not read never reaches the page.** The query
 *    copies each post's `internalNote` into its rows; "Blog posts" lists the
 *    posts themselves. Neither can hand the sentinel to the page: the reader
 *    reads as a visitor, and the rows are projected to what each declares.
 *    It is absent from the HTML, its head and the payload a client fetches.
 *
 * Meant for a production build (`E2E_SERVER=production`), where the route is
 * cached: under `next dev` nothing is, so every request reads afresh and the
 * refresh holds trivially there, while the leak check holds as it does in
 * production.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

test.describe.configure({ mode: "serial", lock: [LOCK.homepage] });

const API = "/admin/api";
const PAGES = `${API}/collections/block-pages/entries`;
const POSTS = `${API}/collections/bound-entries/entries`;
const STORIES = `${API}/collections/list-stories/entries`;
const HOMEPAGE = `${API}/singles/homepage`;

/** This run's own words, which every row it makes holds and the lists match. */
const RUN = Date.now().toString(36);
const MATCH = `Named ${RUN}`;
const PAGE_SLUG = `named-query-${RUN}`;

const POST_TITLE = `${MATCH} post`;
const STORY_BEFORE = `${MATCH} story before`;
const STORY_AFTER = `${MATCH} story after`;
const HEADLINE_BEFORE = `Headline before ${RUN}`;
const HEADLINE_AFTER = `Headline after ${RUN}`;
/** A value the public may not read, which must appear nowhere it is served. */
const SENTINEL = `named-internal-sentinel-${RUN}`;
const FALLBACK = "named public fallback 6b3e";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000996${suffix}`;

/** A text block showing one field of the list's item. */
function itemText(nodeId: string, field: string, fallback?: string) {
  return {
    id: id(nodeId),
    type: "core/text",
    version: 1,
    props: { text: "Own text" },
    bindings: {
      text: {
        $bind: field,
        source: "item",
        ...(fallback === undefined ? {} : { fallback }),
      },
    },
  };
}

/** A list whose source is one of the playground's named queries. */
function namedList(
  nodeId: string,
  name: string,
  children: readonly Record<string, unknown>[]
) {
  return {
    id: id(nodeId),
    type: "core/collection-loop",
    version: 1,
    props: { namedQuery: { name, params: { match: MATCH } }, limit: 10 },
    slots: { children },
  };
}

const PAGE_DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    namedList("10", "e2e.posts-with-story", [
      itemText("11", "title"),
      itemText("12", "story"),
      itemText("13", "headline"),
      itemText("14", "internalNote", FALLBACK),
    ]),
    namedList("20", "e2e.blog-posts", [
      itemText("21", "title"),
      itemText("22", "internalNote", FALLBACK),
    ]),
  ],
};

/** Create one row, returning its id. */
async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  if (!response.ok()) {
    throw new Error(
      `creating failed: ${response.status()} ${await response.text()}`
    );
  }
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** Write one change, failing loudly when it is refused. */
async function changed(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<void> {
  const response = await api.patch(endpoint, {
    data: { ...data, _overwrite: true },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** The homepage's title as stored, to put back when the test is done. */
async function homepageTitle(api: APIRequestContext): Promise<unknown> {
  const response = await api.get(HOMEPAGE);
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  return item.title;
}

test("a named query's page refreshes when a collection or a Single it reads changes, and never shows a field the public may not read", async ({
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const signedIn = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  const visitor = await playwright.request.newContext({ baseURL });
  const originalHeadline = await homepageTitle(signedIn);
  try {
    await created(signedIn, POSTS, {
      title: POST_TITLE,
      internalNote: SENTINEL,
      status: "published",
    });
    const story = await created(signedIn, STORIES, {
      title: STORY_BEFORE,
      status: "published",
    });
    await changed(signedIn, HOMEPAGE, { title: HEADLINE_BEFORE });
    await created(signedIn, PAGES, {
      title: "Named query page",
      slug: PAGE_SLUG,
      content: PAGE_DOCUMENT,
      status: "published",
    });

    // The control: the signed-in author CAN read the protected field, so its
    // absence from the page is the page's doing, not the fixture's.
    const asAuthor = await signedIn.get(`${POSTS}?limit=100&status=all`);
    expect(await asAuthor.text()).toContain(SENTINEL);

    const served = async () =>
      await (await visitor.get(`/blocks/${PAGE_SLUG}`)).text();

    // Warmed, so what follows is the page as it is served from the cache.
    await expect.poll(served, { timeout: 30_000 }).toContain(STORY_BEFORE);
    const html = await served();
    // Both lists drew their rows: each query ran, as a visitor reads.
    expect(html.split(POST_TITLE).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain(HEADLINE_BEFORE);
    expect(html).toContain(FALLBACK);

    // 2. The protected value is nowhere a visitor is served it.
    expect(html).not.toContain(SENTINEL);
    const head = /<head>[\s\S]*<\/head>/.exec(html)?.[0] ?? "";
    expect(head.length).toBeGreaterThan(0);
    expect(head).not.toContain(SENTINEL);
    const payload = await (
      await visitor.get(`/blocks/${PAGE_SLUG}`, { headers: { RSC: "1" } })
    ).text();
    // The control: this is the page's payload, carrying its public values.
    expect(payload).toContain(POST_TITLE);
    expect(payload).not.toContain(SENTINEL);

    // 1a. A collection the query reads, which is not the one it lists.
    await changed(signedIn, `${STORIES}/${story}`, { title: STORY_AFTER });
    await expect.poll(served, { timeout: 30_000 }).toContain(STORY_AFTER);

    // 1b. A Single the query reads.
    await changed(signedIn, HOMEPAGE, { title: HEADLINE_AFTER });
    await expect.poll(served, { timeout: 30_000 }).toContain(HEADLINE_AFTER);

    // Still nothing the public may not read, after both refreshes.
    expect(await served()).not.toContain(SENTINEL);
  } finally {
    await signedIn
      .patch(HOMEPAGE, {
        data: { title: originalHeadline ?? null, _overwrite: true },
      })
      .catch(() => undefined);
    await signedIn.dispose();
    await visitor.dispose();
  }
});
