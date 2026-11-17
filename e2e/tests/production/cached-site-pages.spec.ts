import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { answeredNotFound } from "../support/not-found";
import { signIn } from "../support/production-sign-in";
import { LOCK } from "../support/locks";
import { countEveryPage } from "../support/usage-count";
import { test } from "../support/visible";

/**
 * The site's pages are served from the cache, in a PRODUCTION build, through
 * the route the page-builder docs show: `createPublicContentPage` with
 * `draft: previewDraftGate()` (`app/(frontend)/[...slug]` in the playground).
 *
 * Asked as a visitor with no session, as the claim is about what every visitor
 * is served:
 *
 * - a published page is answered with a header a shared cache may keep, and a
 *   second visit is answered from the cache;
 * - publishing a change to the page, to a component it places and to the site
 *   style shows on the next visit (the last two at `/site` as well, the
 *   playground's `createPublicBlocksPage` route), and unpublishing the page answers not
 *   found (its header and footer: `pages-in-their-layout.spec.ts`);
 * - a preview link shows the draft on the page's own address, answered as
 *   private; the same reviewer opening another unpublished page sees no
 *   draft; and no visitor after them is served the draft.
 *
 * Each change is polled for well under a cached answer's lifetime, so a
 * change that shows was refreshed by its tags rather than by time.
 *
 * @module tests/production/cached-site-pages
 */

const API = "/admin/api";
const SITE_STYLE = `${API}/singles/site-style`;
/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);
const SLUG = `cached-${STAMP}`;
const DRAFT_SLUG = `cached-draft-${STAMP}`;
const OTHER_DRAFT_SLUG = `cached-other-draft-${STAMP}`;
const TEXT = {
  pageOne: `Cached page ${STAMP}`,
  pageTwo: `Cached page edited ${STAMP}`,
  partOne: `Cached part ${STAMP}`,
  partTwo: `Cached part edited ${STAMP}`,
  draft: `Cached draft only ${STAMP}`,
  otherDraft: `Cached other draft ${STAMP}`,
};
/** A site variable of this run's own, and the name the site sheet gives it. */
const VARIABLE = `color.cached-${STAMP}`;
const VARIABLE_PROPERTY = `--site-color-cached-${STAMP}`;
/** How long a change may take to show: well under a cached answer's life. */
const REFRESH_MS = 15_000;

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

