/**
 * An entry write takes its collection's hold first on MySQL (`holdEntityForWrite`), so it waits
 * while a Builder save deleting a field's values holds the collection, and goes on once the save
 * lets go. The hold a deleting save takes is the collection delete's, `holdCollectionsIn` for
 * update, taken here by another session as the save takes it.
 *
 * What separates a held write from plausible wrong ones:
 * - a write that takes no hold lands while the collection is held;
 * - one that holds only a write opened by the service misses a write on a caller's transaction
 *   (`createEntryInTransaction`), which the write itself holds;
 * - one that never lets go, or waits on its own hold, does not land once the hold ends.
 *
 * MySQL only: on PostgreSQL and SQLite the deleting save's own transaction keeps writes off the
 * table, and an entry write takes nothing.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { consoleLogger } from "../../../shared/types";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { holdEntityInProcess } from "../../dynamic-collections/services/entity-hold";
import { DynamicCollectionService } from "../../dynamic-collections/services/dynamic-collection-service";
import {
  holdEntityForWrite,
  type HoldingAdapter,
  type LoadedRegistryRow,
  loadedRegistryRowOf,
} from "../services/entry-write-hold";

const SLUG = "ewh_notes";

let instance: TestNextly | undefined;
let releaseHeld: (() => void) | undefined;
afterEach(async () => {
  releaseHeld?.();
  releaseHeld = undefined;
  await instance?.destroy();
  instance = undefined;
});

/** How long a write is given to land while the collection is held: well inside the hold's wait. */
const WAITED_MS = 1_500;

