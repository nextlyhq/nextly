/**
 * A feature can pin a version so retention never removes it, whatever the
 * limit. Pins are named slots per holder: one holder releasing never frees a
 * version another still holds, and moving a slot frees the version it left.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  registerVersionPinHolder,
  versionPinHolderNames,
  versionPins,
} from "../version-pins";

// A second holder beside Workflows, registered once for the whole file.
if (!versionPinHolderNames().includes("test-review")) {
  registerVersionPinHolder({ name: "test-review", label: "Test review" });
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A document with a cap of 3 versions, saved once (version 1). */
async function cappedDocument(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "notes",
        versions: { drafts: false, maxPerDoc: 3 },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  const handler = current.getService("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: "notes", overrideAccess: true },
    { title: "v1" }
  );
  const entryId = (created.data as { id: string }).id;
  const ref = {
    scopeKind: "collection" as const,
    scopeSlug: "notes",
    entryId,
  };
  const save = async (times: number) => {
    for (let i = 0; i < times; i += 1) {
      await handler.updateEntry(
        { collectionName: "notes", entryId, overrideAccess: true },
        { title: `save ${i}` }
      );
    }
  };
  const kept = async () =>
    (
      await current!.adapter.select<{
        entryId: string;
        versionNo: number | null;
        isAutosave: boolean | number;
      }>("nextly_versions")
    )
      .filter(
        row =>
          row.entryId === entryId &&
          typeof row.versionNo === "number" &&
          !row.isAutosave
      )
      .map(row => row.versionNo as number)
      .sort((a, b) => a - b);
  const inTx = <T>(work: Parameters<TestNextly["adapter"]["transaction"]>[0]) =>
    current!.adapter.transaction(work) as Promise<T>;
  return { ref, save, kept, inTx, handler, entryId };
}

