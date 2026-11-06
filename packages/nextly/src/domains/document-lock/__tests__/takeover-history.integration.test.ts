/**
 * Taking a document over is recorded in that document's history, on every
 * dialect, and nothing else the lock does is.
 *
 * The claim and its event belong to one transaction. That is shown two ways:
 * the event's insert is watched running on the transaction that replaces the
 * claim (not the pool, not a transaction of its own), and a failed event is
 * shown to leave the previous holder's row and token exactly as they were,
 * on each real database rather than a unit double of the transaction.
 *
 * The events are read back through the document's history read (the Direct
 * API's `contentEvents.list`), the one every surface uses, rather than from
 * the table, so a takeover recorded under the wrong subject or kind reads as
 * missing here exactly as it would in the admin.
 */

import type {
  TransactionContext,
  TransactionOptions,
} from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { futureExpression } from "../../../database/lease-clock";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DOCUMENT_LOCK_TABLE } from "../../../schemas/document-lock";
import type { ContentEventSubject } from "../../content-events/record";
import {
  acquireDocumentLock,
  readDocumentLock,
  releaseDocumentLock,
  renewDocumentLock,
  type DocumentLockClaimant,
} from "../document-lock-repository";
import { documentLockKey } from "../lock-key";
import type { DocumentRef } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ADA = { id: "user-ada", name: "Ada", email: "ada@x.test" };
const GRACE = { id: "user-grace", name: "Grace", email: "grace@x.test" };

/** A person claiming as the lock route claims for them. */
function claimant(person: typeof ADA): DocumentLockClaimant {
  return {
    ownerId: person.id,
    ownerLabel: person.name,
    actor: { type: "user", id: person.id },
    personName: person.name,
  };
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "masthead",
        fields: [text({ name: "heading" })],
      }),
    ],
  });
  // The leg runs on the database it is named for: the harness boots SQLite
  // unless told otherwise.
  expect(current.adapter.getCapabilities().dialect).toBe(dialect);
  const now = new Date();
  for (const person of [ADA, GRACE]) {
    await current.adapter.insert("users", {
      ...person,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return current;
}

/** A post, and the lock reference and history subject that name it. */
async function post(
  t: TestNextly
): Promise<{ ref: DocumentRef; subject: ContentEventSubject }> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title: "one" },
  });
  const id = (created.item as { id: string }).id;
  return {
    ref: { scopeKind: "collection", slug: "posts", entryId: id },
    subject: { kind: "collection", slug: "posts", id },
  };
}

/** The Single's document, as the Single editor names it to the lock. */
async function masthead(
  t: TestNextly
): Promise<{ ref: DocumentRef; subject: ContentEventSubject }> {
  const saved = await t.nextly.updateSingle({
    slug: "masthead",
    data: { heading: "one", _overwrite: true },
  });
  const id = (saved.item as { id: string }).id;
  return {
    ref: { scopeKind: "single", slug: "masthead", entryId: id },
    subject: { kind: "single", slug: "masthead", id },
  };
}

/** The document's events, newest first, through the history read. */
async function historyOf(t: TestNextly, subject: ContentEventSubject) {
  return (await t.nextly.contentEvents.list({ subject, limit: 100 })).items;
}

/** Claim as `who`, failing loudly rather than returning an unusable token. */
async function claim(
  t: TestNextly,
  ref: DocumentRef,
  who: typeof ADA,
  options?: { takeover?: boolean; requestAccess?: boolean }
): Promise<string> {
  const got = await acquireDocumentLock(t.adapter, ref, claimant(who), options);
  if (got.status !== "acquired") {
    throw new Error(`expected to acquire, got ${got.status}`);
  }
  return got.claimToken;
}

/**
 * The adapter, watched: the tables each transaction it opens inserts into, in
 * the order they were opened, and those it inserts into on its own pool.
 * Calls are made on the real adapter and the real transaction, so nothing
 * about the write changes; the watch only reports where it happened.
 */
