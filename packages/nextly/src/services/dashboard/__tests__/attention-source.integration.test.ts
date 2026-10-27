/**
 * Needs attention's source and the bounded count it reads through, against a
 * real database, as callers with different read rights.
 *
 * What only a database can settle: that each kind counts exactly what its
 * domain says is waiting, as the caller reads it; that a part the caller may
 * not read is absent rather than zero; that the work stops at its bounds and
 * says so; and that the bounded count is the same read as the exact one, the
 * same rows, refusals and narrowing, stopping early.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  RELEASE_MEMBERS_TABLE,
  RELEASES_TABLE,
} from "../../../domains/releases/release-tables";
import { releaseMemberKey } from "../../../domains/releases/release-member-key";
import { refreshContentSources } from "../../../domains/widgets/collection-widgets";
import type { WidgetQuery } from "../../../domains/widgets/query";
import { sourceResolver } from "../../../domains/widgets/resolved-sources";
import { isUnavailableSourceRefusal } from "../../../domains/widgets/sources";
import { ATTENTION_SOURCE_ID } from "../../../domains/widgets/system-source-ids";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { CollectionsHandler } from "../../collections-handler";
import {
  ATTENTION_COUNT_CAP,
  ATTENTION_MAX_COLLECTIONS,
} from "../attention-source";
import type { ReadCaller } from "../readable-resources";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** One more collection than a kind counts, so the bound is reached. */
const COLLECTIONS = Array.from(
  { length: ATTENTION_MAX_COLLECTIONS + 1 },
  (_, i) => `att${String(i + 1).padStart(2, "0")}`
);
const SECRET = "attsecret";
const HOME = "atthome";

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

const QUERY: WidgetQuery = {
  source: ATTENTION_SOURCE_ID,
  op: "groupBy",
  groupBy: "item",
};

async function attention(caller: ReadCaller) {
  const resolve = sourceResolver(ATTENTION_SOURCE_ID);
  if (!resolve) throw new Error("system:attention is not registered");
  return resolve(QUERY, caller);
}

/** An answer without the instant it was read at, to compare two answers. */
function withoutInstant(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result;
  const rest: Record<string, unknown> = { ...result };
  delete rest.asOf;
  return rest;
}

/** The buckets of an answer, by key. */
async function bucketsFor(caller: ReadCaller) {
  const result = await attention(caller);
  if (result.op !== "groupBy") throw new Error(result.op);
  return new Map(
    result.buckets.map(bucket => [
      bucket.value,
      { count: bucket.count, atLeast: bucket.atLeast === true },
    ])
  );
}

