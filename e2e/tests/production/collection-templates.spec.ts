import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { answeredNotFound } from "../support/not-found";
import { test } from "../support/visible";

/**
 * A collection's entries served under its template address, from a
 * PRODUCTION build.
 *
 * The playground declares `posts` at `/blog` and serves every path from the
 * page builder's address store through one content route. A published Posts
 * template draws each published post at `/blog/<its slug>`, the post as its
 * bindings' source, with its own metadata from the template's SEO settings;
 * a draft post, and a post once unpublished, answer not found. Everything is
 * authored through the API the editor writes with, and read back as an
 * anonymous visitor, because the claim is about what the product serves for
 * content it accepted.
 *
 * @module tests/production/collection-templates
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

const API = "/admin/api";

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);
const FIRST = { title: `First post ${STAMP}`, slug: `first-${STAMP}` };
const SECOND = { title: `Second post ${STAMP}`, slug: `second-${STAMP}` };
const DRAFT = { title: `Draft post ${STAMP}`, slug: `draft-${STAMP}` };

/** The Posts template: the post's title as its heading, and in its title. */
const TEMPLATE = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "post-title",
      type: "core/heading",
      version: 1,
      props: { text: "Untitled", level: "h1" },
      bindings: { text: { $bind: "title", fallback: "Untitled" } },
    },
  ],
  settings: { seo: { title: [{ $bind: "title" }, " | Blog"] } },
};

/** Fail with the server's message rather than with a bare status code. */
async function idOf(response: APIResponse, what: string): Promise<string> {
  if (!response.ok()) {
    throw new Error(
      `${what} failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { item?: { id?: unknown } };
  const id = body.item?.id;
  if (typeof id !== "string") {
    throw new Error(`${what} answered no id: ${JSON.stringify(body)}`);
  }
  return id;
}

/** A path as an anonymous visitor gets it. */
async function visit(
  request: APIRequestContext,
  path: string
): Promise<APIResponse> {
  return await request.get(path, { headers: { cookie: "" } });
}

/** Whether `path` answers an anonymous visitor not found. */
async function notFoundAt(
  request: APIRequestContext,
  path: string
): Promise<boolean> {
  const response = await visit(request, path);
  return answeredNotFound({
    status: response.status(),
    html: await response.text(),
  });
}

test.describe("a collection's entries under its template address", () => {
  test("serves each published post at /blog/<slug> with its own metadata, and a draft or unpublished one as not found", async ({
    page,
    request,
  }) => {
    // 1. Sign in through the real form; dev auto-login is blocked here.
    await page.goto("/admin");
    await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
    await page
      .getByRole("textbox", { name: /password/i })
      .fill(DEV_USER.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
    const api = page.request;

    // 2. The Posts template, published, then two published posts and a draft.
    await idOf(
      await api.post(`${API}/collections/templates/entries`, {
        data: {
          title: `Posts ${STAMP}`,
          collection: "posts",
          content: TEMPLATE,
          status: "published",
        },
      }),
      "publishing the Posts template"
    );
    const first = await idOf(
      await api.post(`${API}/collections/posts/entries`, {
        data: { ...FIRST, status: "published" },
      }),
      "publishing the first post"
    );
    await idOf(
      await api.post(`${API}/collections/posts/entries`, {
        data: { ...SECOND, status: "published" },
      }),
      "publishing the second post"
    );
    await idOf(
      await api.post(`${API}/collections/posts/entries`, {
        data: { ...DRAFT, status: "draft" },
      }),
      "saving the draft post"
    );

    // 3. Each published post at its own address, drawn with the template,
    //    with its own title in the head.
    for (const post of [FIRST, SECOND]) {
      const response = await visit(request, `/blog/${post.slug}`);
      expect(response.status(), `/blog/${post.slug}`).toBe(200);
      const html = await response.text();
      expect(html).toContain(`<h1`);
      expect(html).toContain(post.title);
      expect(html).toContain(`<title>${post.title} | Blog</title>`);
    }
    // Neither post's page shows the other's.
    expect(
      await (await visit(request, `/blog/${FIRST.slug}`)).text()
    ).not.toContain(SECOND.title);

    // 4. A draft holds no address, and is not found.
    expect(await notFoundAt(request, `/blog/${DRAFT.slug}`)).toBe(true);

    // 5. Unpublished, a post gives its address up and is not found.
    const unpublished = await api.patch(
      `${API}/collections/posts/entries/${first}`,
      // Replaces what is stored: this edit is not about stale ones.
      { data: { status: "draft", _overwrite: true } }
    );
    expect(unpublished.ok(), await unpublished.text()).toBe(true);
    expect(await notFoundAt(request, `/blog/${FIRST.slug}`)).toBe(true);
    expect((await visit(request, `/blog/${SECOND.slug}`)).status()).toBe(200);
  });
});
