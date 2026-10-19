/**
 * The record of content events, on a real database: every field is kept, an
 * event commits and rolls back with its change, parts filter and page in SQL,
 * and a deleted subject's events go once the activity log's window has passed
 * since its deletion.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { SHARED_PART } from "../../../schemas/content-events";
import { registerContentEventKind, resetContentEventKinds } from "../kinds";
import { pruneContentEventsSafely, type ContentEventsPruneDb } from "../prune";
import { recordContentEvent, type ContentEventInput } from "../record";
import { ContentEventsRepository } from "../repository";

import { recordAsACaller } from "./record-as-a-caller";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetContentEventKinds();
});

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Seals the key that names a deleted person: a throwaway made for this file. */
const SECRET = "content-events-secret-made-for-this-file-0123";

async function setup(dialect: TestDialect) {
  registerContentEventKind({
    name: "published-by-release",
    label: "Published by release {release}",
    payload: z.object({ release: z.string() }),
  });
  registerContentEventKind({ name: "saved", label: "Saved by {actor}" });
  // A deletion kind for the test; the document's own comes with its writer.
  registerContentEventKind({
    name: "test-deleted",
    label: "Deleted",
    endsSubject: true,
  });
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
    ],
    singles: [
      defineSingle({ slug: "masthead", fields: [text({ name: "heading" })] }),
    ],
  });
  const repo = new ContentEventsRepository(current.adapter, silentLogger);
  const record = (input: ContentEventInput) =>
    recordAsACaller(current!, dialect, input, [SECRET]);
  const events = () =>
    current!.adapter.select<{ id: string; subjectId: string }>(
      "nextly_content_events"
    );
  const parts = () =>
    current!.adapter.select<{ eventId: string; part: string }>(
      "nextly_content_event_parts"
    );
  /** Move an event `days` into the past. */
  const age = (id: string, days: number) =>
    current!.adapter.update(
      "nextly_content_events",
      { occurredAt: new Date(Date.now() - days * DAY_MS) },
      { and: [{ column: "id", op: "=", value: id }] }
    );
  return { repo, record, events, parts, age };
}

const doc = (id: string) =>
  ({ kind: "collection", slug: "posts", id }) as const;

