/**
 * The Needs your attention card's own answer against a real database: its
 * `load`, run as a batch runs it, with read services bound to the caller who
 * asked.
 *
 * What only a database can settle: that an API key is answered by its own
 * grant rather than by the roles of the person who made it, that a reader with
 * nothing waiting gets an answer the card judges empty (so it leaves the
 * dashboard), and that an item leaves once the work it counts is done; and
 * that a half-retired collection (removed from code, its table dropped, its
 * registry row left behind) fails neither the card nor Needs attention's
 * grouped answer, and that a collection whose count fails costs only its part.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import { defineCollection, text } from "../../../config";
import { publishDeclaredEntities } from "../../../domains/dynamic-collections/services/removed-from-code-writes";
import {
  publishAsItStands,
  scheduleAsItStands,
} from "../../../domains/releases/__tests__/helpers/release-writes";
import { ReleasesRepository } from "../../../domains/releases/releases-repository";
import {
  clearAttentionItems,
  registerAttentionItems,
} from "../../../domains/widgets/attention/items";
import { createBatchScope } from "../../../domains/widgets/batch-scope";
import { needsAttentionWidget } from "../../../domains/widgets/core-widgets/needs-attention";
import { refreshContentSources } from "../../../domains/widgets/content-sources";
import type { AttentionItem } from "../../../domains/widgets/declaration/dashboard";
import {
  bindReadServices,
  type ReadAheadSide,
} from "../../../domains/widgets/declaration/read-services";
import type { WidgetQuery } from "../../../domains/widgets/query";
import { handOverReadAhead } from "../../../domains/widgets/read-ahead-handover";
import { sourceResolver } from "../../../domains/widgets/resolved-sources";
import { ATTENTION_SOURCE_ID } from "../../../domains/widgets/system-source-ids";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../readable-resources";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "nac_notes";
/**
 * Half-retired by the cases that name it: removed from code, its table
 * dropped, its registry row left behind.
 */
const RETIRED = "nac_retired";

let current: TestNextly | undefined;

afterEach(async () => {
  clearAttentionItems();
  publishDeclaredEntities(undefined);
  await current?.destroy();
  current = undefined;
});

/**
 * A plugin's attention items, kept as startup keeps them: one counting the
 * notes and one counting the collection a case half-retires.
 */
function declarePluginItems(): void {
  const counting = (slug: string, label: string): AttentionItem => ({
    id: `acme/${slug.replace("nac_", "")}`,
    label,
    collections: [slug],
    count: ({ services, signal }) => services.count(slug, { signal }),
    link: `collections/${slug}`,
  });
  registerAttentionItems([
    {
      owner: 'plugin "acme"',
      plugin: "acme",
      widgets: [],
      suggest: undefined,
      alternatives: undefined,
      attention: [
        counting(NOTES, "Notes waiting"),
        counting(RETIRED, "Retired waiting"),
      ],
      unknownKeys: [],
    },
  ]);
}

/**
 * Needs attention's grouped answer for `caller` (`system:attention` asked
 * with `groupBy`), each bucket as its count, "+" for a floor.
 */
async function groupedFor(caller: ReadCaller): Promise<Record<string, string>> {
  const resolve = sourceResolver(ATTENTION_SOURCE_ID);
  if (!resolve) throw new Error("system:attention is not registered");
  const query: WidgetQuery = {
    source: ATTENTION_SOURCE_ID,
    op: "groupBy",
    groupBy: "item",
  };
  const result = await resolve(query, caller);
  if (result.op !== "groupBy") throw new Error(result.op);
  return Object.fromEntries(
    result.buckets.map(bucket => [
      bucket.value,
      `${bucket.count}${bucket.atLeast === true ? "+" : ""}`,
    ])
  );
}

const MINUTE = 60 * 1000;

/**
 * The layout read of the load `token` names, answering ahead of its batch, on
 * `credential` (a session, unless a case names a key).
 */
const ahead = (token: string, credential = "session"): ReadAheadSide => ({
  side: "ahead",
  token,
  credential,
});

/** The batch of the load `token` names, on `credential`. */
const batchOf = (token: string, credential = "session"): ReadAheadSide => ({
  side: "batch",
  token,
  credential,
});

/**
 * A full-access key's scope, granted only `read-<NOTES>`, as authentication
 * makes it for a key whose maker is a super-admin: carrying that authority, or
 * lapsed, its bound passed before the scope was made (a role of the maker's
 * that expired).
 */
function keyScope(authority: "holds" | "lapsed"): AuthenticatedScope {
  return apiKeyScopeFrom({
    grants: [{ slug: `read-${NOTES}`, action: "read", resource: NOTES }],
    keyHoldsSuperAdmin: true,
    ...(authority === "lapsed"
      ? { keyHoldsSuperAdminUntil: Date.now() - 1 }
      : {}),
  });
}

