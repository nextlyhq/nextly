/**
 * A write to many documents is judged one document at a time.
 *
 * A batch that gives each document its own values and version refuses each
 * out-of-date one as a conflict, saying its current version, and applies the
 * rest. A bulk update gives every document the same values, so it carries no
 * one document's version: it is judged per document only when it names a
 * version for each id (`revs`), applies over whatever is stored when it says
 * to overwrite, and is refused when it says neither.
 *
 * @module domains/collections/services/__tests__/stale-version-batch.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionService } from "../collection-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const NOTES = "notes";

const ANA = {
  id: "user-ana",
  name: "Ana Ruiz",
  email: "ana@x.test",
  role: "admin",
};

const OPEN = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: NOTES,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

const serviceOf = (t: TestNextly): CollectionService =>
  t.getService("collectionService") as unknown as CollectionService;

function field(result: unknown, key: string): string {
  const value = (result as { data?: Record<string, unknown> }).data?.[key];
  if (typeof value !== "string")
    throw new Error(`no ${key} on ${JSON.stringify(result)}`);
  return value;
}

/** Three notes, each with the version its creation returned. */
async function three(t: TestNextly) {
  const notes: { id: string; rev: string }[] = [];
  for (const title of ["a", "b", "c"]) {
    const created = await handlerOf(t).createEntry(
      { collectionName: NOTES, overrideAccess: true },
      { title }
    );
    notes.push({ id: field(created, "id"), rev: field(created, "_rev") });
  }
  return notes;
}

/**
 * Ana saves a note, so the version read before is out of date. She saves from
 * the version she just read: the overwrite choice would record an
 * `overwritten` event, which the tests count.
 */
async function anaSaves(t: TestNextly, id: string, title: string) {
  const read = (await t.nextly.findByID({
    collection: NOTES as never,
    id,
    overrideAccess: true,
  } as never)) as Record<string, unknown>;
  const saved = await handlerOf(t).updateEntry(
    {
      collectionName: NOTES,
      entryId: id,
      overrideAccess: true,
      user: ANA,
    },
    { title, _rev: read._rev }
  );
  return field(saved, "_rev");
}

