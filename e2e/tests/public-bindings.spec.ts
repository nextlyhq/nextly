/**
 * A published page's bindings, served by the public route to anyone who asks.
 *
 * A published page reads every binding as an anonymous visitor would, so:
 *
 * 1. It is the same page for every visitor. On a production build the HTML
 *    served to a visitor with no session and to a signed-in author is
 *    identical, nonces aside: the page is pre-rendered, so identical bytes is
 *    the strongest proof. `next dev` streams each request its own flight data
 *    and chunk scripts, so there the whole document differs by design, and
 *    the check is the page itself: every page root's markup, as a browser
 *    holds it once the page has loaded, is identical for both.
 * 2. A field the public may not read is shown to nobody: its value is absent
 *    from the HTML, its head and the payload the client is sent, signed in or
 *    not, and the binding shows its fallback.
 * 3. A bound field shows its public value, a bound date its machine value in
 *    `<time datetime>`, and a draft row of a list is never listed.
 * 4. The public route is built ahead of time, and an author's preview shows a
 *    draft at the preview address while the public address never does.
 *
 * Meant for a production build (`E2E_SERVER=production`), where the public
 * route is pre-rendered and cached. Under `next dev` nothing is, so there the
 * build-output check is skipped, the page check above replaces the
 * whole-document one, and the rest holds as it does in production.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type APIRequestContext, type Browser } from "@playwright/test";

import type { StorageState } from "./support/accounts";
import { olderPreviewToken } from "./support/preview-links";
import { fileAccount, test } from "./support/test";

test.describe.configure({ mode: "serial" });

const PAGES = "/admin/api/collections/block-pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

/** This run's own slugs, since a slug is unique and other runs may have left theirs. */
const RUN = Date.now().toString(36);
const PAGE_SLUG = `public-bindings-${RUN}`;
const DRAFT_SLUG = `public-bindings-draft-${RUN}`;
const RELATED_SLUG = `public-bindings-related-${RUN}`;

const PLAYGROUND = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "apps",
  "playground"
);

