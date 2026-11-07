/**
 * What a delete takes from the templates, against stand-in services: a
 * deleted collection's template unlinks its copies, a deleted own design has
 * none to unlink, an entry's delete deletes its own design on the delete's
 * transaction, and the plugin's own documents and other writes are left
 * alone. The same deletes against a real instance, on every dialect, are
 * `__tests__/entry-designs.integration.test.ts`.
 */
import type { PluginCollectionTransaction } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  registerEntryDesignCascade,
  type EntryDesignCascadeSetup,
} from "./entry-design-cascade";

const TX = Object.freeze({}) as PluginCollectionTransaction;

/**
 * A write as core's in-transaction phase hands it to the cascade. A delete
 * carries the document it removed in `data`, in the shape a read returns;
 * `originalData` is an update's alone, so no delete here has one.
 */
interface Write {
  collection: string;
  operation: "create" | "update" | "delete";
  id: string;
  transaction: PluginCollectionTransaction;
  data?: unknown;
}

/** The cascade over `designs` (key to design id), recording what it did. */
function cascade(designs: Record<string, string>) {
  const unlinked: string[] = [];
  const deleted: [string, string][] = [];
  const read: string[] = [];
  const setup: EntryDesignCascadeSetup = {
    templates: "templates",
    ownCollections: () => new Set(["templates", "pages"]),
    designUnder: async (tx, key) => {
      expect(tx).toBe(TX);
      read.push(key);
      return designs[key] ?? null;
    },
    unlinkCopiesOf: async (tx, id) => {
      expect(tx).toBe(TX);
      unlinked.push(id);
    },
    deleteInTransaction: async (tx, slug, id) => {
      expect(tx).toBe(TX);
      deleted.push([slug, id]);
    },
  };
  let handler: ((write: Write) => Promise<void>) | undefined;
  registerEntryDesignCascade(
    {
      onInTransaction: (collection, registered) => {
        expect(collection).toBe("*");
        handler = registered;
      },
    },
    setup
  );
  const run = async (write: Write) => {
    if (!handler) throw new Error("the cascade was not registered");
    await handler(write);
  };
  return { run, unlinked, deleted, read };
}

describe("a delete's cascade", () => {
  it("unlinks a deleted collection template's copies", async () => {
    const { run, unlinked, deleted } = cascade({});

    await run({
      collection: "templates",
      operation: "delete",
      id: "t1",
      transaction: TX,
      data: {
        id: "t1",
        collection: "posts",
        entry: null,
        entryCollection: null,
        entryId: null,
      },
    });

    expect(unlinked).toEqual(["t1"]);
    expect(deleted).toEqual([]);
  });

  it("looks for no copies of a deleted own design", async () => {
    const { run, unlinked, read } = cascade({});

    await run({
      collection: "templates",
      operation: "delete",
      id: "d1",
      transaction: TX,
      data: {
        id: "d1",
        collection: null,
        entry: "posts/p1",
        entryCollection: "posts",
        entryId: "p1",
      },
    });

    expect(unlinked).toEqual([]);
    expect(read).toEqual([]);
  });

  it("deletes an entry's own design with the entry, on the delete's transaction", async () => {
    const { run, deleted, read } = cascade({ "posts/p1": "d1" });

    await run({
      collection: "posts",
      operation: "delete",
      id: "p1",
      transaction: TX,
    });

    expect(read).toEqual(["posts/p1"]);
    expect(deleted).toEqual([["templates", "d1"]]);
  });

  it("asks again for each entry, so a design given to a later entry of a bulk delete is found", async () => {
    const { run, deleted, read } = cascade({ "posts/p2": "d2" });

    await run({
      collection: "posts",
      operation: "delete",
      id: "p1",
      transaction: TX,
    });
    await run({
      collection: "posts",
      operation: "delete",
      id: "p2",
      transaction: TX,
    });

    expect(read).toEqual(["posts/p1", "posts/p2"]);
    expect(deleted).toEqual([["templates", "d2"]]);
  });

  it("leaves the plugin's own documents and every write but a delete alone", async () => {
    const { run, deleted, read, unlinked } = cascade({ "pages/x1": "d9" });

    await run({
      collection: "pages",
      operation: "delete",
      id: "x1",
      transaction: TX,
    });
    await run({
      collection: "posts",
      operation: "update",
      id: "p1",
      transaction: TX,
    });

    expect(read).toEqual([]);
    expect(deleted).toEqual([]);
    expect(unlinked).toEqual([]);
  });
});
