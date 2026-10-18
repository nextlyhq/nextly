/**
 * "The version you last looked at": recorded only by an explicit mark, for
 * people only, counted by visit, and used as a comparison baseline and as the
 * history list's divider.
 *
 * The history is seeded straight into the versions table, so each case names
 * exactly which versions exist in which language.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { defineCollection, text } from "../../../config";
import {
  getVersionDiffForDocument,
  getVersionForDocument,
  listVersionsForDocument,
  markVersionSeenForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { UserMutationService } from "../../users/services/user-mutation-service";
import { HistoryDividers } from "../history-dividers";
import { VISIT_GAP_MS, readLastLookedAt } from "../version-views";
import { VersionsRepository } from "../versions-repository";

import { untilSomeoneWaitsOnALock } from "./helpers/lock-wait";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ANA = { id: "ana", email: "ana@x.test" };
const MARTA = { id: "marta", email: "marta@x.test" };
const KEY: AuthenticatedScope = {
  actorType: "apiKey",
  permissions: ["read-posts"],
};
const SYSTEM: AuthenticatedScope = { actorType: "system", permissions: [] };

/**
 * A database that reports each query it runs. A Drizzle query runs when it
 * is awaited or executed, so the builder a call returns is wrapped (and kept
 * wrapped through the chain, whose methods return the builder itself) and a
 * run is counted at `then` or `execute`, never at the call that builds it.
 */
function countingRuns<T extends object>(target: T, onRun: () => void): T {
  const wrapped: T = new Proxy(target, {
    get(inner, key) {
      const member: unknown = Reflect.get(inner, key, inner);
      if (typeof member !== "function") return member;
      if (key === "then" || key === "execute") {
        return (...args: unknown[]) => {
          onRun();
          return member.apply(inner, args);
        };
      }
      return (...args: unknown[]) => {
        const result: unknown = member.apply(inner, args);
        if (result === inner) return wrapped;
        return result !== null && typeof result === "object"
          ? countingRuns(result, onRun)
          : result;
      };
    },
  });
  return wrapped;
}

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * A translated document whose history is exactly `locales`, one version per
 * entry from v1, in order (null is the part with no language).
 */
