import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Browser,
} from "@playwright/test";

import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * A Collection list split into pages, served by a production build to a
 * visitor who is not signed in, on the public `/blocks` route.
 *
 * Every page here is written after the build, so each address is rendered on
 * its first request, the way a list that grows after a deploy is served.
 *
 * What separates a correct route from a plausible broken one:
 *
 * 1. With 25 matching entries, 10 skipped and 10 to a page, page 1 shows
 *    entries 11 to 20, page 2 shows 21 to 25 and is the last: the offset is
 *    applied once, before paging. Page 3 is not found.
 * 2. The links under the list name the route's own addresses, under its
 *    `/blocks` mount, and mark the current page.
 * 3. `/page/1` is a permanent redirect to the list's own address, and every
 *    other spelling of a number is not found.
 * 4. Publishing entries that take the list onto a third page serves that
 *    page, though it was answered as not found before.
 * 5. A list matching nothing shows its empty state at its own address, and
 *    its page 2 is not found.
 */

const ENTRIES = "/admin/api/collections/block-pages/entries";

/** Distinctive per run, so only this run's entries match the list. */
const STAMP = Date.now().toString(36);
const TOKEN = `paged-${STAMP}`;
const LIST_SLUG = `list-pages-${STAMP}`;
const EMPTY_SLUG = `list-pages-empty-${STAMP}`;
const EMPTY_TEXT = `Nothing listed ${STAMP}`;

/** An entry's title, numbered so the title order is the number order. */
const titled = (n: number) => `${TOKEN} ${String(n).padStart(2, "0")}`;

/** A list of this run's entries in title order, its template one bound heading. */
function pagedList(token: string) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: {
          collection: "block-pages",
          filters: [{ field: "title", op: "contains", value: token }],
          sort: "title",
          limit: 10,
          offset: 10,
          paginate: true,
        },
        slots: {
          children: [
            {
              id: "item-title",
              type: "core/heading",
              version: 1,
              props: { text: "?", level: "h3" },
              bindings: { text: { $bind: "title", source: "item" } },
            },
          ],
          empty: [
            {
              id: "empty-text",
              type: "core/paragraph",
              version: 1,
              props: { text: EMPTY_TEXT },
            },
          ],
        },
      },
    ],
  };
}

/** Fail with the server's message rather than with a bare status code. */
async function ok(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
}

async function publishEntries(
  api: APIRequestContext,
  numbers: readonly number[]
): Promise<void> {
  for (const n of numbers) {
    await ok(
      await api.post(ENTRIES, {
        data: {
          title: titled(n),
          slug: `${TOKEN}-${String(n)}`,
          content: { formatVersion: 1, kind: "page", nodes: [] },
          status: "published",
        },
      }),
      `publishing entry ${String(n)}`
    );
  }
}

/** What a visitor sees at `path`: the entries' numbers and the page links. */
async function visit(
  browser: Browser,
  path: string
): Promise<{
  status: number | undefined;
  numbers: string[];
  links: { text: string; href: string | null; current: boolean }[];
  text: string;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const response = await page.goto(path);
    const numbers = await page.locator("h3").evaluateAll(
      (headings, token) =>
        headings
          .map(heading => heading.textContent ?? "")
          .filter(text => text.startsWith(token))
          .map(text => text.slice(token.length + 1)),
      TOKEN
    );
    const links = await page
      .locator('nav[aria-label="Pages"] a')
      .evaluateAll(anchors =>
        anchors.map(anchor => ({
          text: (anchor.textContent ?? "").trim(),
          href: anchor.getAttribute("href"),
          current: anchor.getAttribute("aria-current") === "page",
        }))
      );
    return {
      status: response?.status(),
      numbers,
      links,
      text: (await page.locator("body").textContent()) ?? "",
    };
  } finally {
    await context.close();
  }
}

/** The status `path` answers with, and where a redirect points, unfollowed. */
async function answer(
  request: APIRequestContext,
  path: string
): Promise<{ status: number; location: string | undefined }> {
  const response = await request.get(path, {
    headers: { cookie: "" },
    maxRedirects: 0,
  });
  return {
    status: response.status(),
    location: response.headers().location,
  };
}

test.describe("a Collection list split into pages", () => {
  test("serves each page at its own address, links them, and grows a page", async ({
    page,
    browser,
    request,
  }) => {
    // Signed in as the file's one sign-in; dev auto-login is blocked here.
    await signIn(page);
    const api = page.request;

    await publishEntries(
      api,
      Array.from({ length: 25 }, (_, index) => index + 1)
    );
    await ok(
      await api.post(ENTRIES, {
        data: {
          title: "Paged list",
          slug: LIST_SLUG,
          content: pagedList(TOKEN),
          status: "published",
        },
      }),
      "publishing the list's page"
    );
    await ok(
      await api.post(ENTRIES, {
        data: {
          title: "Empty paged list",
          slug: EMPTY_SLUG,
          content: pagedList(`no-such-${STAMP}`),
          status: "published",
        },
      }),
      "publishing the empty list's page"
    );

    const at = `/blocks/${LIST_SLUG}`;

    // 1 and 2: the first page, after the ten skipped, and its links.
    const first = await visit(browser, at);
    expect(first.status).toBe(200);
    expect(first.numbers).toEqual(
      Array.from({ length: 10 }, (_, index) => String(index + 11))
    );
    expect(first.links).toEqual([
      { text: "1", href: at, current: true },
      { text: "2", href: `${at}/page/2`, current: false },
      { text: "Next ›", href: `${at}/page/2`, current: false },
    ]);

    // The last page: the five entries left.
    const second = await visit(browser, `${at}/page/2`);
    expect(second.status).toBe(200);
    expect(second.numbers).toEqual(["21", "22", "23", "24", "25"]);
    expect(second.links).toEqual([
      { text: "‹ Previous", href: at, current: false },
      { text: "1", href: at, current: false },
      { text: "2", href: `${at}/page/2`, current: true },
    ]);

    // 3: one address per page.
    expect(await answer(request, `${at}/page/1`)).toEqual({
      status: 308,
      location: at,
    });
    for (const malformed of ["0", "02", "-1", "1.5", "two"]) {
      expect((await answer(request, `${at}/page/${malformed}`)).status).toBe(
        404
      );
    }
    expect((await answer(request, `${at}/page/3`)).status).toBe(404);

    // 4: six more entries take the list onto a third page.
    await publishEntries(api, [26, 27, 28, 29, 30, 31]);
    await expect
      .poll(async () => (await answer(request, `${at}/page/3`)).status, {
        timeout: 30_000,
      })
      .toBe(200);
    const third = await visit(browser, `${at}/page/3`);
    expect(third.numbers).toEqual(["31"]);
    expect(third.links.at(-1)).toEqual({
      text: "3",
      href: `${at}/page/3`,
      current: true,
    });

    // 5: nothing matches: the empty state at its own address, nothing after.
    const empty = await visit(browser, `/blocks/${EMPTY_SLUG}`);
    expect(empty.status).toBe(200);
    expect(empty.text).toContain(EMPTY_TEXT);
    expect(empty.links).toEqual([]);
    expect((await answer(request, `/blocks/${EMPTY_SLUG}/page/2`)).status).toBe(
      404
    );
  });
});