describe.each(getConfiguredTestDialects())(
  "Needs attention's source (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      current = await createTestNextly({
        dialect,
        collections: [...COLLECTIONS, SECRET].map(slug =>
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" })],
          })
        ),
        singles: [
          defineSingle({
            slug: HOME,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      const t = current;
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      const ids = new Map<string, string>();
      for (const slug of [...COLLECTIONS, SECRET]) {
        const created = await handler.createEntry(
          { collectionName: slug, overrideAccess: true },
          { title: `In ${slug}`, status: "published" }
        );
        const id = (created.data as { id?: string } | undefined)?.id;
        if (typeof id !== "string") throw new Error(`no id in ${slug}`);
        ids.set(slug, id);
        // A working draft: every collection has one entry with unpublished changes.
        await t.adapter.insert(VERSIONS_TABLE, {
          id: crypto.randomUUID(),
          scopeKind: "collection",
          scopeSlug: slug,
          entryId: id,
          versionNo: null,
          status: "draft",
          isAutosave: false,
          snapshot: JSON.stringify({ title: "edited" }),
          label: null,
          locale: null,
          sourceVersionNo: null,
          createdBy: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        });
      }
      // The Single, published and then edited: one pending change.
      const trusted = new Nextly();
      await trusted.updateSingle({
        slug: HOME,
        data: { heading: "Live", status: "published" },
      });
      await trusted.updateSingle({ slug: HOME, data: { heading: "Edited" } });
      // Every dashboard request rebuilds the content sources before it resolves
      // a card, and boot publishes none; these tests call the resolver
      // directly, so they rebuild them as a request would.
      await refreshContentSources();
      return { t, ids };
    }

    /** A release in a state at an instant, straight into its table. */
    async function release(t: TestNextly, at: Date, entryId: string) {
      const id = crypto.randomUUID();
      const now = new Date();
      await t.adapter.insert(RELEASES_TABLE, {
        id,
        title: `Release ${id.slice(0, 8)}`,
        description: null,
        scheduledAt: at,
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
        scopeSlug: COLLECTIONS[0],
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

    const read = (slugs: readonly string[]) => slugs.map(s => `read-${s}`);
    const first20 = COLLECTIONS.slice(0, ATTENTION_MAX_COLLECTIONS);

    it("counts each kind as the caller reads it, and stops at the collection bound with a floor", async () => {
      const { t, ids } = await boot();
      await release(
        t,
        new Date(Date.now() + 2 * DAY),
        ids.get(COLLECTIONS[0])!
      );
      await release(
        t,
        new Date(Date.now() - 60 * MINUTE),
        ids.get(COLLECTIONS[1])!
      );
      const everything = scoped([
        ...read(COLLECTIONS),
        `read-${HOME}`,
        "read-content-releases",
      ]);
      const buckets = await bucketsFor(everything);

      // Twenty-one readable collections: the first twenty, in slug order, are
      // counted, and the kind says it is a floor.
      expect(buckets.get("unpublished")).toEqual({
        count: ATTENTION_MAX_COLLECTIONS + 1,
        atLeast: true,
      });
      for (const slug of first20) {
        expect(buckets.get(`unpublished:collection:${slug}`)).toEqual({
          count: 1,
          atLeast: false,
        });
      }
      expect(buckets.has(`unpublished:collection:${COLLECTIONS[20]}`)).toBe(
        false
      );
      // The Single, from the versions domain's walk.
      expect(buckets.get(`unpublished:single:${HOME}`)).toEqual({
        count: 1,
        atLeast: false,
      });
      // The release due in two days, and the one an hour overdue.
      expect(buckets.get(`scheduled:collection:${COLLECTIONS[0]}`)?.count).toBe(
        1
      );
      expect(buckets.get("overdue")).toEqual({ count: 1, atLeast: false });
      // A collection the caller may not read is never counted.
      expect(
        [...buckets.keys()].some(key => key !== null && key.includes(SECRET))
      ).toBe(false);
    });

    it("counts exactly twenty readable collections whole, an unreadable one adding nothing to the bound", async () => {
      await boot();
      const twenty = scoped([...read(first20), `read-${HOME}`]);
      const buckets = await bucketsFor(twenty);
      // Twenty collections and the Single, every one whole: the twenty-first
      // collection and the secret one exist, but this caller may read neither.
      expect(buckets.get("unpublished")).toEqual({
        count: ATTENTION_MAX_COLLECTIONS + 1,
        atLeast: false,
      });
    });

    it("answers a caller who may not read releases exactly as a site with nothing due answers", async () => {
      const { t, ids } = await boot();
      const readsReleases = scoped([...read(first20), "read-content-releases"]);
      const before = JSON.stringify(
        withoutInstant(await attention(readsReleases))
      );

      await release(t, new Date(Date.now() + DAY), ids.get(COLLECTIONS[0])!);
      await release(
        t,
        new Date(Date.now() - 60 * MINUTE),
        ids.get(COLLECTIONS[1])!
      );
      const barred = scoped(read(first20));
      // The control: releases are now due, and a reader who may see them does.
      expect(
        JSON.stringify(withoutInstant(await attention(readsReleases)))
      ).not.toBe(before);
      // The barred reader's answer is byte for byte the empty site's, apart
      // from the instant each answer was read at.
      expect(JSON.stringify(withoutInstant(await attention(barred)))).toBe(
        before
      );
    });

    it("never reads unread lists as clear: nothing in the twenty counted, more left unread, is a floor of zero", async () => {
      const { t } = await boot();
      // Nothing pending in the first twenty collections; the twenty-first,
      // past the bound, still holds a pending change.
      for (const slug of first20) {
        await t.adapter.delete(VERSIONS_TABLE, {
          and: [{ column: "scopeSlug", op: "=", value: slug }],
        });
      }
      const buckets = await bucketsFor(scoped(read(COLLECTIONS)));
      // The kind stays, as a zero floor, so the card cannot call it clear.
      expect(buckets.get("unpublished")).toEqual({ count: 0, atLeast: true });
      expect(
        [...buckets.keys()].filter(key => key?.startsWith("unpublished:"))
      ).toEqual([]);
    });

    it("carries no more kinds and parts than the query's limit, says so, and dates the answer", async () => {
      await boot();
      const resolve = sourceResolver(ATTENTION_SOURCE_ID);
      if (!resolve) throw new Error("system:attention is not registered");
      const result = await resolve(
        { ...QUERY, limit: 3 },
        scoped([...read(COLLECTIONS), `read-${HOME}`])
      );
      if (result.op !== "groupBy") throw new Error(result.op);
      // The kind, then the parts with most waiting, up to the limit.
      expect(result.buckets).toHaveLength(3);
      expect(result.buckets.map(bucket => bucket.value)).toContain(
        "unpublished"
      );
      expect(result.truncated).toBe(true);
      // The kind reached its collection bound, so its own bucket is a floor;
      // the result-level flag, which claims EVERY bucket is one, is not set.
      expect(
        result.buckets.find(bucket => bucket.value === "unpublished")?.atLeast
      ).toBe(true);
      expect("atLeast" in result).toBe(false);
      // The instant the answer was computed at, which a card links from.
      expect(new Date(result.asOf ?? "").toISOString()).toBe(result.asOf);
    });

    it("is not available, never all clear, to a caller who may read none of what it counts", async () => {
      await boot();
      const error = await attention(scoped([])).catch((e: unknown) => e);
      expect(isUnavailableSourceRefusal(error)).toBe(true);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the bounded count (%s)",
  (dialect: TestDialect) => {
    const SLUG = "attcap";

    async function boot() {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: SLUG,
            fields: [
              text({ name: "title" }),
              text({ name: "secret", access: { read: () => false } }),
            ],
          }),
        ],
      });
      const handler = current.getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      return { handler };
    }

    async function seed(handler: CollectionsHandler, count: number) {
      for (let i = 0; i < count; i += 1) {
        await handler.createEntry(
          { collectionName: SLUG, overrideAccess: true },
          { title: `Entry ${i}`, secret: "s" }
        );
      }
    }

    const reader = {
      user: { id: "admin", roles: ["super-admin"] },
      authenticatedScope: {
        actorType: "apiKey" as const,
        permissions: [`read-${SLUG}`],
      },
    };

    it("is exact up to the cap and a floor past it", async () => {
      const { handler } = await boot();
      await seed(handler, ATTENTION_COUNT_CAP);
      const atCap = await handler.countEntriesUpTo({
        collectionName: SLUG,
        cap: ATTENTION_COUNT_CAP,
        ...reader,
      });
      expect(atCap.data).toEqual({
        count: ATTENTION_COUNT_CAP,
        atLeast: false,
      });

      await seed(handler, 1);
      const past = await handler.countEntriesUpTo({
        collectionName: SLUG,
        cap: ATTENTION_COUNT_CAP,
        ...reader,
      });
      expect(past.data).toEqual({ count: ATTENTION_COUNT_CAP, atLeast: true });
      // The exact count beside it, which the floor stands for.
      const exact = await handler.countEntries({
        collectionName: SLUG,
        ...reader,
      });
      expect(exact.data?.totalDocs).toBe(ATTENTION_COUNT_CAP + 1);
    });

    it("counts every row when nothing narrows the read", async () => {
      // A trusted read of a collection with no lifecycle, no hooks and no
      // filter: the plan holds no condition at all, and both counts must read
      // the whole table rather than none of it.
      const { handler } = await boot();
      await seed(handler, 3);
      const exact = await handler.countEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      expect(exact.data?.totalDocs).toBe(3);
      const bounded = await handler.countEntriesUpTo({
        collectionName: SLUG,
        overrideAccess: true,
        cap: ATTENTION_COUNT_CAP,
      });
      expect(bounded.data).toEqual({ count: 3, atLeast: false });
    });

    it("counts the rows a read hook narrows to, as the exact count does", async () => {
      const { handler } = await boot();
      await seed(handler, 5);
      const narrow: HookHandler = ctx => ({
        ...(ctx.data as Record<string, unknown>),
        title: { in: ["Entry 0", "Entry 1"] },
      });
      registerHook("beforeRead", SLUG, narrow);
      try {
        const bounded = await handler.countEntriesUpTo({
          collectionName: SLUG,
          cap: ATTENTION_COUNT_CAP,
          ...reader,
        });
        const exact = await handler.countEntries({
          collectionName: SLUG,
          ...reader,
        });
        expect(exact.data?.totalDocs).toBe(2);
        expect(bounded.data).toEqual({ count: 2, atLeast: false });
      } finally {
        unregisterHook("beforeRead", SLUG, narrow);
      }
    });

    it("refuses a filter on a field the caller may not read, as the exact count does", async () => {
      const { handler } = await boot();
      await seed(handler, 2);
      const where = { secret: { equals: "s" } };
      const bounded = await handler.countEntriesUpTo({
        collectionName: SLUG,
        cap: ATTENTION_COUNT_CAP,
        where,
        ...reader,
      });
      const exact = await handler.countEntries({
        collectionName: SLUG,
        where,
        ...reader,
      });
      expect(exact.success).toBe(false);
      expect(bounded.success).toBe(false);
      expect([bounded.statusCode, bounded.message]).toEqual([
        exact.statusCode,
        exact.message,
      ]);
    });
  }
);