/**
 * The card's answer for `caller`, as a batch answers it: services bound to
 * that caller, and to the side of the dashboard load `readAhead` names, if
 * any: `ahead` as the layout read answers it before the dashboard is drawn,
 * `batch` as the batch of that load asks it. An `ahead` answer's load is then
 * handed over, as the layout read hands it over once it has judged every card
 * (`cardFor`); `answerFor` leaves it being judged.
 */
async function cardFor(caller: ReadCaller, readAhead?: ReadAheadSide) {
  const answer = await answerFor(caller, readAhead);
  if (readAhead?.side === "ahead") handOverReadAhead(readAhead.token);
  return answer;
}

/** The card's answer as `cardFor` gives it, with an `ahead` load left being judged. */
async function answerFor(caller: ReadCaller, readAhead?: ReadAheadSide) {
  const signal = new AbortController().signal;
  const now = new Date();
  const answer = await needsAttentionWidget.load({
    settings: {},
    user: caller.user,
    signal,
    now,
    scope: createBatchScope().forOwner("core"),
    // Its default size, as a batch hands a card the size it is drawn at.
    size: { w: 8, h: 3, tier: "medium" },
    services: bindReadServices({
      caller,
      prepare: () => Promise.reject(new Error("the card reads no collection")),
      signal,
      now,
      ...(readAhead === undefined ? {} : { readAhead }),
    }),
  });
  const isEmpty = needsAttentionWidget.isEmpty;
  if (isEmpty === undefined)
    throw new Error("the card declares its empty test");
  return { ids: answer.items.map(item => item.id), empty: isEmpty(answer) };
}

