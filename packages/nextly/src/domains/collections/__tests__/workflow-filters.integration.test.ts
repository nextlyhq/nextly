/**
 * The workflow filters, `_pendingChange` and `_inRelease`, against a real
 * database, over REST as people with different read rights.
 *
 * What only a database can settle: that each condition keeps exactly the
 * entries its rule names on every dialect — the working-draft shape and not
 * any other version row, publishes and not unpublishes, releases still to run
 * and not those past their time or in another state, each entry once however
 * many languages or releases hold it — and that the list and its count, the
 * number the dashboard shows and the page it links to, hold the same entries.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { readClientWhere } from "../../../dispatcher/helpers/validation";
import type { AccessRuleContext } from "../../../shared/types/access";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import { keyHolding, rest } from "../../releases/__tests__/helpers/rest-key";
import {
  RELEASE_MEMBERS_TABLE,
  RELEASES_TABLE,
} from "../../releases/release-tables";
import { releaseMemberKey } from "../../releases/release-member-key";

let current: TestNextly | undefined;

/** Each run of the posts' read hook, so a case can see whether one ran. */
const readHookRuns: string[] = [];

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Hooks register into the process-wide registry; cleared so one boot's
  // handler cannot answer for the next.
  resetHookRegistry();
  readHookRuns.length = 0;
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: ["posts", "secrets"].map(slug =>
      defineCollection({
        slug,
        status: true,
        versions: { drafts: true },
        // A read hook that only records that it ran: a refusal that comes
        // after the hooks would come after whatever they do.
        hooks: {
          beforeRead: [
            async () => {
              readHookRuns.push(slug);
            },
          ],
        },
        fields: [text({ name: "title" })],
      })
    ),
  });
  return current;
}

type Collection = "posts" | "secrets" | "notes" | "opennotes";

/** A published entry, through the ordinary write path; its id. */
async function entry(
  t: TestNextly,
  collection: Collection,
  title: string
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: collection, overrideAccess: true },
    { title, status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error(`no id for ${title}`);
  return id;
}

