/**
 * A feature can pin a version so retention never removes it, whatever the
 * limit. Pins are named slots per holder: one holder releasing never frees a
 * version another still holds, and moving a slot frees the version it left.
 */
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import type { SanitizedNextlyConfig } from "../../../shared/types/config";
import { CollectionSyncService } from "../../collections/services/collection-sync-service";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { untilSomeoneWaitsOnALock } from "./helpers/lock-wait";
import {
  pinnedVersionNos,
  registerVersionPinHolder,
  versionPins,
} from "../version-pins";

// Two holders, registered as two features would, each keeping its handle.
const workflows = registerVersionPinHolder({
  name: "workflows",
  label: "Workflows",
});
const review = registerVersionPinHolder({
  name: "test-review",
  label: "Test review",
});

let current: TestNextly | undefined;

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

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
        workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
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
        await workflows.pin(tx, {
          ref: doc.ref,
          slot: "approved",
          versionNo: 1,
        });
        await review.pin(tx, { ref: doc.ref, slot: "seen", versionNo: 1 });
      });
      await doc.inTx(tx =>
        workflows.release(tx, { ref: doc.ref, slot: "approved" })
      );

      await doc.save(5);
      expect(await doc.kept()).toContain(1);

      await doc.inTx(tx => review.releaseAll(tx, doc.ref));
      await doc.save(1);
      expect(await doc.kept()).not.toContain(1);
    });

    it("frees the version a slot leaves when it moves", async () => {
      const doc = await cappedDocument(dialect);
      await doc.save(1); // version 2
      await doc.inTx(tx =>
        workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );
      await doc.inTx(tx =>
        workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 2 })
      );

      await doc.save(5);
      const kept = await doc.kept();
      expect(kept).toContain(2);
      expect(kept).not.toContain(1);
      expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([
        { holder: "workflows", slot: "approved", versionNo: 2 },
      ]);
    });

    it("refuses a version the document does not have", async () => {
      const doc = await cappedDocument(dialect);
      const missing = await doc
        .inTx(tx =>
          workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 99 })
        )
        .then(
          () => undefined,
          (error: unknown) => error
        );
      expect(NextlyError.is(missing)).toBe(true);
      expect(missing).toMatchObject({ code: "NOT_FOUND" });
    });

    // SQLite runs one writer at a time, so a pin there cannot overlap a save;
    // the race this guards only exists where transactions run side by side.
    // MySQL answers a plain read from the snapshot a transaction's first read
    // took; a save that has read anything before it trims would otherwise miss
    // a pin committed since, and prune the version it holds.
    it.skipIf(dialect === "sqlite")(
      "reads a pin committed after the saving transaction's first read",
      async () => {
        const doc = await cappedDocument(dialect);
        let resume!: () => void;
        const pinned = new Promise<void>(resolve => {
          resume = resolve;
        });
        let started!: () => void;
        const snapshotTaken = new Promise<void>(resolve => {
          started = resolve;
        });

        const saving = doc.inTx(async tx => {
          // Any read opens the snapshot, as a save's reads before its lock do.
          await tx.select("nextly_versions", { limit: 1 });
          started();
          await pinned;
          return pinnedVersionNos(tx, doc.ref);
        });
        await snapshotTaken;
        await doc.inTx(tx =>
          workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
        );
        resume();

        expect(await saving).toEqual([1]);
      }
    );

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
            workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
          )
          .then(() => {
            order.push("pinned");
          });

        try {
          await untilSomeoneWaitsOnALock(current!.adapter, dialect);
        } finally {
          release();
        }
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
        await doc.inTx(tx =>
          workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
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
          .inTx(tx => workflows.release(tx, { ref: doc.ref, slot: "approved" }))
          .then(() => {
            order.push("released");
          });

        try {
          await untilSomeoneWaitsOnALock(current!.adapter, dialect);
        } finally {
          finish();
        }
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
            workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
          )
          .then(
            () => undefined,
            (error: unknown) => error
          );

        try {
          await untilSomeoneWaitsOnALock(current!.adapter, dialect);
        } finally {
          finish();
        }
        await deleting;
        const refused = await pinning;

        expect(NextlyError.is(refused)).toBe(true);
        expect(refused).toMatchObject({ code: "NOT_FOUND" });
        expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "refuses a pin on a collection deleted while the pin waited",
      async () => {
        const doc = await cappedDocument(dialect);
        let finish!: () => void;
        const held = new Promise<void>(resolve => {
          finish = resolve;
        });
        let removed!: () => void;
        const rowRemoved = new Promise<void>(resolve => {
          removed = resolve;
        });

        // The registry's delete under way: it sweeps the pins and removes the
        // registry row in one transaction, which commits after the pin starts.
        const deleting = doc
          .inTx(async tx => {
            await tx.delete("nextly_version_pins", {
              and: [{ column: "scopeSlug", op: "=", value: "notes" }],
            });
            await tx.delete("dynamic_collections", {
              and: [{ column: "slug", op: "=", value: "notes" }],
            });
            removed();
            await held;
          })
          .then(() => undefined);
        await rowRemoved;

        const pinning = doc
          .inTx(tx =>
            workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
          )
          .then(
            () => undefined,
            (error: unknown) => error
          );

        try {
          await untilSomeoneWaitsOnALock(current!.adapter, dialect);
        } finally {
          finish();
        }
        await deleting;
        const refused = await pinning;

        expect(NextlyError.is(refused)).toBe(true);
        expect(refused).toMatchObject({ code: "NOT_FOUND" });
        expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
      }
    );

    it("removes an orphaned collection's pins when a sync deletes it", async () => {
      const doc = await cappedDocument(dialect);
      await doc.inTx(tx =>
        workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );
      expect(await versionPins.list(current!.adapter, doc.ref)).toHaveLength(1);

      // The collection is gone from the code, and the sync removes what the
      // database still holds of it, outside the registry's own delete.
      // Nothing is generated: no collection is left, and no generator is on.
      const config = {
        collections: [],
        db: { schemasDir: "src/db/schemas" },
      } as unknown as SanitizedNextlyConfig;
      await new CollectionSyncService(current!.adapter, silentLogger).sync(
        config,
        { onRemoved: "delete", cwd: tmpdir() }
      );

      expect(
        await current!
          .getService("collectionRegistryService")
          .getCollectionBySlug("notes")
      ).toBeFalsy();
      expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
    });

    /**
     * A pin that holds the collection's registry row (the lock `pin` takes
     * first) while the registry's delete runs, then pins and commits. The
     * delete must still leave no pin, and must not deadlock with the pin.
     */
    async function pinWhileDeleting(
      doc: Awaited<ReturnType<typeof cappedDocument>>,
      versionNo: number
    ) {
      let finish!: () => void;
      const held = new Promise<void>(resolve => {
        finish = resolve;
      });
      let locked!: () => void;
      const lockTaken = new Promise<void>(resolve => {
        locked = resolve;
      });
      const pinning = doc.inTx(async tx => {
        await tx.selectOne("dynamic_collections", {
          where: { and: [{ column: "slug", op: "=", value: "notes" }] },
          forUpdate: true,
        });
        locked();
        await held;
        await workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo });
      });
      await lockTaken;
      const deleting = current!
        .getService("collectionRegistryService")
        .deleteCollection("notes", { force: true });
      try {
        await untilSomeoneWaitsOnALock(current!.adapter, dialect);
      } finally {
        finish();
      }
      return Promise.allSettled([pinning, deleting]);
    }

    it.skipIf(dialect === "sqlite")(
      "leaves no pin when a pin holds the registry row as its entity is deleted",
      async () => {
        const doc = await cappedDocument(dialect);
        const [pinned, deleted] = await pinWhileDeleting(doc, 1);
        expect(pinned.status).toBe("fulfilled");
        expect(deleted.status).toBe("fulfilled");
        expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
      }
    );

    it.skipIf(dialect === "sqlite")(
      "does not deadlock when a pin moves its slot as its entity is deleted",
      async () => {
        const doc = await cappedDocument(dialect);
        await doc.save(1); // version 2
        await doc.inTx(tx =>
          workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
        );
        const [pinned, deleted] = await pinWhileDeleting(doc, 2);
        expect(pinned.status).toBe("fulfilled");
        expect(deleted.status).toBe("fulfilled");
        expect(await versionPins.list(current!.adapter, doc.ref)).toEqual([]);
      }
    );

    it("removes a collection's pins when the collection is deleted", async () => {
      const doc = await cappedDocument(dialect);
      await doc.inTx(tx =>
        workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
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
        workflows.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
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
        workflows.pin(tx, { ref, slot: "approved", versionNo: 1 })
      );
      // Proves the delete has a pin to remove.
      expect(await versionPins.list(current.adapter, ref)).toHaveLength(1);

      await dispatchSingles("deleteSingle", { slug }, {});

      expect(await versionPins.list(current.adapter, ref)).toEqual([]);
    });
  }
);
