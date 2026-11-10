import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { answeredNotFound } from "../support/not-found";
import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * A post's page refreshes when what it is drawn from changes, in a
 * PRODUCTION build.
 *
 * The playground serves `/blog/<slug>` through its one content route. That
 * route asks the address store who holds a path on every request, but it
 * reads the collection's published template and the post itself through
 * Next's data cache, each tagged with its collection. So a visit fills the
 * cache, and only a write that expires the right tag shows a change before
 * the cached read's lifetime runs out (30 seconds in a production process
 * without Nextly's cache handlers, as here). Each step below visits first,
 * makes one change through the API the editor writes with, then polls as an
 * anonymous visitor for well under that lifetime:
 *
 * - editing the template refreshes a post already visited;
 * - editing the post's title refreshes its page;
 * - taking the Public role's read of posts away, as an owner does on the
 *   role screen, makes its address answer not found. A change to what a role
 *   grants expires every content tag, and the read of the post, refused
 *   afresh, is cached as the refusal, so this too is well within the
 *   lifetime.
 *
 * @module tests/production/collection-templates-refresh
 */

const API = "/admin/api";

/** Distinctive per run, so finding a text cannot be a coincidence. */
const STAMP = Date.now().toString(36);
const POST = { title: `Refreshed post ${STAMP}`, slug: `refreshed-${STAMP}` };
const RENAMED = `Renamed post ${STAMP}`;
const FIRST_MARK = `Edition one ${STAMP}`;
const SECOND_MARK = `Edition two ${STAMP}`;

/**
 * How long a refresh by a write may take: a few seconds of rendering, and
 * well under the 30 seconds after which a cached read expires on its own, so
 * a page refreshed only by that expiry fails the step.
 */
const WRITE_REFRESH_MS = 12_000;

/** The Posts template: a fixed mark, and the post's title as its heading. */
function template(mark: string, suffix: string) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id: "template-mark",
        type: "core/heading",
        version: 1,
        props: { text: mark, level: "h2" },
      },
      {
        id: "post-title",
        type: "core/heading",
        version: 1,
        props: { text: "Untitled", level: "h1" },
        bindings: { text: { $bind: "title", fallback: "Untitled" } },
      },
    ],
    settings: { seo: { title: [{ $bind: "title" }, suffix] } },
  };
}

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

async function expectOk(response: APIResponse, what: string): Promise<void> {
  expect(response.ok(), `${what}: ${await response.text()}`).toBe(true);
}

/** A path as an anonymous visitor gets it: its status, and its text. */
async function visit(
  request: APIRequestContext,
  path: string
): Promise<{ status: number; html: string }> {
  const response = await request.get(path, { headers: { cookie: "" } });
  return { status: response.status(), html: await response.text() };
}

/**
 * What a visitor reads at `path`, polled until `served` says it shows the
 * change, for at most `timeout`. Fails with what was served last.
 */
async function servedWithin(
  request: APIRequestContext,
  path: string,
  timeout: number,
  served: (page: { status: number; html: string }) => boolean
): Promise<number> {
  const started = Date.now();
  let last = { status: 0, html: "" };
  await expect
    .poll(
      async () => {
        last = await visit(request, path);
        return served(last);
      },
      {
        timeout,
        intervals: [250, 500, 1_000],
        message: `${path} still served the earlier page`,
      }
    )
    .toBe(true)
    .catch((error: unknown) => {
      throw new Error(
        `${String(error)}\nlast served: ${last.status}, titled ${String(titleOf(last.html))}${last.html.includes("$RX(") ? ", with a rendering error" : ""}`
      );
    });
  return Date.now() - started;
}

/** The text of the page's `<title>`. */
function titleOf(html: string): string | undefined {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1];
}

interface RolePermission {
  id: string;
  action: string;
  resource: string;
}

