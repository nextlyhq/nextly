/**
 * A plugin pins a version in its own transaction, on every dialect.
 *
 * `ctx.services.versions.pins` hands a plugin holders of its own, each pinning
 * on the transaction the plugin passes it: `ctx.db.transaction`'s handle or
 * the token `ctx.services.collections.withTransaction` hands its work. A pin
 * commits or rolls back with the plugin's own writes, and takes the same
 * document lock and refusals as core's pins. A plugin's holder names are its
 * own: two plugins naming a holder alike hold apart, and neither reaches
 * core's.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { NextlyError } from "../../errors";
import { untilSomeoneWaitsOnALock } from "../../domains/versions/__tests__/helpers/lock-wait";
import {
  registerVersionPinHolder,
  versionPins,
} from "../../domains/versions/version-pins";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

// A core feature's holder, as core registers its own.
const coreHolder = registerVersionPinHolder({
  name: "workflows",
  label: "Workflows",
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin that keeps its context, so the test can act as the plugin. */
function capturing(name: string, into: Map<string, PluginContext>) {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      into.set(name, ctx);
    },
  });
}

/**
 * Two plugins and a document with a cap of 3 versions, saved once
 * (version 1).
 */
async function boot(dialect: TestDialect) {
  const contexts = new Map<string, PluginContext>();
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "notes",
        versions: { drafts: false, maxPerDoc: 3 },
        fields: [text({ name: "title" })],
      }),
    ],
    plugins: [
      capturing("@test/pins-a", contexts),
      capturing("@test/pins-b", contexts),
    ],
  });
  const a = contexts.get("@test/pins-a");
  const b = contexts.get("@test/pins-b");
  if (!a || !b) throw new Error("the plugins' init did not run");
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
      .sort((x, y) => x - y);
  // Every slot on the document, of every holder, as the database holds them.
  const stored = () => versionPins.list(current!.adapter, ref);
  return { a, b, handler, entryId, ref, save, kept, stored };
}

const isRefusal = (reason: string) => (error: unknown) =>
  error instanceof NextlyError &&
  (error.logContext as { reason?: string } | undefined)?.reason === reason;

const isInvalidTransaction = (error: unknown) =>
  error instanceof NextlyError &&
  JSON.stringify(error.publicData ?? {}).includes("INVALID");