describe.each(getConfiguredTestDialects())(
  "content events (integration, %s)",
  dialect => {
    it("keeps every field, for a document, a Single and a release, and for each kind of actor", async () => {
      const t = await setup(dialect);
      const before = Date.now() - 60_000;
      await t.record({
        subject: doc("e1"),
        parts: { locales: ["en"], shared: true },
        kind: "published-by-release",
        actor: { kind: "release", id: "r1", name: "Autumn launch" },
        fromState: "draft",
        toState: "published",
        note: "Launch day",
        versionNo: 7,
        payload: { release: "Autumn launch" },
        definitionHash: "a".repeat(64),
      });
      await t.record({
        subject: { kind: "single", slug: "masthead", id: "s1" },
        kind: "saved",
        actor: { kind: "apiKey", id: "k1", name: "CI key" },
      });
      await t.record({
        subject: { kind: "release", id: "r1" },
        kind: "saved",
        actor: { kind: "system" },
      });
      await t.record({
        subject: doc("e1"),
        parts: { locales: ["es"] },
        kind: "saved",
        actor: {
          kind: "principal",
          principalKind: "customer",
          id: "c1",
          name: "Kim",
        },
      });

      const docPage = await t.repo.listForSubject(doc("e1"), { limit: 10 });
      expect(docPage.items).toHaveLength(2);
      const [principal, published] = docPage.items;
      expect(principal).toMatchObject({
        kind: "saved",
        actorKind: "principal",
        actorPrincipalKind: "customer",
        actorId: "c1",
        actorName: "Kim",
        parts: ["es"],
        payload: null,
      });
      expect(published).toMatchObject({
        subjectKind: "collection",
        subjectSlug: "posts",
        subjectId: "e1",
        kind: "published-by-release",
        actorKind: "release",
        actorId: "r1",
        actorPrincipalKind: null,
        actorName: "Autumn launch",
        fromState: "draft",
        toState: "published",
        note: "Launch day",
        versionNo: 7,
        payload: { release: "Autumn launch" },
        definitionHash: "a".repeat(64),
        parts: ["en", SHARED_PART].sort(),
      });
      expect(published!.occurredAt.getTime()).toBeGreaterThan(before);

      const single = await t.repo.listForSubject(
        { kind: "single", slug: "masthead", id: "s1" },
        { limit: 10 }
      );
      expect(single.items).toMatchObject([
        {
          subjectKind: "single",
          actorKind: "apiKey",
          actorId: "k1",
          parts: [],
        },
      ]);
      const release = await t.repo.listForSubject(
        { kind: "release", id: "r1" },
        { limit: 10 }
      );
      expect(release.items).toMatchObject([
        {
          subjectKind: "release",
          subjectSlug: null,
          actorKind: "system",
          actorId: null,
        },
      ]);
    });

    it("writes an event in its change's transaction, so a failed change leaves neither", async () => {
      const t = await setup(dialect);
      const created = await current!
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "posts", overrideAccess: true },
          { title: "before" }
        );
      const entryId = (created.data as { id: string }).id;
      const posts = await current!
        .getService("collectionRegistryService")
        .getCollectionBySlug("posts");

      const failed = await current!.adapter
        .transaction(async tx => {
          await tx.update(
            posts!.tableName,
            { title: "after" },
            { and: [{ column: "id", op: "=", value: entryId }] }
          );
          await recordContentEvent(tx, {
            subject: doc(entryId),
            parts: { locales: ["en"] },
            kind: "saved",
            actor: { kind: "person", id: "u1", name: "Ana" },
          });
          throw new Error("the change fails after its event is written");
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );

      expect(failed).toBeInstanceOf(Error);
      // Only the create's own history is left: the event the failed change
      // wrote went with it, and so did its part.
      expect(
        (await t.events()).map(e => (e as { kind?: string }).kind)
      ).toEqual(["created"]);
      expect(await t.parts()).toEqual([]);
      const [row] = await current!.adapter.select<{ title: string }>(
        posts!.tableName,
        { where: { and: [{ column: "id", op: "=", value: entryId }] } }
      );
      expect(row?.title).toBe("before");
    });

    it("filters by part and pages in the database, newest first", async () => {
      const t = await setup(dialect);
      const saved = (locales: string[], shared = false) =>
        t.record({
          subject: doc("e1"),
          parts: { locales, shared },
          kind: "saved",
          actor: { kind: "person", id: "u1", name: "Ana" },
        });
      const e1 = await saved(["en"]);
      await saved(["es"]);
      const e3 = await saved([], true);
      const e4 = await saved(["en"], true);
      await saved(["es"]);

      // One language, a page at a time.
      const first = await t.repo.listForSubject(doc("e1"), {
        parts: ["en"],
        limit: 1,
      });
      expect(first.items.map(e => e.id)).toEqual([e4.id]);
      const second = await t.repo.listForSubject(doc("e1"), {
        parts: ["en"],
        limit: 1,
        before: first.nextBefore!,
      });
      expect(second.items.map(e => e.id)).toEqual([e1.id]);
      expect(second.nextBefore).toBeNull();

      // The shared fields.
      const shared = await t.repo.listForSubject(doc("e1"), {
        parts: [SHARED_PART],
        limit: 10,
      });
      expect(shared.items.map(e => e.id)).toEqual([e4.id, e3.id]);

      // An event that involved both asked-for parts is listed once.
      const both = await t.repo.listForSubject(doc("e1"), {
        parts: ["en", SHARED_PART],
        limit: 10,
      });
      expect(both.items.map(e => e.id)).toEqual([e4.id, e3.id, e1.id]);

      // Unfiltered, every event, paged newest first without repeats.
      const seen: string[] = [];
      let before: string | undefined;
      do {
        const page = await t.repo.listForSubject(doc("e1"), {
          limit: 2,
          before,
        });
        seen.push(...page.items.map(e => e.id));
        before = page.nextBefore ?? undefined;
      } while (before);
      expect(seen).toHaveLength(5);
      expect([...seen].sort().reverse()).toEqual(seen);
    });

    it("keeps a subject's events while it exists, and removes them after the window from its deletion", async () => {
      const t = await setup(dialect);
      const actor = { kind: "system" } as const;
      // A document's event involves a language; a release's involves none.
      const saved = (subject: ContentEventInput["subject"]) =>
        t.record({
          subject,
          kind: "saved",
          actor,
          parts: subject.kind === "release" ? {} : { locales: ["en"] },
        });
      const deleted = (subject: ContentEventInput["subject"]) =>
        t.record({ subject, kind: "test-deleted", actor });

      // Deleted long ago: a document and a release.
      for (const subject of [
        doc("gone"),
        { kind: "release", id: "old" } as const,
      ]) {
        const old = await saved(subject);
        const end = await deleted(subject);
        await t.age(old.id, 120);
        await t.age(end.id, 100);
      }
      // Deleted within the window.
      await saved(doc("recent"));
      const recent = await deleted(doc("recent"));
      await t.age(recent.id, 30);
      // Never deleted, with events far older than the window.
      const live = await saved(doc("live"));
      await t.age(live.id, 400);

      await pruneContentEventsSafely(
        { db: current!.adapter, logger: silentLogger },
        90 * DAY_MS,
        10
      );

      const left = (await t.events()).map(e => e.subjectId).sort();
      expect(left).toEqual(["live", "recent", "recent"]);
      // The removed events' parts went with them.
      const events = new Set((await t.events()).map(e => e.id));
      expect((await t.parts()).every(p => events.has(p.eventId))).toBe(true);
    });

    it("keeps the events of a subject recreated after its deletion", async () => {
      const t = await setup(dialect);
      const actor = { kind: "system" } as const;
      const old = await t.record({
        subject: doc("again"),
        kind: "saved",
        actor,
      });
      const end = await t.record({
        subject: doc("again"),
        kind: "test-deleted",
        actor,
      });
      await t.age(old.id, 120);
      await t.age(end.id, 100);
      // Created again under the same id, after the deletion.
      const reborn = await t.record({
        subject: doc("again"),
        kind: "saved",
        actor,
      });

      await pruneContentEventsSafely(
        { db: current!.adapter, logger: silentLogger },
        90 * DAY_MS,
        10
      );

      expect((await t.events()).map(e => e.id)).toEqual([reborn.id]);
    });

    it("tells the lives apart by what the deletion stamped, whatever order other processes' ids sort in", async () => {
      const t = await setup(dialect);
      const actor = { kind: "system" } as const;
      const old = await t.record({
        subject: doc("skew"),
        kind: "saved",
        actor,
      });
      const end = await t.record({
        subject: doc("skew"),
        kind: "test-deleted",
        actor,
      });
      const reborn = await t.record({
        subject: doc("skew"),
        kind: "saved",
        actor,
      });
      // Ids written by processes whose clocks disagree: the old life's event
      // sorts after its deletion, and the new life's before it.
      const AHEAD = "ffffffff-ffff-7fff-bfff-ffffffffffff";
      const BEHIND = "00000000-0000-7000-8000-000000000000";
      for (const [from, to] of [
        [old.id, AHEAD],
        [reborn.id, BEHIND],
      ]) {
        await current!.adapter.update(
          "nextly_content_events",
          { id: to },
          { and: [{ column: "id", op: "=", value: from }] }
        );
      }
      await current!.adapter.update(
        "nextly_content_events",
        { occurredAt: new Date(Date.now() - 100 * DAY_MS) },
        { and: [{ column: "id", op: "IN", value: [AHEAD, end.id] }] }
      );

      await pruneContentEventsSafely(
        { db: current!.adapter, logger: silentLogger },
        90 * DAY_MS,
        10
      );

      expect((await t.events()).map(e => e.id)).toEqual([BEHIND]);
    });

    it("prunes a deleted subject whose deletion kind is no longer registered", async () => {
      const t = await setup(dialect);
      const end = await t.record({
        subject: doc("retired"),
        kind: "test-deleted",
        actor: { kind: "system" },
      });
      await t.age(end.id, 100);
      // The kind is gone from the registry; the event says what it was.
      resetContentEventKinds();

      await pruneContentEventsSafely(
        { db: current!.adapter, logger: silentLogger },
        90 * DAY_MS,
        10
      );

      expect(await t.events()).toEqual([]);
    });

    it("finishes a large deleted subject over passes, its deletion event last", async () => {
      const t = await setup(dialect);
      const actor = { kind: "system" } as const;
      // One more event than a batch, then the deletion.
      await current!.adapter.transaction(async tx => {
        for (let i = 0; i < 501; i += 1) {
          await recordContentEvent(tx, {
            subject: doc("big"),
            kind: "saved",
            actor,
          });
        }
      });
      const end = await t.record({
        subject: doc("big"),
        kind: "test-deleted",
        actor,
      });
      await current!.adapter.update(
        "nextly_content_events",
        { occurredAt: new Date(Date.now() - 100 * DAY_MS) },
        { and: [{ column: "subjectId", op: "=", value: "big" }] }
      );

      // One batch: the oldest 500 go, and the deletion event stays to be found.
      await pruneContentEventsSafely(
        { db: current!.adapter, logger: silentLogger },
        90 * DAY_MS,
        1
      );
      const left = await t.events();
      expect(left).toHaveLength(2);
      expect(left.map(e => e.id)).toContain(end.id);

      await pruneContentEventsSafely(
        { db: current!.adapter, logger: silentLogger },
        90 * DAY_MS,
        1
      );
      expect(await t.events()).toEqual([]);
      expect(await t.parts()).toEqual([]);
    });

    it("leaves a batch's events with their parts when its delete fails part-way", async () => {
      const t = await setup(dialect);
      const actor = { kind: "system" } as const;
      const old = await t.record({
        subject: doc("halted"),
        kind: "saved",
        actor,
        parts: { locales: ["en"] },
      });
      const end = await t.record({
        subject: doc("halted"),
        kind: "test-deleted",
        actor,
      });
      await t.age(old.id, 120);
      await t.age(end.id, 100);
      // The events delete fails, as a lost connection would, after the parts
      // delete has run: on the transaction, or on the adapter itself.
      const adapter = current!.adapter;
      const failingDelete =
        (run: Pick<ContentEventsPruneDb, "delete">) =>
        async (...args: Parameters<ContentEventsPruneDb["delete"]>) => {
          if (args[0] === "nextly_content_events") {
            throw new Error("connection lost");
          }
          return run.delete(...args);
        };
      const failing: ContentEventsPruneDb = {
        select: (table, options) => adapter.select(table, options),
        delete: failingDelete(adapter),
        // A batch only deletes on its transaction, so the handle it is given
        // carries the failing delete alone.
        transaction: (work, options) =>
          adapter.transaction(
            tx =>
              work({
                delete: failingDelete(tx),
              } as unknown as TransactionContext),
            options
          ),
      };

      const result = await pruneContentEventsSafely(
        { db: failing, logger: silentLogger },
        90 * DAY_MS,
        10
      );

      expect(result.removed).toBe(0);
      expect((await t.events()).map(e => e.id).sort()).toEqual(
        [old.id, end.id].sort()
      );
      expect(await t.parts()).toEqual([{ eventId: old.id, part: "en" }]);
    });
  }
);