describe.each(getConfiguredTestDialects())(
  "the Needs your attention card (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
      });
      await refreshContentSources();
      return current;
    }

    /** An overdue release, scheduled an hour ago and never published. */
    async function overdueRelease(t: TestNextly) {
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({ title: "Overdue" });
      await scheduleAsItStands(
        repo,
        release.id,
        new Date(Date.now() - 60 * MINUTE),
        "UTC"
      );
      return { repo, id: release.id };
    }

    it("answers an API key by its own grant, not by the person who made it", async () => {
      const t = await boot();
      await overdueRelease(t);
      const owner = await superAdminUser(t, "nac-owner");
      const asPerson: ReadCaller = { user: { id: owner } };
      // The same person's key, granted only the notes: the super-admin's own
      // reach must not come with it.
      const asKey: ReadCaller = {
        ...asPerson,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [`read-${NOTES}`],
        },
      };

      expect((await cardFor(asPerson)).ids).toEqual(["core/overdue-releases"]);
      // The must-differ half: had the card read as `{ user }`, the key would
      // see the overdue release its grant does not reach.
      expect(await cardFor(asKey)).toEqual({ ids: [], empty: true });
    });

    it("is empty for a reader with nothing waiting, so the card leaves the dashboard", async () => {
      const t = await boot();
      await overdueRelease(t);
      const notesOnly: ReadCaller = {
        user: { id: await userWhoMay(t, "nac-notes", "read", [NOTES]) },
      };
      expect(await cardFor(notesOnly)).toEqual({ ids: [], empty: true });
    });

    it("drops an item once the work it counts is done", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-admin") },
      };
      const { repo, id } = await overdueRelease(t);
      expect(await cardFor(admin)).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });

      // Published: no longer scheduled after its time, so nothing is waiting.
      expect(await publishAsItStands(repo, id, new Date())).toBe(true);
      expect(await cardFor(admin)).toEqual({ ids: [], empty: true });
    });

    it("reads the digest once per dashboard load: the batch takes the layout read's, once", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-once") },
      };
      // The layout read, ahead of the dashboard: nothing waiting.
      expect(await cardFor(admin, ahead("load-once"))).toEqual({
        ids: [],
        empty: true,
      });
      await overdueRelease(t);

      // The batch that follows is handed that answer rather than reading
      // again: the release made overdue in between is not in it.
      expect(await cardFor(admin, batchOf("load-once"))).toEqual({
        ids: [],
        empty: true,
      });
      // Taken once: the same load's next batch, a refetch, reads anew, and so
      // does an ask of no load at all.
      expect(await cardFor(admin, batchOf("load-once"))).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });
      expect(await cardFor(admin)).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });
    });

    it("hands the batch the layout read's digest when the read took longer than the window to hand its load over", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-slow") },
      };
      // The layout read answers this card with nothing waiting, then goes on judging a slower card.
      expect((await answerFor(admin, ahead("load-slow"))).ids).toEqual([]);
      await overdueRelease(t);

      // Six seconds on, longer than the five a batch is given, the slower card has answered and
      // the load is handed over; its batch asks at once.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 6_000);
      try {
        handOverReadAhead("load-slow");
        // Handed the digest that judged the card, not one read since: the window began at the
        // handover, not when the digest was read.
        expect(await cardFor(admin, batchOf("load-slow"))).toEqual({
          ids: [],
          empty: true,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("hands a batch nothing read ahead for a load its layout read has not handed over", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-early") },
      };
      // Read ahead with nothing waiting, the layout read still judging: its window has not begun.
      expect((await answerFor(admin, ahead("load-early"))).ids).toEqual([]);
      await overdueRelease(t);
      expect(await cardFor(admin, batchOf("load-early"))).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });
    });

    it("hands each of one reader's loads its own read-ahead digest, never the other's", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-two-loads") },
      };
      // Two tabs of one reader: the first load reads ahead with nothing
      // waiting, then a release falls overdue, then the second reads ahead.
      expect((await cardFor(admin, ahead("load-a"))).ids).toEqual([]);
      const { repo, id } = await overdueRelease(t);
      expect((await cardFor(admin, ahead("load-b"))).ids).toEqual([
        "core/overdue-releases",
      ]);

      // A's batch first: handed A's own digest, which its layout read hid the
      // card by. Neither B's, read later, nor a read made now names nothing.
      expect(await cardFor(admin, batchOf("load-a"))).toEqual({
        ids: [],
        empty: true,
      });
      // Published: a read made now finds nothing waiting, so only B's own
      // digest still names the release.
      expect(await publishAsItStands(repo, id, new Date())).toBe(true);
      expect(await cardFor(admin, batchOf("load-b"))).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });

      // Each taken once: both loads' next batches read anew. B's would still
      // name the published release; A's, once another falls overdue, would
      // still name nothing.
      expect(await cardFor(admin, batchOf("load-b"))).toEqual({
        ids: [],
        empty: true,
      });
      await overdueRelease(t);
      expect(await cardFor(admin, batchOf("load-a"))).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });
    });

    it("reads anew for a batch naming a load nothing was read ahead for", async () => {
      const t = await boot();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-unknown") },
      };
      expect((await cardFor(admin, ahead("load-known"))).ids).toEqual([]);
      await overdueRelease(t);

      // An unknown load is handed nothing waiting for another: it reads now.
      expect(await cardFor(admin, batchOf("load-unknown"))).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });
      // And leaves the known load's digest where it was, for its own batch.
      expect(await cardFor(admin, batchOf("load-known"))).toEqual({
        ids: [],
        empty: true,
      });
    });

    it("reads anew for a batch whose verified claims changed since its layout read, the id and roles the same", async () => {
      const t = await boot();
      const id = await superAdminUser(t, "nac-claims");
      // A claim a rule may decide on, refreshed between the two requests.
      const before: ReadCaller = { user: { id, tenant: "north" } };
      const after: ReadCaller = { user: { id, tenant: "south" } };
      expect((await cardFor(before, ahead("load-claims"))).ids).toEqual([]);
      await overdueRelease(t);

      // Not handed the digest read for the other claim: read now, so the
      // release made overdue in between is in it.
      expect(await cardFor(after, batchOf("load-claims"))).toEqual({
        ids: ["core/overdue-releases"],
        empty: false,
      });
    });

    it("reads anew for a key whose maker's super-admin authority lapsed since its layout read, its grants the same", async () => {
      const t = await boot();
      await overdueRelease(t);
      const id = await superAdminUser(t, "nac-authority");
      const holding: ReadCaller = {
        user: { id },
        authenticatedScope: keyScope("holds"),
      };
      const lapsed: ReadCaller = {
        user: { id },
        authenticatedScope: keyScope("lapsed"),
      };
      // With the authority, the key reads releases.
      expect(
        (await cardFor(holding, ahead("load-lapse", "api-key:k1"))).ids
      ).toEqual(["core/overdue-releases"]);

      // Its batch, the authority gone: judged on its grant alone, which
      // reads no release, rather than handed what the authority read.
      expect(
        await cardFor(lapsed, batchOf("load-lapse", "api-key:k1"))
      ).toEqual({ ids: [], empty: true });
    });

    it("hands a batch the digest once when it asks as the same principal, built anew for its own request", async () => {
      const t = await boot();
      const id = await superAdminUser(t, "nac-same");
      // Each request builds its caller and the key's scope afresh, as
      // authentication does: equal, never the same objects.
      const asked = (): ReadCaller => ({
        user: { id, tenant: "north" },
        authenticatedScope: keyScope("holds"),
      });
      expect(
        (await cardFor(asked(), ahead("load-same", "api-key:k1"))).ids
      ).toEqual([]);
      await overdueRelease(t);

      // The digest the layout read hid the card by, not a read made now.
      expect(
        await cardFor(asked(), batchOf("load-same", "api-key:k1"))
      ).toEqual({ ids: [], empty: true });
      // Once: the next batch of the load reads anew.
      expect(
        await cardFor(asked(), batchOf("load-same", "api-key:k1"))
      ).toEqual({ ids: ["core/overdue-releases"], empty: false });
    });

    /** Boots with the notes and {@link RETIRED} both declared, one entry in each. */
    async function bootWithRetired(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        collections: [NOTES, RETIRED].map(slug =>
          defineCollection({ slug, fields: [text({ name: "title" })] })
        ),
      });
      for (const collection of [NOTES, RETIRED]) {
        await current.nextly.create({ collection, data: { title: "One" } });
      }
      await refreshContentSources();
      return current;
    }

    /**
     * Half-retires {@link RETIRED}: its table dropped, as an applied drop
     * migration leaves it, and the configuration published without it, as the
     * boot or reload of that configuration publishes it, while its registry
     * row stays. Then the content sources are refreshed, as every dashboard
     * request does first.
     */
    async function halfRetire(t: TestNextly): Promise<void> {
      const row = await t
        .getService("collectionRegistryService")
        .getCollectionBySlug(RETIRED);
      if (!row) throw new Error(`${RETIRED} has no registry row`);
      await t.adapter.dropTable(row.tableName);
      // Positive controls: the table is gone and the registry row is not.
      expect(await t.adapter.tableExists(row.tableName)).toBe(false);
      expect(
        await t
          .getService("collectionRegistryService")
          .getCollectionBySlug(RETIRED)
      ).toMatchObject({ slug: RETIRED, source: "code" });
      publishDeclaredEntities({
        collections: [{ slug: NOTES }],
        singles: [],
      });
      await refreshContentSources();
    }

    it("loads beside a half-retired collection, every other item intact", async () => {
      const t = await bootWithRetired();
      await overdueRelease(t);
      declarePluginItems();
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-retired-card") },
      };
      // Positive control: before it is retired, the item counting it reaches
      // its table and is shown.
      expect(await cardFor(admin)).toEqual({
        ids: ["core/overdue-releases", "acme/notes", "acme/retired"],
        empty: false,
      });

      await halfRetire(t);

      // The card answers, ready and not empty, with the overdue release and the
      // notes' item as they were. The item over the retired collection is not
      // drawn as failed: the collection is not the site's any more, so it
      // shows to nobody, as an item over a collection the site lacks does.
      expect(await cardFor(admin)).toEqual({
        ids: ["core/overdue-releases", "acme/notes"],
        empty: false,
      });
    });

    it("answers its grouped counts beside a half-retired collection, with no part left unread", async () => {
      const t = await bootWithRetired();
      await overdueRelease(t);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-retired-grouped") },
      };
      expect(await groupedFor(admin)).toEqual({ overdue: "1" });

      await halfRetire(t);

      // Not refused, and no kind a floor: the retired collection is not one
      // the dashboard counts, so nothing was left unread.
      expect(await groupedFor(admin)).toEqual({ overdue: "1" });
    });

    it("answers its grouped counts when a collection it counts cannot be read, that part alone unread", async () => {
      const t = await bootWithRetired();
      await overdueRelease(t);
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "nac-unreadable") },
      };
      // A declared collection whose table is gone: still the dashboard's, so
      // it is counted, and its count fails.
      const row = await t
        .getService("collectionRegistryService")
        .getCollectionBySlug(RETIRED);
      if (!row) throw new Error(`${RETIRED} has no registry row`);
      await t.adapter.dropTable(row.tableName);

      // The overdue release is answered as before; the two kinds that count
      // collections are floors of nothing found, never "All clear".
      expect(await groupedFor(admin)).toEqual({
        overdue: "1",
        unpublished: "0+",
        scheduled: "0+",
      });
    });

    it("never hands one reader's read-ahead digest to a caller with other grants", async () => {
      const t = await boot();
      await overdueRelease(t);
      const owner = await superAdminUser(t, "nac-grants");
      const asPerson: ReadCaller = { user: { id: owner } };
      const asKey: ReadCaller = {
        ...asPerson,
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [`read-${NOTES}`],
        },
      };
      expect((await cardFor(asPerson, ahead("load-grants"))).ids).toEqual([
        "core/overdue-releases",
      ]);
      // The same person's narrower key, sending the person's load token,
      // reads its own digest.
      expect(await cardFor(asKey, batchOf("load-grants"))).toEqual({
        ids: [],
        empty: true,
      });
    });
  }
);