describe.each(getConfiguredTestDialects())(
  "a plugin's version pins (%s)",
  dialect => {
    it("pins in ctx.db.transaction, and retention keeps the version", async () => {
      const doc = await boot(dialect);
      const approvals = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });

      await doc.a.db.transaction(tx =>
        approvals.pin(doc.ref, { slot: "approved", versionNo: 1 }, { tx })
      );
      await doc.save(6);

      expect(await doc.kept()).toContain(1);
      expect(await doc.stored()).toEqual([
        { holder: "test-pins-a.approvals", slot: "approved", versionNo: 1 },
      ]);
      expect(
        await doc.a.db.transaction(tx => approvals.list(doc.ref, { tx }))
      ).toEqual([{ slot: "approved", versionNo: 1 }]);
    });

    it("leaves no pin when the plugin's transaction rolls back", async () => {
      const doc = await boot(dialect);
      const approvals = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });

      const failed = await doc.a.db
        .transaction(async tx => {
          await approvals.pin(
            doc.ref,
            { slot: "approved", versionNo: 1 },
            { tx }
          );
          throw new Error("the plugin's own write failed");
        })
        .catch((error: unknown) => error);

      expect(failed).toBeInstanceOf(Error);
      expect(await doc.stored()).toEqual([]);
    });

    it("pins and rolls back with collections.withTransaction too", async () => {
      const doc = await boot(dialect);
      const collections = doc.a.services.collections;
      const approvals = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });

      await collections
        .withTransaction(async tx => {
          await approvals.pin(doc.ref, { slot: "lost", versionNo: 1 }, { tx });
          throw new Error("rolled back");
        })
        .catch(() => undefined);
      expect(await doc.stored()).toEqual([]);

      await collections.withTransaction(tx =>
        approvals.pin(doc.ref, { slot: "kept", versionNo: 1 }, { tx })
      );
      expect(await doc.stored()).toEqual([
        { holder: "test-pins-a.approvals", slot: "kept", versionNo: 1 },
      ]);
    });

    it("releases a slot, and every slot, in the plugin's transaction", async () => {
      const doc = await boot(dialect);
      const approvals = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });
      await doc.a.db.transaction(async tx => {
        await approvals.pin(doc.ref, { slot: "one", versionNo: 1 }, { tx });
        await approvals.pin(doc.ref, { slot: "two", versionNo: 1 }, { tx });
      });

      await doc.a.db.transaction(tx =>
        approvals.release(doc.ref, { slot: "one" }, { tx })
      );
      expect((await doc.stored()).map(pin => pin.slot)).toEqual(["two"]);

      await doc.a.db.transaction(tx => approvals.releaseAll(doc.ref, { tx }));
      expect(await doc.stored()).toEqual([]);
    });

    it("keeps two plugins' holders of one name apart", async () => {
      const doc = await boot(dialect);
      const fromA = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });
      const fromB = doc.b.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Sign-off",
      });

      await doc.a.db.transaction(tx =>
        fromA.pin(doc.ref, { slot: "approved", versionNo: 1 }, { tx })
      );
      await doc.b.db.transaction(tx => fromB.releaseAll(doc.ref, { tx }));

      expect(await doc.stored()).toEqual([
        { holder: "test-pins-a.approvals", slot: "approved", versionNo: 1 },
      ]);
      expect(
        await doc.b.db.transaction(tx => fromB.list(doc.ref, { tx }))
      ).toEqual([]);
    });

    it("never hands a plugin a core holder, even by its name", async () => {
      const doc = await boot(dialect);
      await current!.adapter.transaction(tx =>
        coreHolder.pin(tx, { ref: doc.ref, slot: "approved", versionNo: 1 })
      );
      const namedAlike = doc.a.services.versions.pins.registerHolder({
        name: "workflows",
        label: "Workflows",
      });

      await doc.a.db.transaction(tx => namedAlike.releaseAll(doc.ref, { tx }));

      expect(await doc.stored()).toEqual([
        { holder: "workflows", slot: "approved", versionNo: 1 },
      ]);
      // The plugin's holder is "<slug>.workflows", so core's "workflows" is
      // not its own: the read never answers with core's slot.
      expect(
        await doc.a.db.transaction(tx => namedAlike.list(doc.ref, { tx }))
      ).toEqual([]);
    });

    it("refuses a name that is not kebab-case", async () => {
      const doc = await boot(dialect);
      expect(() =>
        doc.a.services.versions.pins.registerHolder({
          name: "core.workflows",
          label: "Workflows",
        })
      ).toThrow(NextlyError);
    });

    it("refuses as core does: a deleted document, a missing version", async () => {
      const doc = await boot(dialect);
      const approvals = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });

      const missingVersion = await doc.a.db
        .transaction(tx =>
          approvals.pin(doc.ref, { slot: "approved", versionNo: 99 }, { tx })
        )
        .catch((error: unknown) => error);
      expect(missingVersion).toSatisfy(isRefusal("version-pin-target-missing"));

      await doc.handler.deleteEntry({
        collectionName: "notes",
        entryId: doc.entryId,
        overrideAccess: true,
      });
      const deleted = await doc.a.db
        .transaction(tx =>
          approvals.pin(doc.ref, { slot: "approved", versionNo: 1 }, { tx })
        )
        .catch((error: unknown) => error);
      expect(deleted).toSatisfy(isRefusal("version-pin-document-missing"));
      expect(await doc.stored()).toEqual([]);
    });

    it("refuses anything but an open transaction of the plugin's", async () => {
      const doc = await boot(dialect);
      const approvals = doc.a.services.versions.pins.registerHolder({
        name: "approvals",
        label: "Approvals",
      });
      const pin = (tx: unknown) =>
        approvals
          .pin(doc.ref, { slot: "approved", versionNo: 1 }, { tx: tx as never })
          .catch((error: unknown) => error);

      // The pooled database, a forged object, and a handle kept past its
      // transaction.
      expect(await pin(doc.a.db)).toSatisfy(isInvalidTransaction);
      expect(await pin({})).toSatisfy(isInvalidTransaction);
      let kept: unknown;
      await doc.a.db.transaction(async tx => {
        kept = tx;
      });
      expect(await pin(kept)).toBeInstanceOf(NextlyError);
      expect(await doc.stored()).toEqual([]);
    });

    it.skipIf(dialect === "sqlite")(
      "waits for a save holding the document before pinning",
      async () => {
        const doc = await boot(dialect);
        const approvals = doc.a.services.versions.pins.registerHolder({
          name: "approvals",
          label: "Approvals",
        });
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

        // The lock a save takes on its document before it writes.
        const save = current!.adapter
          .transaction(async tx => {
            await tx.lockRow(collection!.tableName, doc.entryId);
            locked();
            await held;
            order.push("save finished");
          })
          .then(() => undefined);
        await lockTaken;

        const pin = doc.a.db
          .transaction(tx =>
            approvals.pin(doc.ref, { slot: "approved", versionNo: 1 }, { tx })
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
      }
    );
  }
);
