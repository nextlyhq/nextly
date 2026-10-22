/**
 * A release's own page in a real browser: its documents by title, grouped by
 * collection, each with its readiness, and the documents its reader may not
 * view as a count.
 *
 * The reader is a user of their own, who may read Posts and Authors but not
 * History notes. They add one post themselves and then lose the right to
 * publish posts, which is the problem: the release acts on each document as
 * whoever added it, so that post can no longer go live.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";

/**
 * What the reader may do, before they lose the right to publish posts.
 * Publishing a document is an edit of it, so each collection's update comes
 * with its publish.
 */
const READER = [
  "read-content-releases",
  "create-content-releases",
  "read-posts",
  "update-posts",
  "publish-posts",
  "unpublish-posts",
  "read-authors",
  "update-authors",
  "publish-authors",
  "unpublish-authors",
];

/** A document in `collection`, answering its id. */
async function entry(
  api: APIRequestContext,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await api.post(`${API}/collections/${collection}/entries`, { data })
  );
  return item.id;
}

/** Put a document in a release, as whoever `api` is signed in as. */
async function add(
  api: APIRequestContext,
  releaseId: string,
  collection: string,
  entryId: string
): Promise<void> {
  await ok(
    await api.post(`${API}/releases/${releaseId}/members`, {
      data: {
        scopeKind: "collection",
        scopeSlug: collection,
        entryId,
        action: "publish",
      },
    })
  );
}

test.describe("a release's page", () => {
  let reader: LimitedUser;
  let page: Page;
  let releaseId: string;
  const ids: string[] = [];

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE,
    });
    try {
      const stamp = `${Date.now()}`;
      reader = await signInAsLimitedUser(browser, admin, baseURL, READER);

      const ready = await entry(admin, "posts", {
        title: `Ready post ${stamp}`,
        slug: `ready-post-${stamp}`,
      });
      const stuck = await entry(admin, "posts", {
        title: `Stuck post ${stamp}`,
        slug: `stuck-post-${stamp}`,
      });
      const author = await entry(admin, "authors", {
        title: `Ada ${stamp}`,
        slug: `ada-${stamp}`,
      });
      const note = await entry(admin, "history-notes", {
        title: `Private note ${stamp}`,
      });
      ids.push(ready, stuck, author, note);

      const { item } = await ok<{ item: { id: string } }>(
        await admin.post(`${API}/releases`, {
          data: { title: `Release page ${stamp}` },
        })
      );
      releaseId = item.id;
      await add(admin, releaseId, "posts", ready);
      await add(admin, releaseId, "authors", author);
      await add(admin, releaseId, "history-notes", note);
      // Added by the reader, who then may no longer publish posts: the
      // release could not put it live as them.
      await add(reader.context.request, releaseId, "posts", stuck);
      const permissions = (
        await ok<{
          items: Array<{ id: string; slug: string }>;
        }>(await admin.get(`${API}/permissions?page=1&limit=1000`))
      ).items;
      await ok(
        await admin.patch(`${API}/roles/${reader.roleId}`, {
          data: {
            permissionIds: READER.filter(slug => slug !== "publish-posts").map(
              slug => {
                const found = permissions.find(p => p.slug === slug);
                if (!found) throw new Error(`[e2e] No permission "${slug}".`);
                return found.id;
              }
            ),
          },
        })
      );
    } finally {
      await admin.dispose();
    }
    page = await reader.context.newPage();
  });

  test.afterAll(async () => {
    await reader?.context.close();
  });

  test("names its documents by title in their collections, with their readiness, and counts those the reader can't view", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoAdmin(page, `/releases/${releaseId}`);

    const posts = page.getByRole("group", { name: /^Posts/ });
    const authors = page.getByRole("group", { name: /^Authors/ });
    const notes = page.getByRole("group", { name: /^History notes/ });

    const readyRow = posts.getByRole("listitem", { name: /^Ready post / });
    const stuckRow = posts.getByRole("listitem", { name: /^Stuck post / });
    await expect(readyRow).toBeVisible();
    await expect(readyRow.getByText("Ready", { exact: true })).toBeVisible();
    await expect(stuckRow.getByText("Needs a fix")).toBeVisible();
    await expect(
      stuckRow.getByText("The person who added it may no longer publish it")
    ).toBeVisible();
    await expect(
      authors.getByRole("listitem", { name: /^Ada / }).getByText("Ready", {
        exact: true,
      })
    ).toBeVisible();

    // The note is counted in its collection, and never named.
    await expect(
      notes.getByText(
        "1 document can't be shown (deleted, or you can't view it)"
      )
    ).toBeVisible();
    await expect(page.getByText(/Private note/)).toHaveCount(0);
    // No document is named by its id.
    const text = (await page.locator("main").textContent()) ?? "";
    for (const id of ids) expect(text).not.toContain(id);

    // Four documents, the hidden one among them, and one needs a fix.
    await expect(page.getByText("3 of 4 ready.")).toBeVisible();

    await expectNoAxeViolations(page);
  });
});
