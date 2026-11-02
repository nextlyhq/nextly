/**
 * Taking a document over is recorded in that document's history, on every
 * dialect, and nothing else the lock does is.
 *
 * Only an integration test can show the two belong to one transaction: the
 * claim is replaced and the event written on the same connection, so a
 * failed event has to leave the previous holder's row exactly as it was. A
 * unit double of the transaction would report a rollback it never performed.
 *
 * The events are read back through the document's history read (the Direct
 * API's `contentEvents.list`), the one every surface uses, rather than from
 * the table, so a takeover recorded under the wrong subject or kind reads as
 * missing here exactly as it would in the admin.
 */

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
    data: { heading: "one" },
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
          payload: { fromId: ADA.id },
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