/** A version row of an entry, a working draft unless told otherwise. */
async function versionRow(
  t: TestNextly,
  collection: Collection,
  entryId: string,
  row: { locale?: string | null; versionNo?: number; isAutosave?: boolean }
): Promise<void> {
  await t.adapter.insert(VERSIONS_TABLE, {
    id: crypto.randomUUID(),
    scopeKind: "collection",
    scopeSlug: collection,
    entryId,
    versionNo: row.versionNo ?? null,
    status: "draft",
    isAutosave: row.isAutosave ?? false,
    snapshot: JSON.stringify({ title: "edited" }),
    label: null,
    locale: row.locale ?? null,
    sourceVersionNo: null,
    createdBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

/**
 * A release in the given state at the given instant, written straight into the
 * production table, because a schedule through the service refuses a time in
 * the past and the cases below need releases past their time.
 */
async function release(
  t: TestNextly,
  state: "draft" | "scheduled" | "blocked",
  at: Date | null
): Promise<string> {
  const id = crypto.randomUUID();
  const created = new Date();
  await t.adapter.insert(RELEASES_TABLE, {
    id,
    title: `Release ${id.slice(0, 8)}`,
    description: null,
    scheduledAt: at,
    timezone: "UTC",
    state,
    publishedAt: null,
    createdBy: null,
    createdAt: created,
    updatedAt: created,
    revision: 0,
  });
  return id;
}

/** A member of a release, in the production table. */
async function member(
  t: TestNextly,
  releaseId: string,
  collection: Collection,
  entryId: string,
  action: "publish" | "unpublish",
  locale: string | null = null
): Promise<void> {
  const ref = {
    scopeKind: "collection" as const,
    scopeSlug: collection,
    entryId,
    locale,
  };
  await t.adapter.insert(RELEASE_MEMBERS_TABLE, {
    id: crypto.randomUUID(),
    releaseId,
    ...ref,
    action,
    memberKey: releaseMemberKey(releaseId, ref),
    createdBy: null,
    createdAt: new Date(),
  });
}

/**
 * One collection's entries under a filter, as a key holder reads them over
 * REST: the ids the list returns, its total, and the count endpoint's total.
 * Every status, as the admin's list asks, because the entries a filter keeps
 * may be drafts.
 */
async function listed(
  key: string,
  collection: Collection,
  where: unknown
): Promise<{ ids: Set<string>; total: number; counted: number }> {
  const query = `status=all&limit=100&where=${encodeURIComponent(JSON.stringify(where))}`;
  const list = await rest(
    key,
    "GET",
    ["collections", collection, "entries"],
    undefined,
    query
  );
  expect(list.status, JSON.stringify(list.json)).toBe(200);
  const count = await rest(
    key,
    "GET",
    ["collections", collection, "entries", "count"],
    undefined,
    query
  );
  expect(count.status, JSON.stringify(count.json)).toBe(200);
  return {
    ids: new Set((list.json.items as { id: string }[]).map(item => item.id)),
    total: (list.json.meta as { total: number }).total,
    counted: count.json.total as number,
  };
}

/**
 * A filter as a client sends it, read through the same check the REST routes
 * and the bulk-by-query body apply. The workflow keys take `true`, which the
 * published `WhereFilter` type does not admit, so a typed caller reaches them
 * the way a client's JSON does.
 */
function clientWhere(where: Record<string, unknown>) {
  const read = readClientWhere(where);
  if (read === undefined) throw new Error("no filter");
  return read;
}

/** A REST read's refusal: its status and the problems it names. */
async function refusedWith(
  key: string,
  collection: Collection,
  query: string
): Promise<{ status: number; errors: unknown }> {
  const res = await rest(
    key,
    "GET",
    ["collections", collection, "entries"],
    undefined,
    query
  );
  const error = res.json.error as { data?: { errors?: unknown } } | undefined;
  return { status: res.status, errors: error?.data?.errors };
}

describe.each(getConfiguredTestDialects())(
  "the workflow list filters (%s)",
  dialect => {
    /**
     * Entries in every place the two rules tell apart, and three callers: one
     * who may read both collections and releases, one who may read posts and
     * releases, and one who may read posts alone.
     */
    async function seed() {
      const t = await boot(dialect);
      // The first user is the instance's super admin; every key below is
      // minted by somebody else, so each is judged on its own grants.
      await seedLiveAuthor(t);
      const now = Date.now();
      const at = (offset: number) => new Date(now + offset);

      const posts = {
        drafted: await entry(t, "posts", "Drafted"),
        draftedInFrench: await entry(t, "posts", "Drafted in French"),
        onlyHistory: await entry(t, "posts", "Only history"),
        untouched: await entry(t, "posts", "Untouched"),
        soon: await entry(t, "posts", "Soon"),
        unpublishedSoon: await entry(t, "posts", "Unpublished soon"),
        later: await entry(t, "posts", "Later"),
        inGrace: await entry(t, "posts", "In grace"),
        overdue: await entry(t, "posts", "Overdue"),
        inDraftRelease: await entry(t, "posts", "In a draft release"),
        inStoppedRelease: await entry(t, "posts", "In a stopped release"),
      };
      const secret = await entry(t, "secrets", "Secret soon");

      // Working drafts: one unlocalized, one in a single other language.
      await versionRow(t, "posts", posts.drafted, {});
      await versionRow(t, "posts", posts.draftedInFrench, { locale: "fr" });
      // Version rows that are NOT a pending change: an autosave, and a
      // numbered history version (well past the version the create recorded).
      await versionRow(t, "posts", posts.onlyHistory, { isAutosave: true });
      await versionRow(t, "posts", posts.onlyHistory, { versionNo: 999 });
      // A working draft of a secret, to show the condition stays per collection.
      await versionRow(t, "secrets", secret, {});

      // Two releases within the week both publish `soon` (counted once, in two
      // languages of one of them); the first also unpublishes another entry.
      const inTwoDays = await release(t, "scheduled", at(2 * DAY));
      await member(t, inTwoDays, "posts", posts.soon, "publish");
      await member(t, inTwoDays, "posts", posts.soon, "publish", "fr");
      await member(t, inTwoDays, "posts", posts.unpublishedSoon, "unpublish");
      await member(t, inTwoDays, "secrets", secret, "publish");
      const inThreeDays = await release(t, "scheduled", at(3 * DAY));
      await member(t, inThreeDays, "posts", posts.soon, "publish");
      // Beyond the week: kept by the open form only.
      const inTenDays = await release(t, "scheduled", at(10 * DAY));
      await member(t, inTenDays, "posts", posts.later, "publish");
      // Past its time, inside the grace period and beyond it: neither kept.
      const graceRelease = await release(t, "scheduled", at(-3 * MINUTE));
      await member(t, graceRelease, "posts", posts.inGrace, "publish");
      const overdueRelease = await release(t, "scheduled", at(-60 * MINUTE));
      await member(t, overdueRelease, "posts", posts.overdue, "publish");
      // Not scheduled at all, or stopped: neither kept.
      const draftRelease = await release(t, "draft", null);
      await member(t, draftRelease, "posts", posts.inDraftRelease, "publish");
      const stopped = await release(t, "blocked", at(DAY));
      await member(t, stopped, "posts", posts.inStoppedRelease, "publish");

      const everything = await keyHolding(
        t,
        ["read-posts", "read-secrets", "read-content-releases"],
        { email: "everything@example.com", name: "Everything" }
      );
      const postsAndReleases = await keyHolding(
        t,
        ["read-posts", "read-content-releases"],
        { email: "posts-releases@example.com", name: "Posts and releases" }
      );
      const postsOnly = await keyHolding(t, ["read-posts"], {
        email: "posts-only@example.com",
        name: "Posts only",
      });
      return {
        t,
        posts,
        secret,
        weekEnd: at(7 * DAY),
        keys: {
          everything: everything.key,
          postsAndReleases: postsAndReleases.key,
          postsOnly: postsOnly.key,
        },
      };
    }

    it("keeps entries whose draft holds unpublished changes, in any language, and counts what it lists", async () => {
      const { posts, secret, keys } = await seed();
      for (const key of [keys.everything, keys.postsOnly]) {
        const pending = await listed(key, "posts", { _pendingChange: true });
        expect(pending.ids).toEqual(
          new Set([posts.drafted, posts.draftedInFrench])
        );
        expect(pending.total).toBe(2);
        expect(pending.counted).toBe(2);
      }
      const secrets = await listed(keys.everything, "secrets", {
        _pendingChange: true,
      });
      expect(secrets.ids).toEqual(new Set([secret]));
    });

    it("keeps entries a release will publish within the bound, once each, and counts what it lists", async () => {
      const { posts, weekEnd, keys } = await seed();
      const week = await listed(keys.everything, "posts", {
        _inRelease: { scheduledBefore: weekEnd.toISOString() },
      });
      expect(week.ids).toEqual(new Set([posts.soon]));
      expect(week.total).toBe(1);
      expect(week.counted).toBe(1);
    });

    it("keeps releases beyond the week under the open form, with every other rule unchanged", async () => {
      const { posts, keys } = await seed();
      const open = await listed(keys.everything, "posts", {
        _inRelease: true,
      });
      expect(open.ids).toEqual(new Set([posts.soon, posts.later]));
      expect(open.total).toBe(2);
      expect(open.counted).toBe(2);

      // The bracket form reads the same.
      const bracket = await rest(
        keys.everything,
        "GET",
        ["collections", "posts", "entries"],
        undefined,
        "status=all&limit=100&where[_inRelease]=true"
      );
      expect(bracket.status).toBe(200);
      expect(
        new Set((bracket.json.items as { id: string }[]).map(i => i.id))
      ).toEqual(open.ids);
    });

    it("stays in effect beside the list's own filters", async () => {
      const { posts, keys } = await seed();
      const narrowed = await listed(keys.everything, "posts", {
        _inRelease: true,
        title: { equals: "Later" },
      });
      expect(narrowed.ids).toEqual(new Set([posts.later]));
      expect(narrowed.counted).toBe(1);

      const both = await listed(keys.everything, "posts", {
        _pendingChange: true,
        _inRelease: true,
      });
      // No entry is both drafted and due, so the two conditions together keep
      // none: they are AND-ed, never OR-ed.
      expect(both.ids).toEqual(new Set());
      expect(both.counted).toBe(0);
    });

    it("answers each collection only to a caller who may read it", async () => {
      const { secret, weekEnd, keys } = await seed();
      const where = { _inRelease: { scheduledBefore: weekEnd.toISOString() } };
      expect((await listed(keys.everything, "secrets", where)).ids).toEqual(
        new Set([secret])
      );
      const refused = await rest(
        keys.postsAndReleases,
        "GET",
        ["collections", "secrets", "entries"],
        undefined,
        `status=all&where=${encodeURIComponent(JSON.stringify(where))}`
      );
      expect(refused.status).toBe(403);
    });

    it("refuses _inRelease to a caller who may not read releases, exactly as an unknown condition", async () => {
      const { keys } = await seed();
      const asInRelease = await refusedWith(
        keys.postsOnly,
        "posts",
        `status=all&where=${encodeURIComponent(JSON.stringify({ _inRelease: true }))}`
      );
      const asUnknown = await refusedWith(
        keys.postsOnly,
        "posts",
        `status=all&where=${encodeURIComponent(JSON.stringify({ _noSuchCondition: true }))}`
      );
      expect(asInRelease.status).toBe(400);
      expect(asUnknown.status).toBe(400);
      // Refused before any read hook ran, the precondition before the work.
      readHookRuns.length = 0;
      await refusedWith(
        keys.postsOnly,
        "posts",
        `status=all&where=${encodeURIComponent(JSON.stringify({ _inRelease: true }))}`
      );
      expect(readHookRuns).toEqual([]);
      // The control: the same caller's read the hook does run for, so the
      // empty record above is the refusal's doing, not a hook that never runs.
      await listed(keys.postsOnly, "posts", { _pendingChange: true });
      expect(readHookRuns).toContain("posts");
      // Word for word once the name is the same.
      expect(
        JSON.stringify(asInRelease.errors).replaceAll(
          "_inRelease",
          "_noSuchCondition"
        )
      ).toBe(JSON.stringify(asUnknown.errors));

      // The bounded form too, so a bound reveals nothing either.
      const bounded = await refusedWith(
        keys.postsOnly,
        "posts",
        `status=all&where[_inRelease][scheduledBefore]=2099-01-01T00:00:00Z`
      );
      expect(bounded.errors).toEqual(asInRelease.errors);
    });

    it("refuses a bulk write selecting by _inRelease to a caller who may not read releases, before any row is written", async () => {
      const { t, posts } = await seed();
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      // A super admin's key scoped to write posts but not to read releases:
      // judged on the scope, so the bypass cannot carry it past the check.
      const owner = { id: "admin", roles: ["super-admin"] };
      const writer = {
        actorType: "apiKey" as const,
        permissions: ["read-posts", "update-posts", "delete-posts"],
      };
      const unknownField = {
        statusCode: 400,
        publicData: {
          errors: [expect.objectContaining({ code: "FILTER_UNKNOWN_FIELD" })],
        },
      };
      // The bulk enumeration runs trusted, so without this precondition the
      // refused caller would write exactly the members, and learn from the
      // affected count which entries a release holds.
      await expect(
        handler.bulkUpdateByQuery({
          collectionName: "posts",
          where: clientWhere({ _inRelease: true }),
          data: { title: "Selected by release" },
          user: owner,
          authenticatedScope: writer,
        })
      ).rejects.toMatchObject(unknownField);
      await expect(
        handler.bulkDeleteByQuery({
          collectionName: "posts",
          where: clientWhere({ _inRelease: true }),
          user: owner,
          authenticatedScope: writer,
        })
      ).rejects.toMatchObject(unknownField);
      // Nothing was written or removed: every entry keeps its title.
      const after = await handler.listEntries({
        collectionName: "posts",
        overrideAccess: true,
        status: "all",
        limit: 100,
      });
      const titles = (after.data?.docs ?? []) as { title: string }[];
      expect(titles).toHaveLength(Object.keys(posts).length);
      expect(titles.map(row => row.title)).not.toContain("Selected by release");

      // The control: the same write from a key that may read releases reaches
      // exactly the entries the list filter keeps.
      const updated = await handler.bulkUpdateByQuery({
        collectionName: "posts",
        where: clientWhere({ _inRelease: true }),
        data: { title: "Selected by release" },
        user: owner,
        authenticatedScope: {
          ...writer,
          permissions: [...writer.permissions, "read-content-releases"],
        },
      });
      expect(updated.successCount).toBe(2);
    });

    it("refuses a bulk write selecting by either workflow key to a caller who may write but not read the collection", async () => {
      const { t, posts } = await seed();
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      // A super admin's key scoped to update and delete posts and to read
      // releases, but not to read posts: which entries hold drafts, and which
      // a release holds, are facts about documents it may not read.
      const owner = { id: "admin", roles: ["super-admin"] };
      const writeOnly = {
        actorType: "apiKey" as const,
        permissions: ["update-posts", "delete-posts", "read-content-releases"],
      };
      const unknownField = {
        statusCode: 400,
        publicData: {
          errors: [expect.objectContaining({ code: "FILTER_UNKNOWN_FIELD" })],
        },
      };
      for (const key of ["_pendingChange", "_inRelease"]) {
        await expect(
          handler.bulkUpdateByQuery({
            collectionName: "posts",
            where: clientWhere({ [key]: true }),
            data: { title: "Selected unseen" },
            user: owner,
            authenticatedScope: writeOnly,
          }),
          key
        ).rejects.toMatchObject(unknownField);
        await expect(
          handler.bulkDeleteByQuery({
            collectionName: "posts",
            where: clientWhere({ [key]: true }),
            user: owner,
            authenticatedScope: writeOnly,
          }),
          key
        ).rejects.toMatchObject(unknownField);
      }
      // Nothing was written or removed.
      const after = await handler.listEntries({
        collectionName: "posts",
        overrideAccess: true,
        status: "all",
        limit: 100,
      });
      const titles = (after.data?.docs ?? []) as { title: string }[];
      expect(titles).toHaveLength(Object.keys(posts).length);
      expect(titles.map(row => row.title)).not.toContain("Selected unseen");

      // The guard is the workflow keys' alone: the same caller's bulk write by
      // an ordinary field condition still goes through.
      const updated = await handler.bulkUpdateByQuery({
        collectionName: "posts",
        where: clientWhere({ title: { equals: "Untouched" } }),
        data: { title: "Untouched, renamed" },
        user: owner,
        authenticatedScope: writeOnly,
      });
      expect(updated.successCount).toBe(1);
    });

    it("refuses either key inside and/or", async () => {
      const { keys } = await seed();
      const nested = await refusedWith(
        keys.everything,
        "posts",
        `status=all&where=${encodeURIComponent(
          JSON.stringify({
            and: [{ _pendingChange: true }, { title: { equals: "x" } }],
          })
        )}`
      );
      expect(nested.status).toBe(400);
      expect(nested.errors).toEqual([
        expect.objectContaining({
          code: "FILTER_MISPLACED_KEY",
          path: "where.and.0._pendingChange",
        }),
      ]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the workflow list filters, per language (%s)",
  dialect => {
    /** Open in every language but French. */
    const frenchClosed = ({ locales }: AccessRuleContext) =>
      !locales.includes("fr");

    /**
     * A localized site with one collection whose read rule refuses French and
     * one open in every language, each holding an entry with a French working
     * draft, an entry with an English one, and an entry a release due tomorrow
     * publishes in French alone.
     */
    async function seed() {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
        collections: [
          ["notes", frenchClosed],
          ["opennotes", () => true],
        ].map(([slug, read]) =>
          defineCollection({
            slug: slug as string,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: read as (ctx: AccessRuleContext) => boolean },
            fields: [text({ name: "title", localized: true })],
          })
        ),
      });
      const t = current;
      const tomorrow = await release(
        t,
        "scheduled",
        new Date(Date.now() + DAY)
      );
      const seeded = async (collection: "notes" | "opennotes") => {
        const ids = {
          frenchDraft: await entry(t, collection, "French draft"),
          englishDraft: await entry(t, collection, "English draft"),
          frenchMember: await entry(t, collection, "French member"),
        };
        await versionRow(t, collection, ids.frenchDraft, { locale: "fr" });
        await versionRow(t, collection, ids.englishDraft, { locale: "en" });
        await member(
          t,
          tomorrow,
          collection,
          ids.frenchMember,
          "publish",
          "fr"
        );
        return ids;
      };
      return {
        handler: t.getService("collectionsHandler") as CollectionsHandler,
        notes: await seeded("notes"),
        open: await seeded("opennotes"),
      };
    }

    /** A super admin's key, judged on its scope: it may read both collections and releases. */
    const reader = {
      user: { id: "admin", roles: ["super-admin"] },
      authenticatedScope: {
        actorType: "apiKey" as const,
        permissions: ["read-notes", "read-opennotes", "read-content-releases"],
      },
    };

    /** The ids a read keeps under `where`, after checking its count agrees. */
    async function kept(
      handler: CollectionsHandler,
      collection: "notes" | "opennotes",
      where: Record<string, unknown>,
      language: { locale: string; fallbackLocale?: string }
    ): Promise<Set<string>> {
      const read = {
        collectionName: collection,
        where: clientWhere(where),
        status: "all" as const,
        ...language,
        ...reader,
      };
      const list = await handler.listEntries({ ...read, limit: 100 });
      expect(list.success, list.message).toBe(true);
      const count = await handler.countEntries(read);
      const items = (list.data?.docs ?? []) as { id: string }[];
      expect(count.data?.totalDocs).toBe(items.length);
      return new Set(items.map(item => item.id));
    }

    it("keeps an entry for a draft or release member only in a language the read was judged for", async () => {
      const { handler, notes, open } = await seed();
      // English, where the rule is open: the English draft keeps its entry,
      // and the French draft and the French member, withheld from this read,
      // keep nothing.
      expect(
        await kept(handler, "notes", { _pendingChange: true }, { locale: "en" })
      ).toEqual(new Set([notes.englishDraft]));
      expect(
        await kept(handler, "notes", { _inRelease: true }, { locale: "en" })
      ).toEqual(new Set());

      // German falling back to English is judged in both, so the fallback
      // language's draft keeps its entry.
      expect(
        await kept(
          handler,
          "notes",
          { _pendingChange: true },
          { locale: "de", fallbackLocale: "en" }
        )
      ).toEqual(new Set([notes.englishDraft]));

      // The control: a read of every language, which the open collection's
      // rule admits, keeps the French draft and the French member.
      expect(
        await kept(
          handler,
          "opennotes",
          { _pendingChange: true },
          { locale: "all" }
        )
      ).toEqual(new Set([open.frenchDraft, open.englishDraft]));
      expect(
        await kept(
          handler,
          "opennotes",
          { _inRelease: true },
          { locale: "all" }
        )
      ).toEqual(new Set([open.frenchMember]));
    });
  }
);