function watched(adapter: TestNextly["adapter"]) {
  const transactions: string[][] = [];
  const pool: string[] = [];
  const recording = (
    target: object,
    insert: unknown,
    into: string[]
  ): ((...args: unknown[]) => unknown) => {
    if (typeof insert !== "function") throw new Error("no insert to watch");
    return (...args: unknown[]): unknown => {
      into.push(String(args[0]));
      return Reflect.apply(insert, target, args) as unknown;
    };
  };
  const ctxWatched = (ctx: TransactionContext, inserts: string[]) =>
    new Proxy(ctx, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop === "insert") return recording(target, value, inserts);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const proxy = new Proxy(adapter, {
    get(target, prop) {
      if (prop === "transaction") {
        return <T>(
          work: (ctx: TransactionContext) => Promise<T>,
          options?: TransactionOptions
        ): Promise<T> => {
          const inserts: string[] = [];
          transactions.push(inserts);
          return target.transaction(
            ctx => work(ctxWatched(ctx, inserts)),
            options
          );
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      if (prop === "insert") return recording(target, value, pool);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { adapter: proxy, transactions, pool };
}

/**
 * Push the claim's expiry into the past, with the clock expression the
 * repository writes expiries with, so the lapse is the database's own.
 */
async function expireClaim(t: TestNextly, ref: DocumentRef): Promise<void> {
  const dialect = t.adapter.getCapabilities().dialect;
  const key = documentLockKey(ref.scopeKind, ref.slug, ref.entryId);
  await t.adapter.transaction(async ctx => {
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          SET ${sql.identifier("expires_at")} = ${futureExpression(dialect, -600)}
          WHERE ${sql.identifier("id")} = ${key}`
    );
  });
}

describe.each(getConfiguredTestDialects())(
  "a takeover in the document's history (integration, %s)",
  dialect => {
    for (const [what, documentOf] of [
      ["an entry", post],
      ["a Single", masthead],
    ] as const) {
      it(`records who took over ${what}, from whom and when`, async () => {
        const t = await boot(dialect);
        const { ref, subject } = await documentOf(t);
        await claim(t, ref, ADA);
        const before = Date.now();
        await claim(t, ref, GRACE, { takeover: true });
        const after = Date.now();

        const taken = (await historyOf(t, subject)).filter(
          event => event.kind === "taken-over"
        );
        expect(taken).toHaveLength(1);
        expect(taken[0]).toMatchObject({
          subjectKind: subject.kind,
          actorKind: "person",
          actorId: GRACE.id,
          actorName: GRACE.name,
          payload: { fromId: ADA.id, fromName: ADA.name },
        });
        // Whole seconds on some dialects: allow the second either side.
        const at = new Date(taken[0].occurredAt).getTime();
        expect(at).toBeGreaterThanOrEqual(before - 1000);
        expect(at).toBeLessThanOrEqual(after + 1000);
        expect((await readDocumentLock(t.adapter, ref))?.ownerId).toBe(
          GRACE.id
        );
      }, 120_000);
    }

    it("names the previous editor from the users table when read: by name, never by email, and nobody once the account is gone", async () => {
      const t = await boot(dialect);
      const { ref, subject } = await post(t);
      // Ada holds it under a label that is an email address, as the lock
      // labels a person with no name.
      await acquireDocumentLock(t.adapter, ref, {
        ...claimant(ADA),
        ownerLabel: ADA.email,
      });
      await claim(t, ref, GRACE, { takeover: true });
      const takeover = async () =>
        (await historyOf(t, subject)).find(e => e.kind === "taken-over");

      // Renamed after the takeover: history names her as she is now, from
      // the users table, not from anything the event copied.
      await t.adapter.update(
        "users",
        { name: "Ada Lovelace" },
        { and: [{ column: "id", op: "=", value: ADA.id }] }
      );
      expect((await takeover())?.payload).toEqual({
        fromId: ADA.id,
        fromName: "Ada Lovelace",
      });

      // With no name, she is named by nothing, never by her email.
      await t.adapter.update(
        "users",
        { name: null },
        { and: [{ column: "id", op: "=", value: ADA.id }] }
      );
      expect((await takeover())?.payload).toEqual({
        fromId: ADA.id,
        fromName: null,
      });
      expect(JSON.stringify(await historyOf(t, subject))).not.toContain(
        ADA.email
      );

      // Her account gone: still nobody, and the event still stands.
      await t.adapter.delete("users", {
        and: [{ column: "id", op: "=", value: ADA.id }],
      });
      expect((await takeover())?.payload).toEqual({
        fromId: ADA.id,
        fromName: null,
      });
    }, 120_000);

    it("writes the event on the transaction that replaces the claim, and no other", async () => {
      const t = await boot(dialect);
      const { ref } = await post(t);
      await claim(t, ref, ADA);

      // Watched from here: the takeover alone.
      const watch = watched(t.adapter);
      const taken = await acquireDocumentLock(
        watch.adapter,
        ref,
        claimant(GRACE),
        { takeover: true }
      );
      expect(taken.status).toBe("acquired");

      // One transaction, the claim's own, and the event's insert inside it:
      // an event written on the pool or on a transaction of its own could
      // commit while the claim rolled back.
      expect(watch.transactions).toHaveLength(1);
      expect(watch.transactions[0]).toContain("nextly_content_events");
      expect(watch.pool).toEqual([]);
    }, 120_000);

    it("refuses the takeover and keeps the holder when the event write fails", async () => {
      const t = await boot(dialect);
      const { ref, subject } = await post(t);
      const adaToken = await claim(t, ref, ADA);
      const eventsBefore = await historyOf(t, subject);

      // A name longer than the record keeps: the event is refused before it
      // is written, on the takeover's own transaction.
      const longName = "G".repeat(300);
      await expect(
        acquireDocumentLock(
          t.adapter,
          ref,
          { ...claimant(GRACE), personName: longName },
          { takeover: true }
        )
      ).rejects.toThrow();

      expect(await readDocumentLock(t.adapter, ref)).toMatchObject({
        ownerId: ADA.id,
      });
      // Ada's own claim, not merely a claim in her name: her token still
      // renews it.
      expect((await renewDocumentLock(t.adapter, ref, adaToken)).status).toBe(
        "renewed"
      );
      expect(await historyOf(t, subject)).toEqual(eventsBefore);
    }, 120_000);

    it("records nothing for a claim, a renewal, a request for access, a release or a lapse", async () => {
      const t = await boot(dialect);
      const { ref, subject } = await post(t);
      const eventsBefore = await historyOf(t, subject);

      // A claim and its renewal.
      const adaToken = await claim(t, ref, ADA);
      await renewDocumentLock(t.adapter, ref, adaToken);
      // A request for access, refused while Ada holds it.
      const asked = await acquireDocumentLock(t.adapter, ref, claimant(GRACE), {
        requestAccess: true,
      });
      expect(asked.status).toBe("held");
      // The same person reopening the document in another tab, even when
      // that tab asks to take over: one person is one holder.
      await claim(t, ref, ADA, { takeover: true });
      // A release, then a fresh claim of the free document.
      const adaSecond = await claim(t, ref, ADA);
      await releaseDocumentLock(t.adapter, ref, adaSecond);
      await claim(t, ref, GRACE);
      // A lapse, then a claim of the lapsed document, even one asking to
      // take over: nobody held it any more.
      await expireClaim(t, ref);
      await claim(t, ref, ADA, { takeover: true });

      expect(await historyOf(t, subject)).toEqual(eventsBefore);
    }, 120_000);
  }
);
