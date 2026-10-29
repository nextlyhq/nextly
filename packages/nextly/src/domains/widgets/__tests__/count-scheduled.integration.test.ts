/**
 * The Count card's scheduled figure, against a real database, as callers with
 * different read rights.
 *
 * What only a database can settle: that the figure counts exactly the entries
 * a scheduled release will publish, through the entry list's own condition;
 * that it reads zero where the caller has a release to read and none holds
 * these entries; and that a caller barred from releases is answered exactly as
 * a site without releases is, "not available", never zero.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { releaseMemberKey } from "../../releases/release-member-key";
import {
  RELEASE_MEMBERS_TABLE,
  RELEASES_TABLE,
} from "../../releases/release-tables";
import { refreshContentSources } from "../content-sources";
import { CORE_WIDGETS } from "../core-widgets";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import { isUnavailableSourceRefusal } from "../sources";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "cntsch_posts";
const PAGES = "cntsch_pages";
const DAY = 24 * 60 * 60 * 1000;

/**
 * A super admin's API key holding `permissions`: judged on its own scope, so
 * the bypass cannot widen what it reads.
 */
function scoped(permissions: string[]): ReadCaller {
  return {
    user: { id: "admin", roles: ["super-admin"] },
    authenticatedScope: { actorType: "apiKey", permissions },
  };
}

const READS_POSTS = [`read-${POSTS}`, `read-${PAGES}`];
const READS_RELEASES = [...READS_POSTS, "read-content-releases"];

/** Count's scheduled cell, as core declares it, set to `collection`. */
function scheduledQuery(collection: string) {
  const count = CORE_WIDGETS.find(widget => widget.id === "core/count");
  const cell = (count?.cells ?? []).find(
    candidate => "query" in candidate && candidate.key === "scheduled"
  );
  if (cell === undefined || !("query" in cell)) {
    throw new Error('core/count has no cell "scheduled"');
  }
  return validateWidgetQuery({
    ...cell.query,
    source: `collection:${collection}`,
  });
}

/** The scheduled figure for `caller`, or the refusal it was answered with. */
async function scheduled(caller: ReadCaller, collection = POSTS) {
  try {
    const result = await executeWidgetQuery(scheduledQuery(collection), caller);
    if (result.op !== "count") throw new Error(result.op);
    return { total: result.total };
  } catch (error) {
    if (!isUnavailableSourceRefusal(error)) throw error;
    return {
      unavailable: true,
      message: (error as { publicMessage?: string }).publicMessage,
    };
  }
}

describe.each(getConfiguredTestDialects())(
  "the Count card's scheduled figure (%s)",
  (dialect: TestDialect) => {
    /** Two posts, one page; `ids` by title. */
    async function boot() {
      current = await createTestNextly({
        dialect,
        collections: [POSTS, PAGES].map(slug =>
          defineCollection({
            slug,
            status: true,
            fields: [text({ name: "title" })],
          })
        ),
      });
      const t = current;
      const handler = t.getService("collectionsHandler") as unknown as {
        createEntry: (
          p: Record<string, unknown>,
          data: Record<string, unknown>
        ) => Promise<{ data?: { id?: string } | null }>;
      };
      const ids = new Map<string, string>();
      for (const [collection, title] of [
        [POSTS, "held"],
        [POSTS, "free"],
        [PAGES, "page"],
      ] as const) {
        const created = await handler.createEntry(
          { collectionName: collection, overrideAccess: true },
          { title, status: "draft" }
        );
        const id = created.data?.id;
        if (typeof id !== "string") throw new Error(`no id for ${title}`);
        ids.set(title, id);
      }
      await refreshContentSources();
      return { t, ids };
    }

    /** A scheduled release a day out, publishing one entry of `collection`. */
    async function release(t: TestNextly, collection: string, entryId: string) {
      const id = crypto.randomUUID();
      const now = new Date();
      await t.adapter.insert(RELEASES_TABLE, {
        id,
        title: `Release ${id.slice(0, 8)}`,
        description: null,
        scheduledAt: new Date(now.getTime() + DAY),
        timezone: "UTC",
        state: "scheduled",
        publishedAt: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        revision: 0,
      });
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: collection,
        entryId,
        locale: null,
      };
      await t.adapter.insert(RELEASE_MEMBERS_TABLE, {
        id: crypto.randomUUID(),
        releaseId: id,
        ...ref,
        action: "publish",
        memberKey: releaseMemberKey(id, ref),
        createdBy: null,
        createdAt: now,
      });
    }

    it("counts exactly the entries a scheduled release will publish", async () => {
      const { t, ids } = await boot();
      await release(t, POSTS, ids.get("held")!);
      expect(await scheduled(scoped(READS_RELEASES))).toEqual({ total: 1 });
    });

    it("reads zero where the caller has a release to read and none holds these entries", async () => {
      const { t, ids } = await boot();
      // The one release publishes a page, not a post.
      await release(t, PAGES, ids.get("page")!);
      expect(await scheduled(scoped(READS_RELEASES))).toEqual({ total: 0 });
    });

    it("answers a caller barred from releases exactly as a site without releases, never as zero", async () => {
      const { t, ids } = await boot();
      // No release yet: a reader who may read releases has none to read.
      const withoutReleases = await scheduled(scoped(READS_RELEASES));
      await release(t, POSTS, ids.get("held")!);
      // A release holds a post, and this reader may not read releases.
      const barred = await scheduled(scoped(READS_POSTS));
      expect(withoutReleases).toMatchObject({ unavailable: true });
      expect(barred).toEqual(withoutReleases);
    });
  }
);