/** Fail with the server's message rather than with a bare status code. */
async function idOf(response: APIResponse, what: string): Promise<string> {
  if (!response.ok()) {
    throw new Error(`${what}: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { item?: { id?: unknown } };
  if (typeof body.item?.id !== "string") {
    throw new Error(`${what} answered no id: ${JSON.stringify(body)}`);
  }
  return body.item.id;
}

async function ok(response: APIResponse, what: string): Promise<void> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
}

/** A path as an anonymous visitor gets it: status, headers and markup. */
async function visit(
  visitor: APIRequestContext,
  path: string
): Promise<{ status: number; headers: Record<string, string>; html: string }> {
  const response = await visitor.get(path, { headers: { cookie: "" } });
  return {
    status: response.status(),
    headers: response.headers(),
    html: await response.text(),
  };
}

/**
 * Until the anonymous page at `path` contains `text`. Each attempt's cache
 * state is kept, so a failure says whether the cache kept serving the old
 * page (`HIT`/`STALE`) or rendered it again without the change (`MISS`).
 */
async function shows(
  visitor: APIRequestContext,
  path: string,
  text: string
): Promise<void> {
  const seen: string[] = [];
  try {
    await expect
      .poll(
        async () => {
          const page = await visit(visitor, path);
          const found = page.html.includes(text);
          seen.push(
            `${page.headers["x-nextjs-cache"] ?? "-"}:${found ? "new" : "old"}`
          );
          return found;
        },
        { timeout: REFRESH_MS }
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `"${text}" never showed at ${path}; each attempt: ${seen.join(" ")}`,
      { cause: error }
    );
  }
}

/** The page's document: a heading and a placed component. */
function pageDocument(text: string, componentId: string) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      heading("cached-heading", text),
      {
        id: "cached-place",
        type: "nextly/component-instance",
        version: 1,
        props: { componentId },
      },
    ],
  };
}

// It replaces the site style's variables, which other specs read and write.
test.describe.configure({ lock: [LOCK.siteStyle] });

test.describe("the site's pages, served from the cache", () => {
  test("are cached, refreshed by every publish, and never serve a preview", async ({
    page,
    playwright,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const api = await signIn(page);
    const visitor = await playwright.request.newContext({ baseURL });
    const tokensBefore = (
      (
        (await (await api.get(SITE_STYLE)).json()) as {
          item?: { tokens?: unknown };
        }
      ).item ?? {}
    ).tokens;
    try {
      // A published component, and a published page placing it.
      const componentId = await idOf(
        await api.post(`${API}/collections/components/entries`, {
          data: {
            title: `Cached part ${STAMP}`,
            slug: `cached-part-${STAMP}`,
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [heading("cached-part", TEXT.partOne)],
            },
            status: "published",
          },
        }),
        "creating the component"
      );
      const pageId = await idOf(
        await api.post(`${API}/collections/pages/entries`, {
          data: {
            title: `Cached ${STAMP}`,
            slug: SLUG,
            content: pageDocument(TEXT.pageOne, componentId),
            status: "published",
          },
        }),
        "creating the page"
      );

      // 1. Cached: the answer may be kept by a shared cache, and once the
      //    first render is stored (in the background, under Cache
      //    Components) a repeat visit is answered from the cache.
      const first = await visit(visitor, `/${SLUG}`);
      expect(first.status).toBe(200);
      expect(first.html).toContain(TEXT.pageOne);
      expect(first.html).toContain(TEXT.partOne);
      await expect
        .poll(
          async () =>
            (await visit(visitor, `/${SLUG}`)).headers["x-nextjs-cache"],
          { timeout: 10_000 }
        )
        .toBe("HIT");
      const second = await visit(visitor, `/${SLUG}`);
      // The same page through the playground's other cached route, kept too,
      // so the publishes below are seen to reach it as well.
      expect((await visit(visitor, `/site/${SLUG}`)).html).toContain(
        TEXT.partOne
      );
      await testInfo.attach("headers.json", {
        body: JSON.stringify({ first: first.headers, second: second.headers }),
        contentType: "application/json",
      });
      const cacheControl = second.headers["cache-control"] ?? "";
      expect(cacheControl).not.toMatch(/private|no-store/);
      expect(cacheControl).toMatch(/s-maxage=\d+/);
      expect(second.headers["x-nextjs-cache"]).toBe("HIT");

      // 2. The page's own publish shows on the next visits.
      await ok(
        await api.patch(`${API}/collections/pages/entries/${pageId}`, {
          data: {
            content: pageDocument(TEXT.pageTwo, componentId),
            status: "published",
            _overwrite: true,
          },
        }),
        "publishing the page's change"
      );
      await shows(visitor, `/${SLUG}`, TEXT.pageTwo);

      // 3. A component it places: its publish shows on the page.
      await ok(
        await api.patch(
          `${API}/collections/components/entries/${componentId}`,
          {
            data: {
              content: {
                formatVersion: 1,
                kind: "component",
                nodes: [heading("cached-part", TEXT.partTwo)],
              },
              status: "published",
              _overwrite: true,
            },
          }
        ),
        "publishing the component's change"
      );
      await shows(visitor, `/${SLUG}`, TEXT.partTwo);
      await shows(visitor, `/site/${SLUG}`, TEXT.partTwo);

      // 4. The site style: a variable of this run's own reaches the page's
      //    site sheet.
      await ok(
        await api.patch(SITE_STYLE, {
          data: {
            tokens: {
              tokens: [
                {
                  name: VARIABLE,
                  kind: "color",
                  values: { light: "#0a1b2c", dark: "#2c1b0a" },
                },
              ],
            },
            _overwrite: true,
          },
        }),
        "saving the site style"
      );
      await shows(visitor, `/${SLUG}`, VARIABLE_PROPERTY);
      await shows(visitor, `/site/${SLUG}`, VARIABLE_PROPERTY);

      // 5. A preview: the draft shows on the page's own address, answered as
      //    private, and is never kept for anyone else.
      const draftId = await idOf(
        await api.post(`${API}/collections/pages/entries`, {
          data: {
            title: `Cached draft ${STAMP}`,
            slug: DRAFT_SLUG,
            content: {
              formatVersion: 1,
              kind: "page",
              nodes: [heading("cached-draft", TEXT.draft)],
            },
            status: "draft",
          },
        }),
        "creating the draft page"
      );
      // An unpublished page the link does NOT name.
      await idOf(
        await api.post(`${API}/collections/pages/entries`, {
          data: {
            title: `Cached other draft ${STAMP}`,
            slug: OTHER_DRAFT_SLUG,
            content: {
              formatVersion: 1,
              kind: "page",
              nodes: [heading("cached-other", TEXT.otherDraft)],
            },
            status: "draft",
          },
        }),
        "creating the other draft page"
      );
      // A link minted as the editor mints one, so it is signed by this
      // server's own secret.
      const csrf = (await (await api.get(`${API}/auth/csrf`)).json()) as {
        token: string;
      };
      const minted = await api.post(`${API}/preview-links`, {
        headers: { "x-csrf-token": csrf.token, origin: baseURL },
        data: { collection: "pages", entryId: draftId },
      });
      await ok(minted, "minting the preview link");
      const { item: link } = (await minted.json()) as {
        item: { token: string };
      };
      const reviewer = await playwright.request.newContext({ baseURL });
      try {
        const opened = await reviewer.get(
          `/api/preview?token=${encodeURIComponent(link.token)}`
        );
        expect(new URL(opened.url()).pathname).toBe(`/${DRAFT_SLUG}`);
        expect(await opened.text()).toContain(TEXT.draft);
        expect(opened.headers()["cache-control"] ?? "").toMatch(
          /private|no-store/
        );
        // Draft mode alone opens nothing: the reviewer, preview open, gets no
        // draft of a page their link does not name.
        const other = await reviewer.get(`/${OTHER_DRAFT_SLUG}`);
        const otherHtml = await other.text();
        expect(otherHtml).not.toContain(TEXT.otherDraft);
        expect(
          answeredNotFound({ status: other.status(), html: otherHtml })
        ).toBe(true);
      } finally {
        await reviewer.dispose();
      }
      const afterPreview = await visit(visitor, `/${DRAFT_SLUG}`);
      expect(afterPreview.html).not.toContain(TEXT.draft);
      expect(answeredNotFound(afterPreview)).toBe(true);

      // 6. Unpublished: the page's address answers not found.
      await ok(
        await api.patch(`${API}/collections/pages/entries/${pageId}`, {
          data: { status: "draft", _overwrite: true },
        }),
        "unpublishing the page"
      );
      await expect
        .poll(async () => answeredNotFound(await visit(visitor, `/${SLUG}`)), {
          timeout: REFRESH_MS,
        })
        .toBe(true);
    } finally {
      // The site style as it was; dropping a variable waits on the count.
      await countEveryPage(api);
      await api.patch(SITE_STYLE, {
        data: { tokens: tokensBefore ?? null, _overwrite: true },
      });
      await visitor.dispose();
    }
  });
});