test.describe("a post's page as its template, the post and the access to it change", () => {
  test("refreshes after the template and the post are edited, and answers not found once visitors may not read posts", async ({
    page,
    request,
  }) => {
    // Three refreshes by a write, each well within a cached read's lifetime.
    test.setTimeout(120_000);
    // Signed in as the file's one sign-in; dev auto-login is blocked here.
    await signIn(page);
    const api = page.request;

    // Visitors read posts through the Public role, which boot grants the read
    // because `posts` lets anyone read. It is given here too, as an owner
    // gives it in the admin, so the steps below hold whatever an earlier spec
    // left, and every permission the role held is given back at the end.
    const roles = await api.get(`${API}/roles?limit=100`);
    await expectOk(roles, "listing the roles");
    const publicRole = (
      (await roles.json()) as { items: Array<{ id: string; builtIn?: string }> }
    ).items.find(role => role.builtIn === "public");
    if (publicRole === undefined) throw new Error("no Public role listed");
    const rolePermissions = `${API}/roles/${publicRole.id}/permissions`;
    const held = await api.get(rolePermissions);
    await expectOk(held, "reading the Public role's permissions");
    const heldBefore = (
      (await held.json()) as { permissions: RolePermission[] }
    ).permissions.map(permission => permission.id);
    const listed = await api.get(`${API}/permissions?page=1&limit=1000`);
    await expectOk(listed, "listing the permissions");
    const readPosts = (
      (await listed.json()) as { items: Array<{ id: string; slug: string }> }
    ).items.find(permission => permission.slug === "read-posts")?.id;
    if (readPosts === undefined) throw new Error("read-posts is not seeded");
    const setPublic = async (ids: readonly string[], what: string) =>
      await expectOk(
        await api.patch(rolePermissions, { data: { permissionIds: ids } }),
        what
      );
    const readable = [...new Set([...heldBefore, readPosts])];
    await setPublic(readable, "letting visitors read posts");
    try {
      // The Posts template and one post, both published.
      const templateId = await idOf(
        await api.post(`${API}/collections/templates/entries`, {
          data: {
            title: `Posts ${STAMP}`,
            collection: "posts",
            content: template(FIRST_MARK, " | Blog"),
            status: "published",
          },
        }),
        "publishing the Posts template"
      );
      const postId = await idOf(
        await api.post(`${API}/collections/posts/entries`, {
          data: { ...POST, status: "published" },
        }),
        "publishing the post"
      );
      const path = `/blog/${POST.slug}`;

      await test.step("editing the template refreshes a post already visited", async () => {
        // Visited first, so the template and the post are cached as read.
        const before = await visit(request, path);
        expect(before.status, path).toBe(200);
        expect(before.html).toContain(FIRST_MARK);
        expect(titleOf(before.html)).toBe(`${POST.title} | Blog`);

        await expectOk(
          await api.patch(
            `${API}/collections/templates/entries/${templateId}`,
            {
              data: {
                content: template(SECOND_MARK, " | Journal"),
                status: "published",
                // Replaces what is stored: this edit is not about stale ones.
                _overwrite: true,
              },
            }
          ),
          "editing the template"
        );

        await servedWithin(
          request,
          path,
          WRITE_REFRESH_MS,
          ({ status, html }) =>
            status === 200 &&
            html.includes(SECOND_MARK) &&
            !html.includes(FIRST_MARK) &&
            titleOf(html) === `${POST.title} | Journal`
        );
      });

      await test.step("editing the post's title refreshes its page", async () => {
        const before = await visit(request, path);
        expect(before.status, path).toBe(200);
        expect(before.html).toContain(POST.title);

        await expectOk(
          await api.patch(`${API}/collections/posts/entries/${postId}`, {
            data: { title: RENAMED, status: "published", _overwrite: true },
          }),
          "renaming the post"
        );

        await servedWithin(
          request,
          path,
          WRITE_REFRESH_MS,
          ({ status, html }) =>
            status === 200 &&
            html.includes(RENAMED) &&
            !html.includes(POST.title) &&
            titleOf(html) === `${RENAMED} | Journal`
        );
      });

      await test.step("taking visitors' read of posts away makes its address not found", async () => {
        expect((await visit(request, path)).status, path).toBe(200);
        await setPublic(
          readable.filter(id => id !== readPosts),
          "taking visitors' read of posts away"
        );
        const waited = await servedWithin(
          request,
          path,
          WRITE_REFRESH_MS,
          answeredNotFound
        );
        test.info().annotations.push({
          type: "not found after",
          description: `${String(waited)} ms`,
        });
      });
    } finally {
      // Every other spec meets visitors as the Public role left them.
      await setPublic(
        heldBefore,
        "giving the Public role its permissions back"
      );
    }
  });
});