async function documentWithHistory(
  dialect: TestDialect,
  locales: (string | null)[]
) {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        versions: { drafts: false, maxPerDoc: false },
        access: { read: () => true, update: () => true, create: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // The people who look: real accounts, as a signed-in person always has one,
  // and a mark locks it.
  const now = new Date();
  for (const person of [ANA, MARTA]) {
    await current.adapter.insert("users", {
      id: person.id,
      email: person.email,
      name: person.id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  const created = await current
    .getService("collectionsHandler")
    .createEntry(
      { collectionName: "posts", overrideAccess: true, locale: "en" },
      { title: "created" }
    );
  const entryId = (created.data as { id: string }).id;
  const ref = { scopeKind: "collection" as const, scopeSlug: "posts", entryId };
  // The create recorded a version; start the seeded history afresh.
  await current.adapter.delete("nextly_versions", {
    and: [{ column: "entryId", op: "=", value: entryId }],
  });
  const repo = new VersionsRepository(
    current.adapter as unknown as ConstructorParameters<
      typeof VersionsRepository
    >[0]
  );
  for (const [index, locale] of locales.entries()) {
    await repo.insertVersion({
      ref,
      versionNo: index + 1,
      status: "draft",
      isAutosave: false,
      snapshot: { title: `v${index + 1}` },
      locale,
    });
  }
  const at = { scopeKind: "collection" as const, slug: "posts", entryId };
  const mark = (
    user: { id: string; email: string },
    versionNo: number,
    authenticatedScope?: AuthenticatedScope
  ) =>
    markVersionSeenForDocument({ ...at, user, authenticatedScope, versionNo });
  const looked = (user: { id: string }, part: string | null) =>
    readLastLookedAt(current!.adapter, { userId: user.id, ref, part });
  /** End the person's current visit, as if they left more than the gap ago. */
  const leave = (user: { id: string }) =>
    current!.adapter.update(
      "nextly_version_views",
      { viewedAt: new Date(Date.now() - VISIT_GAP_MS - 60_000) },
      { and: [{ column: "userId", op: "=", value: user.id }] }
    );
  const markers = () =>
    current!.adapter.select<{
      userId: string;
      part: string | null;
      versionNo: number;
      previousVersionNo: number | null;
    }>("nextly_version_views");
  const compareSinceLooked = (
    user: { id: string; email: string },
    to: number,
    authenticatedScope?: AuthenticatedScope
  ) =>
    getVersionDiffForDocument({
      ...at,
      user,
      authenticatedScope,
      to,
      baseline: "last-viewed",
    });
  /** Move one marker's last mark `minutes` into the past, and no other. */
  const age = async (
    user: { id: string },
    part: string | null,
    minutes: number,
    entry: string = entryId
  ) => {
    const rows = await current!.adapter.select<{
      id: string;
      viewedAt: Date | string | number;
      part: string | null;
      entryId: string;
    }>("nextly_version_views", {
      where: { and: [{ column: "userId", op: "=", value: user.id }] },
    });
    const row = rows.find(r => r.part === part && r.entryId === entry);
    await current!.adapter.update(
      "nextly_version_views",
      {
        viewedAt: new Date(
          new Date(row!.viewedAt).getTime() - minutes * 60_000
        ),
      },
      { and: [{ column: "id", op: "=", value: row!.id }] }
    );
  };
  return {
    entryId,
    ref,
    at,
    mark,
    looked,
    leave,
    age,
    markers,
    compareSinceLooked,
  };
}

/**
 * Hold a deletion's lock (`lock`), start a mark, wait until the mark is
 * blocked on that lock, then let the deletion finish (`finish`) and commit.
 * The mark must be refused as not found: it waited, and found what it marks
 * gone.
 */
async function raceAgainst(
  dialect: TestDialect,
  lock: (tx: TransactionContext) => Promise<void>,
  finish: (tx: TransactionContext) => Promise<void>,
  mark: () => Promise<unknown>
) {
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let locked!: () => void;
  const lockTaken = new Promise<void>(resolve => {
    locked = resolve;
  });
  const deleting = current!.adapter.transaction(async tx => {
    await lock(tx);
    locked();
    await held;
    await finish(tx);
  });
  await lockTaken;
  const marking = refusal(mark());
  try {
    await untilSomeoneWaitsOnALock(current!.adapter, dialect);
  } finally {
    release();
  }
  await deleting;
  expect(await marking).toMatchObject({ code: "NOT_FOUND" });
}

/** A refusal's `code` and first error code, whatever threw it. */
async function refusal(work: Promise<unknown>) {
  return work.then(
    () => undefined,
    (error: unknown) =>
      error as { code?: string; publicData?: { errors?: { code: string }[] } }
  );
}

describe.each(getConfiguredTestDialects())(
  "last looked at (integration, %s)",
  dialect => {
    it("records nothing on a read, list or comparison; a mark moves it, and the same mark again changes nothing", async () => {
      const doc = await documentWithHistory(dialect, ["en", "en", "en"]);

      await listVersionsForDocument({ ...doc.at, user: ANA });
      await getVersionForDocument({ ...doc.at, user: ANA, versionNo: 2 });
      await getVersionDiffForDocument({ ...doc.at, user: ANA, from: 1, to: 2 });
      expect(await doc.markers()).toEqual([]);

      await doc.mark(ANA, 2);
      const first = await doc.markers();
      expect(first).toMatchObject([
        { userId: "ana", part: "en", versionNo: 2, previousVersionNo: null },
      ]);
      await doc.mark(ANA, 2);
      expect(await doc.markers()).toMatchObject([
        { userId: "ana", part: "en", versionNo: 2, previousVersionNo: null },
      ]);
    });

    it("refuses a mark from an API key and from the system", async () => {
      const doc = await documentWithHistory(dialect, ["en", "en"]);

      expect(await refusal(doc.mark(ANA, 1, KEY))).toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await refusal(doc.mark(ANA, 1, SYSTEM))).toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await doc.markers()).toEqual([]);
    });

    // The collection's own read rule is the route's to apply, before any
    // version method runs; what the method's gate refuses is a document the
    // reader cannot load, which is what this case asks of it.
    it("refuses a mark on a document the reader cannot load, and for another document's version", async () => {
      const gone = await documentWithHistory(dialect, ["en", "en"]);
      await current!.getService("collectionsHandler").deleteEntry({
        collectionName: "posts",
        entryId: gone.entryId,
        overrideAccess: true,
      });
      // Its history outlives it, so only the gate can refuse the mark.
      expect(
        (
          await current!.adapter.select<{ entryId: string }>("nextly_versions")
        ).filter(row => row.entryId === gone.entryId)
      ).toHaveLength(2);
      expect(await refusal(gone.mark(ANA, 1))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await gone.markers()).toEqual([]);
      await current!.destroy();
      current = undefined;

      const doc = await documentWithHistory(dialect, ["en", "en"]);
      // Version 3 exists only on another document of the same collection.
      await doc.mark(ANA, 1);
      const before = await doc.markers();
      const other = await current!
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "posts", overrideAccess: true, locale: "en" },
          { title: "other" }
        );
      const otherId = (other.data as { id: string }).id;
      for (const title of ["b", "c"]) {
        await current!.getService("collectionsHandler").updateEntry(
          {
            collectionName: "posts",
            entryId: otherId,
            overrideAccess: true,
            locale: "en",
          },
          { title }
        );
      }
      expect(await refusal(doc.mark(ANA, 3))).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await doc.markers()).toEqual(before);
    });

    it("runs each marker's visit from its own last mark", async () => {
      // v1 en, v2 es, on this document; a second document with its own v1.
      const doc = await documentWithHistory(dialect, ["en", "es"]);
      const second = await current!
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "posts", overrideAccess: true, locale: "en" },
          { title: "second" }
        );
      const secondId = (second.data as { id: string }).id;
      const markSecond = () =>
        markVersionSeenForDocument({
          scopeKind: "collection",
          slug: "posts",
          entryId: secondId,
          user: ANA,
          versionNo: 1,
        });

      await doc.mark(ANA, 1); // English
      await doc.age(ANA, "en", 20);
      // Marks elsewhere, inside English's visit, neither extend nor end it.
      await doc.mark(ANA, 2); // Spanish
      await markSecond();
      expect(await doc.looked(ANA, "en")).toBeNull();
      await doc.age(ANA, "en", 11); // 31 minutes after English's own mark
      expect(await doc.looked(ANA, "en")).toBe(1);
      // Spanish and the second document are still in their visits.
      expect(await doc.looked(ANA, "es")).toBeNull();
      expect(
        await readLastLookedAt(current!.adapter, {
          userId: ANA.id,
          ref: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: secondId,
          },
          part: "en",
        })
      ).toBeNull();
    });

    it("counts marks by visit, whatever order they arrive in", async () => {
      const doc = await documentWithHistory(dialect, ["en", "en", "en", "en"]);

      // One visit, marks out of order: the marker only moves forward, and
      // there is no previous visit to have looked at yet.
      await doc.mark(ANA, 3);
      await doc.mark(ANA, 1);
      await doc.mark(ANA, 2);
      await doc.mark(MARTA, 1);
      await doc.mark(MARTA, 2);
      await doc.mark(MARTA, 3);
      for (const person of [ANA, MARTA]) {
        expect(await doc.looked(person, "en")).toBeNull();
      }

      // That visit ends: its furthest version is what they last looked at,
      // for both orders alike.
      await doc.leave(ANA);
      await doc.leave(MARTA);
      expect(await doc.looked(ANA, "en")).toBe(3);
      expect(await doc.looked(MARTA, "en")).toBe(3);

      // The next visit begins with an older version and moves on: "last
      // looked at" stays the previous visit's until this one ends too.
      await doc.mark(ANA, 1);
      await doc.mark(ANA, 4);
      expect(await doc.looked(ANA, "en")).toBe(3);
      await doc.leave(ANA);
      expect(await doc.looked(ANA, "en")).toBe(4);
    });

    it("keeps each person's marker per language, and compares from it", async () => {
      // v1 en, v2 es, v3 en, v4 es, v5 en, v6 es
      const doc = await documentWithHistory(dialect, [
        "en",
        "es",
        "en",
        "es",
        "en",
        "es",
      ]);
      // Ana looks at English, then Spanish; Marta at Spanish only.
      await doc.mark(ANA, 1);
      await doc.mark(ANA, 2);
      await doc.mark(MARTA, 4);
      await doc.leave(ANA);
      await doc.leave(MARTA);

      const anaEnglish = await doc.compareSinceLooked(ANA, 5);
      expect(anaEnglish).toMatchObject({
        from: 1,
        to: 5,
        baseline: { name: "last-viewed", versionNo: 1 },
      });
      const anaSpanish = await doc.compareSinceLooked(ANA, 6);
      expect(anaSpanish).toMatchObject({ from: 2, to: 6 });
      const martaSpanish = await doc.compareSinceLooked(MARTA, 6);
      expect(martaSpanish).toMatchObject({ from: 4, to: 6 });

      // Marta never looked at English: nothing to compare with, and she is
      // told why.
      const martaEnglish = await refusal(doc.compareSinceLooked(MARTA, 5));
      expect(martaEnglish?.publicData?.errors?.[0]?.code).toBe("NO_BASELINE");
      // A key has no marker of its own and never reaches its owner's.
      const key = await refusal(doc.compareSinceLooked(ANA, 5, KEY));
      expect(key?.publicData?.errors?.[0]?.code).toBe("NO_BASELINE");
    });

    it("compares with the nearest older version when the one looked at was removed, and names it", async () => {
      const doc = await documentWithHistory(dialect, [
        "en",
        "en",
        "en",
        "en",
        "en",
      ]);
      await doc.mark(ANA, 3);
      await doc.leave(ANA);
      // Retention removed version 3.
      await current!.adapter.delete("nextly_versions", {
        and: [
          { column: "entryId", op: "=", value: doc.entryId },
          { column: "versionNo", op: "=", value: 3 },
        ],
      });

      expect(await doc.compareSinceLooked(ANA, 5)).toMatchObject({
        from: 2,
        to: 5,
        baseline: { name: "last-viewed", versionNo: 2, replaces: 3 },
      });
    });

    it("says the version looked at was removed when the one standing in for it is the target", async () => {
      const doc = await documentWithHistory(dialect, ["en", "en", "en"]);
      await doc.mark(ANA, 3);
      await doc.leave(ANA);
      await current!.adapter.delete("nextly_versions", {
        and: [
          { column: "entryId", op: "=", value: doc.entryId },
          { column: "versionNo", op: "=", value: 3 },
        ],
      });

      // Version 2 stands in for the removed 3, and is the target itself.
      const refused = await refusal(doc.compareSinceLooked(ANA, 2));
      expect(refused?.publicData?.errors?.[0]).toMatchObject({
        code: "NO_BASELINE",
        message: expect.stringMatching(/was removed/),
      });
    });

    it("marks where a person last looked in the history list, and records nothing", async () => {
      const doc = await documentWithHistory(dialect, ["en", "en", "en", "en"]);
      await doc.mark(ANA, 2);
      await doc.leave(ANA);
      const before = await doc.markers();

      const page = await listVersionsForDocument({ ...doc.at, user: ANA });
      expect(
        page.items
          .filter(row => (row as { lastViewed?: true }).lastViewed)
          .map(row => row.versionNo)
      ).toEqual([2]);
      // Another person, and a key, see no divider.
      for (const caller of [
        { user: MARTA },
        { user: ANA, authenticatedScope: KEY },
      ]) {
        const other = await listVersionsForDocument({ ...doc.at, ...caller });
        expect(
          other.items.some(row => (row as { lastViewed?: true }).lastViewed)
        ).toBe(false);
      }
      expect(await doc.markers()).toEqual(before);
    });

    it("marks the nearest kept row of the part on whichever page it falls, however the parts interleave", async () => {
      // v1 en, v2-v5 es, v6 en, v7 es.
      const doc = await documentWithHistory(dialect, [
        "en",
        "es",
        "es",
        "es",
        "es",
        "en",
        "es",
      ]);
      await doc.mark(ANA, 6);
      await doc.leave(ANA);
      // Retention removed v6: v1, three pages down, stands in for it.
      await current!.adapter.delete("nextly_versions", {
        and: [
          { column: "entryId", op: "=", value: doc.entryId },
          { column: "versionNo", op: "=", value: 6 },
        ],
      });

      const marked: (number | null)[] = [];
      let cursor: number | undefined;
      do {
        const page = await listVersionsForDocument({
          ...doc.at,
          user: ANA,
          limit: 2,
          cursor,
        });
        marked.push(
          ...page.items
            .filter(row => (row as { lastViewed?: true }).lastViewed)
            .map(row => row.versionNo)
        );
        const last = page.items[page.items.length - 1];
        cursor =
          page.meta.hasNext && last?.versionNo ? last.versionNo : undefined;
      } while (cursor !== undefined);
      expect(marked).toEqual([1]);
    });

    it("finds every part's divider in one read, and the history list asks it", async () => {
      // v1 en, v2 es, v3 en, v4 es.
      const doc = await documentWithHistory(dialect, ["en", "es", "en", "es"]);
      // An adapter whose database counts the queries it RUNS, not the ones it
      // builds: a lookup that built one query and ran it once per part would
      // make three round trips here, not one.
      let reads = 0;
      const adapter = current!.adapter;
      const counting = new Proxy(adapter, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (prop !== "getDrizzle" || typeof value !== "function") {
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (...args: unknown[]) =>
            countingRuns(value.apply(target, args) as object, () => {
              reads += 1;
            });
        },
      });
      const dividers = await new HistoryDividers(
        counting as unknown as ConstructorParameters<typeof HistoryDividers>[0],
        silentLogger
      ).nearestKeptByPart(
        doc.ref,
        new Map<string | null, number>([
          ["en", 3],
          ["es", 4],
          [null, 2],
        ])
      );
      expect(dividers).toEqual(
        new Map<string | null, number>([
          ["en", 3],
          ["es", 4],
        ])
      );
      expect(reads).toBe(1);

      // The history list finds its dividers through this one lookup, once,
      // with every part the person has looked at.
      await doc.mark(ANA, 3);
      await doc.mark(ANA, 4);
      await doc.leave(ANA);
      const lookup = vi.spyOn(HistoryDividers.prototype, "nearestKeptByPart");
      try {
        await listVersionsForDocument({ ...doc.at, user: ANA });
        expect(lookup).toHaveBeenCalledTimes(1);
        // Each part with the version looked at in it, not merely the parts:
        // the wrong number for a language marks the wrong row.
        expect(lookup.mock.calls[0]?.[1]).toEqual(
          new Map<string | null, number>([
            ["en", 3],
            ["es", 4],
          ])
        );
      } finally {
        lookup.mockRestore();
      }
    });

    it("finds each part's divider below its own version, whatever the other parts looked at", async () => {
      // v1 en, v2 es, v3 en, v4 es, v5 en, v6 es.
      const doc = await documentWithHistory(dialect, [
        "en",
        "es",
        "en",
        "es",
        "en",
        "es",
      ]);
      // Retention removed v3, the version looked at in English.
      await current!.adapter.delete("nextly_versions", {
        and: [
          { column: "entryId", op: "=", value: doc.entryId },
          { column: "versionNo", op: "=", value: 3 },
        ],
      });
      const dividers = await new HistoryDividers(
        current!.adapter as unknown as ConstructorParameters<
          typeof HistoryDividers
        >[0],
        silentLogger
      ).nearestKeptByPart(
        doc.ref,
        new Map<string | null, number>([
          ["en", 3],
          ["es", 6],
          // A part with no version at or below the one looked at has none.
          [null, 4],
        ])
      );
      // English falls back to v1, not to v5, which is past where they looked
      // in English though below where they looked in Spanish.
      expect(dividers).toEqual(
        new Map<string | null, number>([
          ["en", 1],
          ["es", 6],
        ])
      );
    });

    it.skipIf(dialect === "sqlite")(
      "refuses a mark that waited on a deletion of its document, and leaves no marker",
      async () => {
        const doc = await documentWithHistory(dialect, ["en", "en"]);
        const posts = await current!
          .getService("collectionRegistryService")
          .getCollectionBySlug("posts");
        await raceAgainst(
          dialect,
          async tx => {
            await tx.selectOne(posts!.tableName, {
              where: { and: [{ column: "id", op: "=", value: doc.entryId }] },
              forUpdate: true,
            });
          },
          async tx => {
            await tx.delete(posts!.tableName, {
              and: [{ column: "id", op: "=", value: doc.entryId }],
            });
            await tx.delete("nextly_version_views", {
              and: [{ column: "entryId", op: "=", value: doc.entryId }],
            });
          },
          () => doc.mark(ANA, 1)
        );
        expect(await doc.markers()).toEqual([]);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "refuses a mark that waited on its person's account deletion, and leaves no marker",
      async () => {
        const doc = await documentWithHistory(dialect, ["en", "en"]);
        const now = new Date();
        await current!.adapter.insert("users", {
          id: "leaving",
          email: "leaving@x.test",
          name: "Leaving",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        const where = {
          and: [{ column: "id", op: "=" as const, value: "leaving" }],
        };
        await raceAgainst(
          dialect,
          async tx => {
            await tx.selectOne("users", { where, forUpdate: true });
          },
          async tx => {
            await tx.delete("nextly_version_views", {
              and: [{ column: "userId", op: "=", value: "leaving" }],
            });
            await tx.delete("users", where);
          },
          () => doc.mark({ id: "leaving", email: "leaving@x.test" }, 1)
        );
        expect(await doc.markers()).toEqual([]);
      }
    );

    it("removes markers with the document, the collection and the person", async () => {
      const doc = await documentWithHistory(dialect, ["en", "en"]);
      const handler = current!.getService("collectionsHandler");

      // The person: a real account, deleted the way an administrator would.
      const now = new Date();
      await current!.adapter.insert("users", {
        id: "leaving",
        email: "leaving@x.test",
        name: "Leaving",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await doc.mark({ id: "leaving", email: "leaving@x.test" }, 1);
      await doc.mark(ANA, 1);
      await new UserMutationService(current!.adapter, silentLogger).deleteUser(
        "leaving"
      );
      expect((await doc.markers()).map(m => m.userId)).toEqual(["ana"]);

      // The document.
      await handler.deleteEntry({
        collectionName: "posts",
        entryId: doc.entryId,
        overrideAccess: true,
      });
      expect(await doc.markers()).toEqual([]);

      // The collection: a marker on another document of it goes with it.
      const second = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { title: "second" }
      );
      const secondId = (second.data as { id: string }).id;
      await markVersionSeenForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: secondId,
        user: ANA,
        versionNo: 1,
      });
      expect(await doc.markers()).toHaveLength(1);
      await current!
        .getService("collectionRegistryService")
        .deleteCollection("posts", { force: true });
      expect(await doc.markers()).toEqual([]);
    });
  }
);
