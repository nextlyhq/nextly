/**
 * Every update road hands its after-hooks the document it wrote.
 *
 * A status-less edit of a published entry in a drafts-enabled collection is
 * held as a working draft: the live row does not change. The single-entry
 * update hands `afterUpdate` and the fields' `afterChange` the pending draft,
 * marked `_isWorkingDraft: true`, and compares it against the prior draft. The
 * transactional update (`updateMany`, `updateEntryInTransaction`) is a separate
 * body, and handed them the unchanged live row, unmarked: a hook could not
 * tell a draft save from a publish, and read the old content as the new.
 *
 * Asserted through a booted instance on each configured dialect, by what the
 * hooks actually received.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

type Doc = Record<string, unknown>;

/** What one `afterUpdate` call was handed. */
interface Seen {
  title: unknown;
  marked: unknown;
  originalTitle: unknown;
  originalMarked: unknown;
}

/** The transactional surface these cases drive, narrowed to the calls used. */
interface Service {
  updateMany: (
    slug: string,
    entries: Array<{ id: string; data: Doc }>,
    ctx: Doc
  ) => Promise<{ successful: number; failed: number }>;
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  updateEntryInTransaction: (
    tx: unknown,
    slug: string,
    id: string,
    data: Doc,
    ctx: Doc
  ) => Promise<Doc>;
}

const SLUG = "memos";

describe.each(getConfiguredTestDialects())(
  "after-hooks see the held draft on every update road (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let entries: CollectionEntryService;
    let service: Service;
    const seen: Seen[] = [];
    const fieldValues: unknown[] = [];

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            versions: { drafts: true },
            hooks: {
              // Config `afterChange` maps to the runtime `afterUpdate` phase.
              afterChange: [
                ctx => {
                  const data = (ctx.data ?? {}) as Doc;
                  const original = (ctx.originalData ?? {}) as Doc;
                  seen.push({
                    title: data.title,
                    marked: data._isWorkingDraft,
                    originalTitle: original.title,
                    originalMarked: original._isWorkingDraft,
                  });
                },
              ],
            },
            fields: [
              text({
                name: "title",
                hooks: {
                  afterChange: [
                    ({ value }: { value: unknown }) => {
                      fieldValues.push(value);
                      return value;
                    },
                  ],
                },
              }),
              text({ name: "body" }),
            ],
          }),
        ],
      });
      entries = (
        t.getService("collectionsHandler") as unknown as CollectionsHandler
      ).getEntryService() as CollectionEntryService;
      service = t.getService("collectionService") as unknown as Service;
    });

    afterAll(async () => {
      await t?.destroy();
    });

    beforeEach(() => {
      seen.length = 0;
      fieldValues.length = 0;
    });

    const ctx = { collectionName: SLUG, overrideAccess: true };

    /** A published entry, its creation's hook calls cleared. */
    async function publishedEntry(): Promise<string> {
      const created = await entries.createEntry(ctx, {
        title: "live",
        body: "b",
        status: "published",
      });
      seen.length = 0;
      fieldValues.length = 0;
      return String((created.data as Doc).id);
    }

    /** Each road, making one status-less edit of `title`. */
    const roads: Array<[string, (id: string, title: string) => Promise<void>]> =
      [
        [
          "the single-entry update",
          async (id, title) => {
            await entries.updateEntry(
              { ...ctx, entryId: id },
              { title, _overwrite: true }
            );
          },
        ],
        [
          "the bulk update",
          async (id, title) => {
            await entries.bulkUpdateEntries({
              collectionName: SLUG,
              ids: [id],
              // What the hooks are handed is under test, not versions.
              data: { title, _overwrite: true },
              overrideAccess: true,
            });
          },
        ],
        [
          "updateMany",
          async (id, title) => {
            const result = await service.updateMany(
              SLUG,
              [{ id, data: { title, _overwrite: true } }],
              { overrideAccess: true }
            );
            expect(result.successful).toBe(1);
          },
        ],
        [
          "updateEntryInTransaction",
          async (id, title) => {
            await service.withTransaction(tx =>
              service.updateEntryInTransaction(
                tx,
                SLUG,
                id,
                { title, _overwrite: true },
                { overrideAccess: true }
              )
            );
          },
        ],
      ];

    it.each(roads)(
      "%s hands afterUpdate and afterChange the marked draft, against the prior one",
      async (_road, edit) => {
        const id = await publishedEntry();

        await edit(id, "draft1");
        expect(seen).toEqual([
          {
            title: "draft1",
            marked: true,
            originalTitle: "live",
            originalMarked: undefined,
          },
        ]);
        expect(fieldValues).toEqual(["draft1"]);

        // A second save compares against the first draft, not the live row,
        // and both are marked, so the marker is not reported as changing.
        seen.length = 0;
        fieldValues.length = 0;
        await edit(id, "draft2");
        expect(seen).toEqual([
          {
            title: "draft2",
            marked: true,
            originalTitle: "draft1",
            originalMarked: true,
          },
        ]);
        expect(fieldValues).toEqual(["draft2"]);

        // CONTROL: the live row is untouched, so the hooks were handed
        // something other than what a reader of the live row sees.
        const live = await entries.getEntry({ ...ctx, entryId: id });
        expect((live.data as Doc).title).toBe("live");
      }
    );

    it("updateEntryInTransaction answers with the marked draft", async () => {
      const id = await publishedEntry();
      const held = await service.withTransaction(tx =>
        service.updateEntryInTransaction(
          tx,
          SLUG,
          id,
          { title: "draft1", _overwrite: true },
          { overrideAccess: true }
        )
      );
      expect(held.title).toBe("draft1");
      expect(held._isWorkingDraft).toBe(true);
    });

    it("a transactional publish hands the hooks the live row, unmarked", async () => {
      // CONTROL: the marker is the draft's alone. A write that changes the
      // live row is a publish, and says so.
      const id = await publishedEntry();
      const result = await service.updateMany(
        SLUG,
        [
          {
            id,
            data: {
              title: "republished",
              status: "published",
              _overwrite: true,
            },
          },
        ],
        { overrideAccess: true }
      );
      expect(result.successful).toBe(1);
      expect(seen).toEqual([
        {
          title: "republished",
          marked: undefined,
          originalTitle: "live",
          originalMarked: undefined,
        },
      ]);
    });
  }
);