async function titleOf(t: TestNextly, id: string): Promise<string> {
  const row = await t.adapter.selectOne<Record<string, unknown>>(
    `dc_${NOTES}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
  return String(row?.title);
}

async function counterOf(t: TestNextly, id: string): Promise<number> {
  const row = await t.adapter.selectOne<Record<string, unknown>>(
    `dc_${NOTES}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
  return Number(row?._revision);
}

const overwritesOf = async (t: TestNextly, id: string) =>
  (
    await t.nextly.contentEvents.list({
      subject: { kind: "collection", slug: NOTES, id },
      limit: 100,
    })
  ).items.filter(e => e.kind === "overwritten");

/** The code a refused call threw, or "applied". */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "applied";
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

describe.each(getConfiguredTestDialects())(
  "writes to many documents, judged by version (%s)",
  dialect => {
    it("reports the one out-of-date document of three as a conflict and applies the other two", async () => {
      const t = await boot(dialect);
      const [a, b, c] = await three(t);
      const current = await anaSaves(t, b.id, "Ana's");

      const batch = await serviceOf(t).updateMany(
        NOTES,
        [a, b, c].map(note => ({
          id: note.id,
          data: { title: `batch ${note.id}`, _rev: note.rev },
        })),
        { overrideAccess: true } as never
      );

      expect(batch.successful, JSON.stringify(batch)).toBe(2);
      expect(batch.errors).toEqual([
        expect.objectContaining({
          index: 1,
          code: "STALE_VERSION",
          // The conflict says the version to read again from, as the refusal
          // of a single save does.
          data: expect.objectContaining({
            currentVersion: current,
            changedBy: expect.objectContaining({ kind: "person" }),
          }),
        }),
      ]);
      expect(await titleOf(t, a.id)).toBe(`batch ${a.id}`);
      expect(await titleOf(t, b.id)).toBe("Ana's");
      expect(await titleOf(t, c.id)).toBe(`batch ${c.id}`);
    });

    it("keeps a conflict's version when the batch stops at it and rolls back", async () => {
      const t = await boot(dialect);
      const [a, b, c] = await three(t);
      const current = await anaSaves(t, b.id, "Ana's");

      const entries = (
        t.getService("collectionsHandler") as CollectionsHandler
      ).getEntryService();
      const batch = await entries.updateEntries(
        { collectionName: NOTES, overrideAccess: true },
        [a, b, c].map(note => ({
          id: note.id,
          data: { title: `batch ${note.id}`, _rev: note.rev },
        })),
        { stopOnError: true }
      );

      expect(batch.successful, JSON.stringify(batch)).toBe(0);
      // The conflict still says the version to read again from, as it does
      // when the batch goes on past it.
      expect(batch.errors).toContainEqual(
        expect.objectContaining({
          index: 1,
          code: "STALE_VERSION",
          data: expect.objectContaining({ currentVersion: current }),
        })
      );
      expect(await titleOf(t, a.id)).not.toBe(`batch ${a.id}`);
    });

    it("refuses the second of two items naming one document from the same version", async () => {
      const t = await boot(dialect);
      const [a] = await three(t);
      const batch = await serviceOf(t).updateMany(
        NOTES,
        [
          { id: a.id, data: { title: "first", _rev: a.rev } },
          { id: a.id, data: { title: "second", _rev: a.rev } },
        ],
        { overrideAccess: true } as never
      );
      // The first moved the version, so the second was made from one that is
      // now out of date: judged on the row as it stands, not as the batch began.
      expect(batch.errors.map(e => [e.index, e.code])).toEqual([
        [1, "STALE_VERSION"],
      ]);
      expect(await titleOf(t, a.id)).toBe("first");
    });

    it("judges each document of an update by ids given a version for each", async () => {
      const t = await boot(dialect);
      const [a, b, c] = await three(t);
      const current = await anaSaves(t, b.id, "Ana's");

      const result = await handlerOf(t).bulkUpdateEntries({
        collectionName: NOTES,
        ids: [a.id, b.id, c.id],
        data: { title: "bulk" },
        revs: { [a.id]: a.rev, [b.id]: b.rev, [c.id]: c.rev },
        overrideAccess: true,
      });

      expect(result.failures, JSON.stringify(result)).toEqual([
        expect.objectContaining({
          id: b.id,
          code: "STALE_VERSION",
          data: expect.objectContaining({ currentVersion: current }),
        }),
      ]);
      expect(result.successCount).toBe(2);
      expect(await titleOf(t, a.id)).toBe("bulk");
      expect(await titleOf(t, b.id)).toBe("Ana's");
      expect(await titleOf(t, c.id)).toBe("bulk");
    });

    it("refuses an update by ids whose versions are incomplete or don't match its ids, writing nothing", async () => {
      const t = await boot(dialect);
      const [a, b] = await three(t);
      const before = [await counterOf(t, a.id), await counterOf(t, b.id)];
      const bulk =
        (revs: unknown, data: Record<string, unknown> = {}) =>
        () =>
          handlerOf(t).bulkUpdateEntries({
            collectionName: NOTES,
            ids: [a.id, b.id],
            data: { title: "bulk", ...data },
            revs: revs as Record<string, string>,
            overrideAccess: true,
          });

      // A version for one id and not the other: the other would be applied
      // unjudged, so the request is refused as a version required.
      expect(await codeOf(bulk({ [a.id]: a.rev }))).toBe("VERSION_REQUIRED");
      // A version for a document the update does not name.
      expect(
        await codeOf(bulk({ [a.id]: a.rev, [b.id]: b.rev, other: "1" }))
      ).toBe("VALIDATION_ERROR");
      // Versions and the overwrite choice together say two different things.
      expect(
        await codeOf(
          bulk({ [a.id]: a.rev, [b.id]: b.rev }, { _overwrite: true })
        )
      ).toBe("VALIDATION_ERROR");
      // A version that is not one.
      expect(await codeOf(bulk({ [a.id]: a.rev, [b.id]: "seven" }))).toBe(
        "VALIDATION_ERROR"
      );
      expect(await codeOf(bulk([a.rev, b.rev]))).toBe("VALIDATION_ERROR");

      expect([await counterOf(t, a.id), await counterOf(t, b.id)]).toEqual(
        before
      );
    });

    it("refuses versions by id on an update by query, which names no ids", async () => {
      const t = await boot(dialect);
      const [a] = await three(t);
      const before = await counterOf(t, a.id);
      const refused = await codeOf(() =>
        handlerOf(t).bulkUpdateByQuery({
          collectionName: NOTES,
          where: { id: { equals: a.id } },
          data: { title: "bulk" },
          revs: { [a.id]: a.rev },
          overrideAccess: true,
        } as never)
      );
      expect(refused).toBe("VALIDATION_ERROR");
      expect(await counterOf(t, a.id)).toBe(before);
    });

    it("applies both with the overwrite choice", async () => {
      const t = await boot(dialect);
      const [a, b] = await three(t);
      await anaSaves(t, a.id, "Ana's");
      await anaSaves(t, b.id, "Ana's");

      const byIds = await handlerOf(t).bulkUpdateEntries({
        collectionName: NOTES,
        ids: [a.id, b.id],
        data: { title: "by ids", _overwrite: true },
        overrideAccess: true,
      });
      expect(byIds.failures, JSON.stringify(byIds)).toEqual([]);
      const byQuery = await handlerOf(t).bulkUpdateByQuery({
        collectionName: NOTES,
        where: { id: { in: [a.id, b.id] } },
        data: { title: "by query", _overwrite: true },
        overrideAccess: true,
      });
      expect(byQuery.failures, JSON.stringify(byQuery)).toEqual([]);

      for (const note of [a, b]) {
        expect(await titleOf(t, note.id)).toBe("by query");
        // Each document's history says it was overwritten, twice, naming no
        // one: a bulk update gives no version to say whose change it replaced.
        expect((await overwritesOf(t, note.id)).map(e => e.payload)).toEqual([
          expect.objectContaining({ given: "none", replaced: null }),
          expect.objectContaining({ given: "none", replaced: null }),
        ]);
      }
    });

    it("refuses an update by ids or by query that gives neither, writing nothing", async () => {
      const t = await boot(dialect);
      const [a, b] = await three(t);
      const before = [await counterOf(t, a.id), await counterOf(t, b.id)];
      expect(
        await codeOf(() =>
          handlerOf(t).bulkUpdateEntries({
            collectionName: NOTES,
            ids: [a.id],
            data: { title: "unjudged" },
            overrideAccess: true,
          })
        )
      ).toBe("VERSION_REQUIRED");
      expect(
        await codeOf(() =>
          handlerOf(t).bulkUpdateByQuery({
            collectionName: NOTES,
            where: { id: { in: [b.id] } },
            data: { title: "unjudged by query" },
            overrideAccess: true,
          })
        )
      ).toBe("VERSION_REQUIRED");
      expect([await titleOf(t, a.id), await titleOf(t, b.id)]).toEqual([
        "a",
        "b",
      ]);
      expect([await counterOf(t, a.id), await counterOf(t, b.id)]).toEqual(
        before
      );
    });
  }
);