const PAGE_TITLE = "Bindings page 5e7a";
const VISIBLE_TITLE = "Visible entry 3b1f";
const DRAFT_TITLE = "Draft entry 8c2d";
const DRAFT_BODY = "Draft body 4a9e";
/** A value the public may not read, which must appear nowhere it is served. */
const SENTINEL = "internal-note-sentinel-91f0";
const FALLBACK = "public fallback 2c7d";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000992${suffix}`;

function heading(
  nodeId: string,
  binding: Record<string, unknown>,
  level = "h2"
) {
  return {
    id: id(nodeId),
    type: "core/heading",
    version: 1,
    props: { text: "Own heading", level },
    bindings: { text: binding },
  };
}

function text(nodeId: string, binding: Record<string, unknown>) {
  return {
    id: id(nodeId),
    type: "core/text",
    version: 1,
    props: { text: "Own text" },
    bindings: { text: binding },
  };
}

/** The page: its own title, then a list of bound entries, each bound field by field. */
const PAGE_DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    heading("10", { $bind: "title" }, "h1"),
    {
      id: id("20"),
      type: "core/collection-loop",
      version: 1,
      props: { collection: "bound-entries", limit: 10, sort: "title" },
      slots: {
        children: [
          heading("21", { $bind: "title", source: "item" }),
          text("22", {
            $bind: "internalNote",
            source: "item",
            fallback: FALLBACK,
          }),
          text("23", {
            $bind: "publishedAt",
            source: "item",
            format: { type: "date", options: { dateStyle: "long" } },
          }),
        ],
      },
    },
  ],
};

const DRAFT_DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: id("30"),
      type: "core/text",
      version: 1,
      props: { text: DRAFT_BODY },
    },
  ],
};

const EMPTY_DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

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

/** Whether the suite runs against a production build rather than `next dev`. */
const PRODUCTION = process.env.E2E_SERVER === "production";

/**
 * Every page root's markup, as a browser holds it once the page has loaded:
 * the page itself, without the document around it.
 */
async function pageRootsOf(
  browser: Browser,
  baseURL: string,
  storageState: StorageState | undefined
): Promise<string> {
  const context = await browser.newContext({
    baseURL,
    ...(storageState === undefined ? {} : { storageState }),
  });
  try {
    const page = await context.newPage();
    await page.goto(`/blocks/${PAGE_SLUG}`);
    await expect(page.getByText(VISIBLE_TITLE)).toBeVisible();
    return await page
      .locator(".nx-pb-page")
      .evaluateAll(roots => roots.map(root => root.outerHTML).join("\n"));
  } finally {
    await context.close();
  }
}

/** The served markup with what legitimately differs per response removed. */
function comparable(html: string): string {
  return html.replace(/ nonce="[^"]*"/g, "");
}

test("a published page shows every visitor the same public values, and nothing the public may not read", async ({
  playwright,
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const signedIn = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  const visitor = await playwright.request.newContext({ baseURL });
  try {
    const related = await created(signedIn, PAGES, {
      title: "Related page",
      slug: RELATED_SLUG,
      content: EMPTY_DOCUMENT,
      status: "published",
    });
    await created(signedIn, ENTRIES, {
      title: VISIBLE_TITLE,
      internalNote: SENTINEL,
      publishedAt: "2026-03-29T00:00:00.000Z",
      price: 42,
      relatedPage: related,
      status: "published",
    });
    await created(signedIn, ENTRIES, {
      title: DRAFT_TITLE,
      internalNote: SENTINEL,
      status: "draft",
    });
    await created(signedIn, PAGES, {
      title: PAGE_TITLE,
      slug: PAGE_SLUG,
      content: PAGE_DOCUMENT,
      status: "published",
    });

    // The control: the signed-in author CAN read the protected field, so its
    // absence from the page below is the page's doing, not the fixture's.
    const asAuthor = await signedIn.get(`${ENTRIES}?limit=100&status=all`);
    expect(await asAuthor.text()).toContain(SENTINEL);

    // The first request renders the page on demand and streams its list in as
    // it resolves; every later one is served the cached render. Warmed first,
    // so the two below are the page as it is served, compared like for like.
    expect((await visitor.get(`/blocks/${PAGE_SLUG}`)).status()).toBe(200);
    const anonymous = await visitor.get(`/blocks/${PAGE_SLUG}`);
    const author = await signedIn.get(`/blocks/${PAGE_SLUG}`);
    expect(anonymous.status()).toBe(200);
    expect(author.status()).toBe(200);
    const anonymousHtml = await anonymous.text();
    const authorHtml = await author.text();

    // 3. The public values, the date's machine value, and no draft row.
    expect(anonymousHtml).toContain(PAGE_TITLE);
    expect(anonymousHtml).toContain(VISIBLE_TITLE);
    expect(anonymousHtml).toContain(FALLBACK);
    expect(anonymousHtml).toContain(
      '<time dateTime="2026-03-29">March 29, 2026</time>'
    );
    expect(anonymousHtml).not.toContain(DRAFT_TITLE);

    // 2. The protected value is nowhere: not in the markup or its head, for
    // either visitor, and not in the payload a client navigation fetches.
    for (const [who, html] of [
      ["anonymous", anonymousHtml],
      ["signed in", authorHtml],
    ]) {
      expect(html, who).not.toContain(SENTINEL);
      const head = /<head>[\s\S]*<\/head>/.exec(html)?.[0] ?? "";
      expect(head.length, `${who} head`).toBeGreaterThan(0);
      expect(head, `${who} head`).not.toContain(SENTINEL);
    }
    for (const context of [visitor, signedIn]) {
      const payload = await context.get(`/blocks/${PAGE_SLUG}`, {
        headers: { RSC: "1" },
      });
      const body = await payload.text();
      // The control: this is the page's payload, carrying its public values.
      expect(body).toContain(VISIBLE_TITLE);
      expect(body).not.toContain(SENTINEL);
    }

    // 1. The same page for everyone: the whole document on a production
    // build, the page itself under `next dev` (see the header).
    if (PRODUCTION) {
      expect(comparable(authorHtml)).toBe(comparable(anonymousHtml));
    } else {
      const anonymousPage = await pageRootsOf(browser, baseURL, undefined);
      const authorPage = await pageRootsOf(
        browser,
        baseURL,
        await fileAccount(baseURL, testInfo)
      );
      // The control: this is the page, carrying its public values.
      expect(anonymousPage).toContain(VISIBLE_TITLE);
      expect(authorPage).toBe(anonymousPage);
    }
  } finally {
    await signedIn.dispose();
    await visitor.dispose();
  }
});

test("the public route is built ahead of time, and only the preview address shows a draft", async ({
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");

  // 4a. The seeded page is in the build's pre-rendered output. Only a
  // production build writes that manifest: a dev server pre-renders nothing.
  if (process.env.E2E_SERVER === "production") {
    const manifest = readFileSync(
      join(PLAYGROUND, ".next-e2e-start", "prerender-manifest.json"),
      "utf8"
    );
    expect(manifest).toContain('"/blocks/kitchen-sink"');
  }

  const signedIn = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  const visitor = await playwright.request.newContext({ baseURL });
  try {
    const draft = await created(signedIn, PAGES, {
      title: "Bindings draft",
      slug: DRAFT_SLUG,
      content: DRAFT_DOCUMENT,
      status: "draft",
    });
    const session = await signedIn.get("/admin/api/auth/session");
    const { user } = (await session.json()) as { user: { id: string } };

    // 4b. The public address never shows the draft.
    const publicDraft = await visitor.get(`/blocks/${DRAFT_SLUG}`);
    expect(await publicDraft.text()).not.toContain(DRAFT_BODY);

    // An author's preview link, followed by a visitor holding it, shows the
    // draft at the preview address.
    const token = olderPreviewToken({
      collection: "block-pages",
      entryId: draft,
      minter: user.id,
      generation: 0,
      ttlSeconds: 60 * 60,
    });
    const preview = await visitor.get(`/api/preview?token=${token}`);
    expect(preview.url()).toContain(`/preview/blocks/${DRAFT_SLUG}`);
    expect(await preview.text()).toContain(DRAFT_BODY);

    // And the public address still does not, even for the visitor whose
    // preview is now open.
    const after = await visitor.get(`/blocks/${DRAFT_SLUG}`);
    expect(await after.text()).not.toContain(DRAFT_BODY);
  } finally {
    await signedIn.dispose();
    await visitor.dispose();
  }
});
