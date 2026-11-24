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
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
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
import { namedCollectionLockNames } from "../../dynamic-collections/services/dynamic-collection-registry-service";
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
      return t.adapter.transaction(async tx => {
        await holdEntityForWrite(
          tx,
          { kind: "collection", slug: SLUG },
          registry,
          t.adapter as unknown as HoldingAdapter,
          loaded
        );
      });
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
      data?: Record<string, unknown>,
      options?: { insertsOnly?: boolean }
    ): Promise<LoadedRegistryRow | undefined> {
      clearRegistryRowCache();
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      return loadedRegistryRowOf(
        await registry.getCollection(SLUG),
        data,
        options
      );
    }

    // A write made for a collection deleted before it held it finds no row under the slug, and is
    // refused as not found, never written into what a create of the same slug makes next.
    // MySQL's hold is two names, the old release's and the new one. A write's wait is one time over
    // both: waited for one after the other, the second would be given the whole wait again, and the
    // write would wait twice as long as it says. Each name is held by a session of its own, and the
    // first let go part way.
    onMysql(
      "waits one time over both its names, the second for what the first left",
      async () => {
        const t = await boot();
        const adapter = t.adapter as unknown as DrizzleAdapter;
        const [row] = (await t.adapter.executeQuery(
          "SELECT DATABASE() AS name"
        )) as { name: string }[];
        const [first, second] = namedCollectionLockNames(row.name, [SLUG]);
        const registry = new DynamicCollectionService(t.adapter, consoleLogger);
        await adapter.withSession(holdsFirst =>
          adapter.withSession(async holdsSecond => {
            await holdsFirst.execute(`SELECT GET_LOCK('${first}', 0)`);
            await holdsSecond.execute(`SELECT GET_LOCK('${second}', 0)`);
            const began = Date.now();
            const seeking = t.adapter
              .transaction(tx =>
                registry.holdCollectionsIn(tx, [SLUG], "share", {
                  waitMs: 4_000,
                })
              )
              .then(
                () => "held",
                (error: unknown) => error
              );
            await new Promise(resolve => setTimeout(resolve, 2_500));
            await holdsFirst.execute(`SELECT RELEASE_LOCK('${first}')`);
            expect(await seeking).toMatchObject({
              code: "COLLECTION_BEING_CHANGED",
            });
            const waited = Date.now() - began;
            // It waited for the second after the first was let go, and not the whole wait again,
            // which would end 6.5 seconds on.
            expect(waited).toBeGreaterThan(2_500);
            expect(waited).toBeLessThan(5_800);
          })
        );
      },
      30_000
    );

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
    // written. A write that sets only fields the definition keeps was still made from the earlier
    // definition, whose removed column it would read, so it is refused as made for a definition
    // that changed, to be made again from the new one.
    it("refuses, by name, a field the write sets that a save removed after it loaded the definition", async () => {
      const t = await boot();
      const setsNote = await loadedNow(t, { title: "t", note: "n" });
      const setsTitle = await loadedNow(t, { title: "t" });
      const createsTitle = await loadedNow(
        t,
        { title: "t" },
        { insertsOnly: true }
      );
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
      await expect(heldFor(t, setsTitle)).rejects.toMatchObject({
        code: "COLLECTION_BEING_CHANGED",
      });
      // A create reads no entry through the earlier definition and writes only what it sets.
      await expect(heldFor(t, createsTitle)).resolves.toBeUndefined();
      // Made from the definition as the save left it, the write goes on.
      await expect(
        heldFor(t, await loadedNow(t, { title: "t" }))
      ).resolves.toBeUndefined();
    }, 30_000);

    // The held definition's version is read as the registry keeps it: where it is the one the write
    // loaded, nothing more is compared, so a write goes on whatever its loaded fields hold. A version
    // read as no number would compare every write's fields against the held definition, a read per
    // write, and refuse one made from a definition the cache still held.
    it("compares nothing further where the definition's version is the one the write loaded", async () => {
      const t = await boot();
      const loaded = await loadedNow(t, { title: "t" });
      expect(loaded).toBeDefined();

      await expect(
        heldFor(t, loaded && { ...loaded, fields: [...loaded.fields, "ghost"] })
      ).resolves.toBeUndefined();
    }, 30_000);

    // A save that only adds a field moves the version too, but every field the write was made from
    // is still there: the write goes on.
    it("lets a write go on when a save since only added a field", async () => {
      const t = await boot();
      const setsTitle = await loadedNow(t, { title: "t" });
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      const row = (await registry.getCollection(SLUG)) as {
        fields: Array<{ name: string }>;
      };
      const grown = JSON.stringify([
        ...row.fields,
        { name: "extra", type: "text" },
      ]);
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET fields = '${grown.replace(/'/g, "''")}', schema_version = schema_version + 1 WHERE slug = '${SLUG}'`
      );

      await expect(heldFor(t, setsTitle)).resolves.toBeUndefined();
    }, 30_000);

    /** The definition the registry holds, as `change` leaves it, its version moved on. */
    async function saveDefinition(
      t: TestNextly,
      change: (
        fields: Array<{ name: string } & Record<string, unknown>>
      ) => Array<Record<string, unknown>>
    ): Promise<void> {
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      clearRegistryRowCache();
      const row = (await registry.getCollection(SLUG)) as {
        fields: Array<{ name: string } & Record<string, unknown>>;
      };
      const next = JSON.stringify(change(row.fields));
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET fields = '${next.replace(/'/g, "''")}', schema_version = schema_version + 1 WHERE slug = '${SLUG}'`
      );
    }

    // A field a save keeps by name but stores differently (a many-to-many pointed at another
    // collection, a column of another type) is a removed field to a write made from the earlier
    // definition: the write would read or write it where, or as, it no longer is. A write that
    // sets it, and one that reads the entry first, is refused to be made again from the new
    // definition; a create that sets other fields only is not. An edit of a field's label alone
    // changes nothing of how it is stored, so every write goes on.
    it("refuses a write made for a field a save kept by name but stores differently", async () => {
      const t = await boot();
      const tags = (target: string) => ({
        name: "tags",
        type: "relationship",
        relationTo: target,
        hasMany: true,
        options: { target, relationType: "manyToMany" },
      });
      await saveDefinition(t, fields => [...fields, tags("alpha")]);
      const updates = await loadedNow(t, { title: "t" });
      const updatesTags = await loadedNow(t, { title: "t", tags: ["a1"] });
      const createsTags = await loadedNow(
        t,
        { title: "t", tags: ["a1"] },
        { insertsOnly: true }
      );
      const createsTitle = await loadedNow(
        t,
        { title: "t" },
        { insertsOnly: true }
      );
      // Pointed at another collection, its links are in another table.
      await saveDefinition(t, fields =>
        fields.map(field => (field.name === "tags" ? tags("beta") : field))
      );

      await expect(heldFor(t, updates)).rejects.toMatchObject({
        code: "COLLECTION_BEING_CHANGED",
      });
      // Set, and stored differently now: named, as a removed field is.
      const changed = (name: string) => ({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: `fields.${name}`,
              code: "FIELD_CHANGED",
              message: expect.stringContaining(
                "changed while this write waited for a change"
              ),
            }),
          ],
        },
      });
      await expect(heldFor(t, updatesTags)).rejects.toMatchObject(
        changed("tags")
      );
      await expect(heldFor(t, createsTags)).rejects.toMatchObject(
        changed("tags")
      );
      await expect(heldFor(t, createsTitle)).resolves.toBeUndefined();

      // A column stored as another type, the same: a write that sets it is refused naming it,
      // whichever way it is made, and told it changed while it waited.
      const setsNote = await loadedNow(t, { title: "t", note: "12" });
      const createsNote = await loadedNow(
        t,
        { title: "t", note: "12" },
        { insertsOnly: true }
      );
      await saveDefinition(t, fields =>
        fields.map(field =>
          field.name === "note" ? { ...field, type: "number" } : field
        )
      );
      await expect(heldFor(t, setsNote)).rejects.toMatchObject(changed("note"));
      await expect(heldFor(t, createsNote)).rejects.toMatchObject(
        changed("note")
      );
    }, 30_000);

    // Turning the Draft/Published lifecycle off takes its column out with the save: a write prepared
    // while it was on would write or read it. It is refused as made for a definition that changed,
    // a create among them, to be made again from the definition as it stands.
    it("refuses a write made while the collection's lifecycle was on, after a save turned it off", async () => {
      const t = await boot();
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET status = ${dialect === "postgresql" ? "true" : "1"} WHERE slug = '${SLUG}'`
      );
      const updates = await loadedNow(t, { title: "t" });
      const creates = await loadedNow(t, { title: "t" }, { insertsOnly: true });
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET status = ${dialect === "postgresql" ? "false" : "0"}, schema_version = schema_version + 1 WHERE slug = '${SLUG}'`
      );

      for (const loaded of [updates, creates]) {
        await expect(heldFor(t, loaded)).rejects.toMatchObject({
          code: "COLLECTION_BEING_CHANGED",
        });
      }
    }, 30_000);

    // Set together, a field a save removed and one it stores differently are named together, each
    // by what happened to it.
    it("refuses a write that sets a removed and a changed field, naming each", async () => {
      const t = await boot();
      const tags = (target: string) => ({
        name: "tags",
        type: "relationship",
        relationTo: target,
        hasMany: true,
        options: { target, relationType: "manyToMany" },
      });
      await saveDefinition(t, fields => [...fields, tags("alpha")]);
      const loaded = await loadedNow(t, {
        title: "t",
        note: "n",
        tags: ["a1"],
      });
      await saveDefinition(t, fields =>
        fields
          .filter(field => field.name !== "note")
          .map(field => (field.name === "tags" ? tags("beta") : field))
      );

      await expect(heldFor(t, loaded)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.note",
              code: "FIELD_REMOVED",
            }),
            expect.objectContaining({
              path: "fields.tags",
              code: "FIELD_CHANGED",
            }),
          ],
        },
      });
    }, 30_000);

    it("lets a write go on when a save since only changed a field's label", async () => {
      const t = await boot();
      const updates = await loadedNow(t, { title: "t", note: "n" });
      await saveDefinition(t, fields =>
        fields.map(field =>
          field.name === "note" ? { ...field, label: "Remark" } : field
        )
      );

      await expect(heldFor(t, updates)).resolves.toBeUndefined();
    }, 30_000);

    // The process keeps registry rows it has read: a refusal that names a removed field clears them,
    // so the retry it asks for reads the definition as the save left it, even where the save ran in
    // another process and this one's kept row is the earlier.
    it("clears the rows this process keeps of the collection when it refuses a field a save removed", async () => {
      const t = await boot();
      const registry = new DynamicCollectionService(t.adapter, consoleLogger);
      const loaded = await loadedNow(t, { title: "t", note: "n" });
      const names = async () =>
        (
          (await registry.getCollection(SLUG)) as {
            fields: Array<{ name: string }>;
          }
        ).fields.map(field => field.name);
      expect(await names()).toContain("note");
      // Straight to the table, as a save in another process leaves it: this process keeps its row.
      await t.adapter.executeQuery(
        `UPDATE dynamic_collections SET fields = '${JSON.stringify(
          (
            (await registry.getCollection(SLUG)) as {
              fields: Array<{ name: string }>;
            }
          ).fields.filter(field => field.name !== "note")
        ).replace(
          /'/g,
          "''"
        )}', schema_version = schema_version + 1 WHERE slug = '${SLUG}'`
      );
      // Still the kept row: the property the refusal is held to change.
      expect(await names()).toContain("note");

      await expect(heldFor(t, loaded)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(await names()).not.toContain("note");
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