describe.each(getConfiguredTestDialects())(
  "an entry write takes its collection's hold (%s)",
  dialect => {
    // Run on MySQL only; skipped, not absent, elsewhere, so every dialect's run finds the file.
    const onMysql = it.runIf(dialect === "mysql");

    /** The app, with `note` translated, its values in the translations table, when `translated`. */
    async function boot(translated = false): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        ...(translated
          ? { localization: { locales: ["en", "es"], defaultLocale: "en" } }
          : {}),
        collections: [
          defineCollection({
            slug: SLUG,
            ...(translated ? { localized: true } : {}),
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
              delete: () => true,
            },
            fields: [
              text({ name: "title", localized: false }),
              text({ name: "note", localized: translated }),
            ],
          }),
        ],
      });
      instance = t;
      return t;
    }

    /**
     * The collection held for update by another session, as a deleting save holds it, until the
     * returned `release` is called; resolves once the hold is taken. `whileHeld` runs in the
     * holding transaction once the hold is taken, committed with it.
     */
    async function holdForUpdate(
      t: TestNextly,
      whileHeld?: (tx: {
        execute(statement: string): Promise<unknown>;
      }) => Promise<void>
    ): Promise<{ release: () => Promise<void> }> {
      let held: () => void = () => undefined;
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      let letGo: () => void = () => undefined;
      const released = new Promise<void>(resolve => {
        letGo = resolve;
      });
      releaseHeld = letGo;
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      const holding = t.adapter.transaction(async tx => {
        const hold = await registry.holdCollectionsIn(tx, [SLUG], "update");
        await whileHeld?.(tx);
        held();
        await released;
        await hold.release();
      });
      await isHeld;
      return {
        release: async () => {
          letGo();
          await holding;
        },
      };
    }

    /** Whether `write` lands within {@link WAITED_MS}, and the write itself to await. */
    async function landsWhileHeld(
      write: Promise<unknown>
    ): Promise<{ landed: boolean; write: Promise<unknown> }> {
      let landed = false;
      const settled = write.then(
        value => {
          landed = true;
          return value;
        },
        (error: unknown) => {
          landed = true;
          throw error;
        }
      );
      await new Promise(resolve => setTimeout(resolve, WAITED_MS));
      return { landed, write: settled };
    }

    const notes = async (t: TestNextly) =>
      (
        await t.adapter.select<{ note: string | null }>(`dc_${SLUG}`, {
          columns: ["note"],
        })
      ).map(row => row.note);

    onMysql(
      "keeps a create waiting while the collection is held, and lands it once let go",
      async () => {
        const t = await boot();
        const hold = await holdForUpdate(t);

        const { landed, write } = await landsWhileHeld(
          t.nextly.create({
            collection: SLUG,
            data: { title: "t", note: "written while held" },
          } as never)
        );
        expect(landed).toBe(false);
        expect(await notes(t)).toEqual([]);

        await hold.release();
        await write;
        expect(await notes(t)).toEqual(["written while held"]);
      },
      30_000
    );

    onMysql(
      "keeps an update waiting while the collection is held",
      async () => {
        const t = await boot();
        const created = (await t.nextly.create({
          collection: SLUG,
          data: { title: "t", note: "before" },
        } as never)) as unknown as { item: { id: unknown } };
        const id = String(created.item.id);
        const hold = await holdForUpdate(t);

        const { landed, write } = await landsWhileHeld(
          t.nextly.update({
            collection: SLUG,
            id,
            // Written over whatever is stored, as no earlier read is named.
            data: { note: "after", _overwrite: true },
          } as never)
        );
        expect(landed).toBe(false);
        expect(await notes(t)).toEqual(["before"]);

        await hold.release();
        await write;
        expect(await notes(t)).toEqual(["after"]);
      },
      30_000
    );

    // A translated field's values are in the translations table, written by the same entry write,
    // which holds the collection before it writes either table.
    onMysql(
      "keeps a write of a translated field waiting while the collection is held",
      async () => {
        const t = await boot(true);
        const created = (await t.nextly.create({
          collection: SLUG,
          locale: "en",
          data: { title: "t", note: "in English" },
        } as never)) as unknown as { item: { id: unknown } };
        const id = String(created.item.id);
        const hold = await holdForUpdate(t);

        const { landed, write } = await landsWhileHeld(
          t.nextly.update({
            collection: SLUG,
            id,
            locale: "es",
            data: { note: "en español", _overwrite: true },
          } as never)
        );
        expect(landed).toBe(false);

        await hold.release();
        await write;
        const read = (await t.nextly.findByID({
          collection: SLUG,
          id,
          locale: "es",
        } as never)) as { note?: unknown } | null;
        expect(read?.note).toBe("en español");
      },
      30_000
    );

    onMysql(
      "keeps a write on a caller's transaction waiting while the collection is held",
      async () => {
        const t = await boot();
        const entries = (
          t.getService("collectionsHandler") as CollectionsHandler
        ).getEntryService() as CollectionEntryService;
        const hold = await holdForUpdate(t);

        const { landed, write } = await landsWhileHeld(
          t.adapter.transaction(tx =>
            entries.createEntryInTransaction(
              tx,
              { collectionName: SLUG, overrideAccess: true },
              { title: "t", note: "written on the caller's transaction" }
            )
          )
        );
        expect(landed).toBe(false);

        await hold.release();
        await write;
        expect(await notes(t)).toEqual(["written on the caller's transaction"]);
      },
      30_000
    );

    // A write that waited while its collection was deleted and made again under the same slug is
    // refused, not written into the collection that took its place.
    onMysql(
      "refuses a write that waited while its collection was replaced under its slug, and writes nothing",
      async () => {
        const t = await boot();
        // The collection deleted and made again, as the holding session leaves its registry row
        // once it commits: the slug's row another, under a new id.
        const hold = await holdForUpdate(t, tx =>
          tx
            .execute(
              `UPDATE dynamic_collections SET id = 'replaced-${SLUG}' WHERE slug = '${SLUG}'`
            )
            .then(() => undefined)
        );

        const { landed, write } = await landsWhileHeld(
          t.nextly.create({
            collection: SLUG,
            data: { title: "t", note: "written into the replacement" },
          } as never)
        );
        expect(landed).toBe(false);

        await hold.release();
        await expect(write).rejects.toMatchObject({
          code: "COLLECTION_BEING_CHANGED",
        });
        expect(await notes(t)).toEqual([]);
      },
      30_000
    );

    /**
     * The write's hold of the collection in a transaction of its own, compared with `loaded`,
     * through the adapter the app writes through.
     */
    const heldFor = (t: TestNextly, loaded: LoadedRegistryRow | undefined) => {
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      return t.adapter.transaction(tx =>
        holdEntityForWrite(
          tx,
          { kind: "collection", slug: SLUG },
          registry,
          t.adapter as unknown as HoldingAdapter,
          loaded
        )
      );
    };

    /** The write's hold of the collection, kept until `whileHeld` ends, in a transaction of its own. */
    const heldWhile = (t: TestNextly, whileHeld: () => Promise<void>) => {
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      return t.adapter.transaction(async tx => {
        await holdEntityForWrite(
          tx,
          { kind: "collection", slug: SLUG },
          registry,
          t.adapter as unknown as HoldingAdapter
        );
        await whileHeld();
      });
    };

    /** The registry row as a write made now would load it, `data` the write's. */
    async function loadedNow(
      t: TestNextly,
      data?: Record<string, unknown>
    ): Promise<LoadedRegistryRow | undefined> {
      clearRegistryRowCache();
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      return loadedRegistryRowOf(await registry.getCollection(SLUG), data);
    }

    // A write made for a collection deleted before it held it finds no row under the slug, and is
    // refused as not found, never written into what a create of the same slug makes next.
    it("refuses a write whose collection was deleted after it loaded it, as not found", async () => {
      const t = await boot();
      const loaded = await loadedNow(t, { note: "made for the deleted one" });
      expect(loaded).toBeDefined();
      // The delete, committed: no registry row holds the slug.
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET slug = 'ewh_gone' WHERE slug = '${SLUG}'`
      );

      await expect(heldFor(t, loaded)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 30_000);

    // A write made for a collection deleted and made again under its slug before it held it finds
    // another row there, and is refused, not written into the replacement.
    it("refuses a write whose collection was made again under its slug after it loaded it", async () => {
      const t = await boot();
      const loaded = await loadedNow(t, { note: "made for the first one" });
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET id = 'made-again-${SLUG}' WHERE slug = '${SLUG}'`
      );

      await expect(heldFor(t, loaded)).rejects.toMatchObject({
        code: "COLLECTION_BEING_CHANGED",
      });
    }, 30_000);

    // A save that removed a field while the write waited moves the definition's version: a field the
    // write sets that the held definition no longer has is refused by name, before anything is
    // written. A write that sets only fields the definition keeps goes on.
    it("refuses, by name, a field the write sets that a save removed after it loaded the definition", async () => {
      const t = await boot();
      const setsNote = await loadedNow(t, { title: "t", note: "n" });
      const setsTitle = await loadedNow(t, { title: "t" });
      expect(setsNote?.setsFields).toEqual(["title", "note"]);
      // The save's registry write: the definition without `note`, its version moved.
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      const row = (await registry.getCollection(SLUG)) as {
        fields: Array<{ name: string }>;
      };
      const kept = JSON.stringify(
        row.fields.filter(field => field.name !== "note")
      );
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET fields = '${kept.replace(/'/g, "''")}', schema_version = schema_version + 1 WHERE slug = '${SLUG}'`
      );

      await expect(heldFor(t, setsNote)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.note",
              code: "FIELD_REMOVED",
            }),
          ],
        },
      });
      await expect(heldFor(t, setsTitle)).resolves.toBeUndefined();
    }, 30_000);

    // Entry writes share the hold: two under way at once each take it while the other is open,
    // never waiting on each other. On SQLite every transaction takes its turn anyway.
    it.runIf(dialect !== "sqlite")(
      "lets entry writes take the hold beside each other",
      async () => {
        const t = await boot();
        let letGo: () => void = () => undefined;
        const goes = new Promise<void>(resolve => {
          letGo = resolve;
        });
        let first: () => void = () => undefined;
        const firstHolds = new Promise<void>(resolve => {
          first = resolve;
        });
        const open = heldWhile(t, async () => {
          first();
          await goes;
        });
        await firstHolds;
        try {
          const { landed, write } = await landsWhileHeld(heldFor(t, undefined));
          expect(landed).toBe(true);
          await write;
        } finally {
          letGo();
          await open;
        }
      },
      30_000
    );

    // On SQLite a save holds the collection in the process, and every transaction takes its turn
    // on one connection: a write on a transaction already open, which holds that turn, is refused
    // at once while a save holds it, rather than waiting for a save that needs the turn to finish.
    it.runIf(dialect === "sqlite")(
      "refuses at once a write on a transaction already open while a save holds the collection",
      async () => {
        const t = await boot();
        const release = await holdEntityInProcess(t.adapter, {
          kind: "collection",
          slug: SLUG,
        });
        try {
          await expect(heldFor(t, undefined)).rejects.toMatchObject({
            code: "COLLECTION_BEING_CHANGED",
          });
        } finally {
          release();
        }
        await expect(heldFor(t, undefined)).resolves.toBeUndefined();
      },
      30_000
    );
  }
);