describe.each(getConfiguredTestDialects())(
  "version pins (integration, %s)",
  dialect => {
    it("keeps a pinned early version whatever the limit", async () => {
      const doc = await cappedDocument(dialect);
      await doc.inTx(tx =>
        versionPins
          .holder("workflows")
          .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );

      await doc.save(6);

      const kept = await doc.kept();
      expect(kept).toContain(1);
      // The cap still applies to everything else.
      expect(kept.filter(no => no !== 1)).toHaveLength(3);
    });

    it("keeps a version while any holder holds it", async () => {
      const doc = await cappedDocument(dialect);
      await doc.inTx(async tx => {
        await versionPins
          .holder("workflows")
          .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 });
        await versionPins
          .holder("test-review")
          .pin(tx, { ref: doc.ref, slot: "seen", versionNo: 1 });
      });
      await doc.inTx(tx =>
        versionPins
          .holder("workflows")
          .release(tx, { ref: doc.ref, slot: "approved" })
      );

      await doc.save(5);
      expect(await doc.kept()).toContain(1);

      await doc.inTx(tx =>
        versionPins.holder("test-review").releaseAll(tx, doc.ref)
      );
      await doc.save(1);
      expect(await doc.kept()).not.toContain(1);
    });

    it("frees the version a slot leaves when it moves", async () => {
      const doc = await cappedDocument(dialect);
      await doc.save(1); // version 2
      const holder = versionPins.holder("workflows");
      await doc.inTx(tx =>
        holder.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );
      await doc.inTx(tx =>
        holder.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 2 })
      );

      await doc.save(5);
      const kept = await doc.kept();
      expect(kept).toContain(2);
      expect(kept).not.toContain(1);
      expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([
        { holder: "workflows", slot: "approved", versionNo: 2 },
      ]);
    });

    it("refuses a version the document does not have, and an unregistered holder", async () => {
      const doc = await cappedDocument(dialect);
      const missing = await doc
        .inTx(tx =>
          versionPins
            .holder("workflows")
            .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 99 })
        )
        .then(
          () => undefined,
          (error: unknown) => error
        );
      expect(NextlyError.is(missing)).toBe(true);
      expect(missing).toMatchObject({ code: "NOT_FOUND" });

      expect(() => versionPins.holder("nobody")).toThrow(
        /registerVersionPinHolder/
      );
    });

    // SQLite runs one writer at a time, so a pin there cannot overlap a save;
    // the race this guards only exists where transactions run side by side.
    it.skipIf(dialect === "sqlite")(
      "waits for a save holding the document before pinning",
      async () => {
        const doc = await cappedDocument(dialect);
        const collection = await current!
          .getService("collectionRegistryService")
          .getCollectionBySlug("notes");
        const order: string[] = [];
        let release!: () => void;
        const held = new Promise<void>(resolve => {
          release = resolve;
        });
        let locked!: () => void;
        const lockTaken = new Promise<void>(resolve => {
          locked = resolve;
        });

        // The lock a save takes on its document before it writes, captures
        // and trims the history.
        const save = doc
          .inTx(async tx => {
            await tx.lockRow(collection!.tableName, doc.entryId);
            locked();
            await held;
            order.push("save finished");
          })
          .then(() => undefined);
        await lockTaken;

        const pin = doc
          .inTx(tx =>
            versionPins
              .holder("workflows")
              .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
          )
          .then(() => {
            order.push("pinned");
          });

        // Long enough for a pin that does not wait to finish.
        await new Promise(resolve => setTimeout(resolve, 500));
        release();
        await Promise.all([save, pin]);

        expect(order).toEqual(["save finished", "pinned"]);
        expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([
          { holder: "workflows", slot: "approved", versionNo: 1 },
        ]);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "waits for a pin of the same document before releasing",
      async () => {
        const doc = await cappedDocument(dialect);
        const holder = versionPins.holder("workflows");
        await doc.inTx(tx =>
          holder.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
        );
        const collection = await current!
          .getService("collectionRegistryService")
          .getCollectionBySlug("notes");
        const order: string[] = [];
        let finish!: () => void;
        const held = new Promise<void>(resolve => {
          finish = resolve;
        });
        let locked!: () => void;
        const lockTaken = new Promise<void>(resolve => {
          locked = resolve;
        });

        // Holds the document as a pin moving the slot does, between reading
        // the slot and writing it.
        const pinning = doc
          .inTx(async tx => {
            await tx.lockRow(collection!.tableName, doc.entryId);
            locked();
            await held;
            order.push("pin finished");
          })
          .then(() => undefined);
        await lockTaken;

        const releasing = doc
          .inTx(tx => holder.release(tx, { ref: doc.ref, slot: "approved" }))
          .then(() => {
            order.push("released");
          });

        await new Promise(resolve => setTimeout(resolve, 500));
        finish();
        await Promise.all([pinning, releasing]);

        expect(order).toEqual(["pin finished", "released"]);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "refuses a pin on a document deleted while the pin waited",
      async () => {
        const doc = await cappedDocument(dialect);
        const collection = await current!
          .getService("collectionRegistryService")
          .getCollectionBySlug("notes");
        let finish!: () => void;
        const held = new Promise<void>(resolve => {
          finish = resolve;
        });
        let locked!: () => void;
        const lockTaken = new Promise<void>(resolve => {
          locked = resolve;
        });

        // A delete under way: the row is gone once it commits, and its
        // history is kept.
        const deleting = doc
          .inTx(async tx => {
            await tx.lockRow(collection!.tableName, doc.entryId);
            locked();
            await held;
            await tx.delete(collection!.tableName, {
              and: [{ column: "id", op: "=", value: doc.entryId }],
            });
          })
          .then(() => undefined);
        await lockTaken;

        const pinning = doc
          .inTx(tx =>
            versionPins
              .holder("workflows")
              .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
          )
          .then(
            () => undefined,
            (error: unknown) => error
          );

        await new Promise(resolve => setTimeout(resolve, 500));
        finish();
        await deleting;
        const refused = await pinning;

        expect(NextlyError.is(refused)).toBe(true);
        expect(refused).toMatchObject({ code: "NOT_FOUND" });
        expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
      }
    );

    it("removes a collection's pins when the collection is deleted", async () => {
      const doc = await cappedDocument(dialect);
      await doc.inTx(tx =>
        versionPins
          .holder("workflows")
          .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );
      expect(await versionPins.list(current!.adapter, doc.ref)).toHaveLength(1);

      // The registry's delete, which every collection deletion reaches.
      await current!
        .getService("collectionRegistryService")
        .deleteCollection("notes", { force: true });

      expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
    });

    it("removes a document's pins when the document is deleted", async () => {
      const doc = await cappedDocument(dialect);
      await doc.inTx(tx =>
        versionPins
          .holder("workflows")
          .pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );
      expect(await versionPins.list(current!.adapter, doc.ref)).toHaveLength(1);

      await doc.handler.deleteEntry({
        collectionName: "notes",
        entryId: doc.entryId,
        overrideAccess: true,
      });
      expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
    });

    it("removes a Single's pins when the Single is deleted", async () => {
      // A Single made in the admin: one defined in code is locked against
      // deletion. Per-dialect slug, as the suites share one process.
      const slug = `pin_${dialect.slice(0, 2)}_masthead`;
      current = await createTestNextly({ dialect });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug,
          label: "Masthead",
          versions: true,
          fields: [{ name: "heading", type: "text" }],
        }
      );
      await current
        .getService("singleEntryService")
        .update(slug, { heading: "v1" }, { overrideAccess: true });
      const [version] = (
        await current.adapter.select<{ scopeSlug: string; entryId: string }>(
          "nextly_versions"
        )
      ).filter(row => row.scopeSlug === slug);
      const ref = {
        scopeKind: "single" as const,
        scopeSlug: slug,
        entryId: version!.entryId,
      };
      await current.adapter.transaction(tx =>
        versionPins
          .holder("workflows")
          .pin(tx, { ref, slot: "approved", versionNo: 1 })
      );
      // Proves the delete has a pin to remove.
      expect(await versionPins.list(current.adapter, ref)).toHaveLength(1);

      await dispatchSingles("deleteSingle", { slug }, {});

      expect(await versionPins.list(current.adapter, ref)).toEqual([]);
    });
  }
);
