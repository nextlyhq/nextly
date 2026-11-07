/**
 * The page builder's collection-delete handlers against stand-in services, so
 * each case is about what is asked and removed: the plugin's own collections
 * are skipped, the impact names a template by its title, and the removal
 * reads on the delete's transaction, for update, until no row is left.
 */
import { describe, expect, it } from "vitest";

import { TEMPLATE_COLLECTION_FIELD } from "../collections/templates";

import {
  holdTemplateCollection,
  templateCollectionDelete,
  type TemplateDeleteServices,
} from "./collection-delete";

const TX = { token: "the delete's transaction" };

/** Services over `rows`, recording what was asked and deleted. */
function standIn(rows: Record<string, unknown>[]) {
  const stored = [...rows];
  const asked: { where: unknown; locked: boolean }[] = [];
  const deleted: string[] = [];
  const matches = (
    where: Record<string, unknown>,
    row: Record<string, unknown>
  ): boolean =>
    Array.isArray(where.or)
      ? (where.or as Record<string, unknown>[]).some(each => matches(each, row))
      : Object.entries(where).every(
          ([field, condition]) =>
            row[field] === (condition as { equals: unknown }).equals
        );
  const services: TemplateDeleteServices<typeof TX> = {
    listTemplates: async options => {
      asked.push({ where: options.where, locked: false });
      return { data: stored.filter(row => matches(options.where, row)) };
    },
    listTemplatesInTransaction: async (tx, options) => {
      expect(tx).toBe(TX);
      asked.push({ where: options.where, locked: true });
      return {
        data: stored
          .filter(row => matches(options.where, row))
          .slice(0, options.pagination.limit),
      };
    },
    deleteTemplateInTransaction: async (tx, id) => {
      expect(tx).toBe(TX);
      deleted.push(id);
      stored.splice(
        stored.findIndex(row => row.id === id),
        1
      );
    },
    entryTitles: async () => new Map<string, string>(),
  };
  return { services, asked, deleted, stored };
}

const own = () => new Set(["templates", "pages"]);

describe("the page builder's collection-delete handlers", () => {
  it("names an own design by its entry's title, read once for the page", async () => {
    const { services } = standIn([
      {
        id: "d1",
        title: "Design copy",
        entryCollection: "articles",
        entryId: "e1",
      },
      {
        id: "d2",
        title: "Another copy",
        entryCollection: "articles",
        entryId: "e2",
      },
    ]);
    // Own designs name no collection, so they are listed here directly.
    services.listTemplates = async () => ({
      data: [
        { id: "d1", entryCollection: "articles", entryId: "e1" },
        { id: "d2", entryCollection: "articles", entryId: "e2" },
      ],
    });
    const asks: string[][] = [];
    services.entryTitles = async (_collection, ids) => {
      asks.push([...ids]);
      return new Map([["e1", "Ten years of field notes"]]);
    };
    const handlers = templateCollectionDelete({ services, own });
    expect(await handlers.impact("articles")).toEqual([
      { label: "Ten years of field notes", kind: "design" },
      { label: "e2", kind: "design" },
    ]);
    expect(asks).toEqual([["e1", "e2"]]);
  });
  it("names the collection's template by its title, deleting nothing", async () => {
    const { services, deleted } = standIn([
      {
        id: "t1",
        title: "Article page",
        [TEMPLATE_COLLECTION_FIELD]: "articles",
      },
      { id: "t2", title: "Post page", [TEMPLATE_COLLECTION_FIELD]: "posts" },
    ]);
    const handlers = templateCollectionDelete({ services, own });

    expect(await handlers.impact("articles")).toEqual([
      { label: "Article page", kind: "template" },
    ]);
    expect(deleted).toEqual([]);
  });

  it("deletes every row naming the collection on the transaction, page after page", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      id: `t${String(index)}`,
      title: `Design ${String(index)}`,
      [TEMPLATE_COLLECTION_FIELD]: "articles",
    }));
    const { services, asked, deleted, stored } = standIn([
      ...rows,
      { id: "kept", title: "Post page", [TEMPLATE_COLLECTION_FIELD]: "posts" },
    ]);
    const handlers = templateCollectionDelete({ services, own });

    await handlers.inTransaction({ slug: "articles", transaction: TX });

    expect(deleted).toHaveLength(150);
    expect(stored.map(row => row.id)).toEqual(["kept"]);
    expect(asked.every(call => call.locked)).toBe(true);
  });

  it("deletes the entries' own designs before the collection's template, so none is unlinked first", async () => {
    // The template first, as a read naming both would find it: deleted
    // first, it would empty the link of designs deleted a moment later.
    const { services, asked, deleted, stored } = standIn([
      {
        id: "t1",
        title: "Article page",
        [TEMPLATE_COLLECTION_FIELD]: "articles",
      },
      {
        id: "d1",
        entryCollection: "articles",
        entryId: "e1",
        forkedFrom: "t1",
      },
      {
        id: "d2",
        entryCollection: "articles",
        entryId: "e2",
        forkedFrom: "t1",
      },
      // The control: a design of another collection copied from the same
      // template is not this delete's, and stays to have its link emptied.
      { id: "d3", entryCollection: "posts", entryId: "p1", forkedFrom: "t1" },
    ]);
    const handlers = templateCollectionDelete({ services, own });

    await handlers.inTransaction({ slug: "articles", transaction: TX });

    expect(deleted).toEqual(["d1", "d2", "t1"]);
    expect(stored.map(row => row.id)).toEqual(["d3"]);
    expect(asked.map(call => call.where)).toEqual([
      { entryCollection: { equals: "articles" } },
      { [TEMPLATE_COLLECTION_FIELD]: { equals: "articles" } },
    ]);
  });

  it("skips the plugin's own collections, asking nothing", async () => {
    const { services, asked, deleted } = standIn([
      { id: "t1", title: "x", [TEMPLATE_COLLECTION_FIELD]: "pages" },
    ]);
    const handlers = templateCollectionDelete({ services, own });

    expect(await handlers.impact("pages")).toEqual([]);
    await handlers.inTransaction({ slug: "pages", transaction: TX });

    expect(asked).toEqual([]);
    expect(deleted).toEqual([]);
  });
});

describe("a template's write holding its collection", () => {
  /** A hold over the collections that exist, recording what it held. */
  function holding(existing: readonly string[]) {
    const held: string[] = [];
    const handler = holdTemplateCollection<typeof TX>(
      async (tx, collection) => {
        expect(tx).toBe(TX);
        held.push(collection);
        return existing.includes(collection);
      }
    );
    return { handler, held };
  }

  it("holds the collection a new template names, on the write's transaction", async () => {
    const { handler, held } = holding(["articles"]);

    await handler({
      operation: "create",
      data: { [TEMPLATE_COLLECTION_FIELD]: "articles" },
      transaction: TX,
    });

    expect(held).toEqual(["articles"]);
  });

  it("refuses a template whose collection is gone by the time it holds it", async () => {
    const { handler } = holding([]);

    await expect(
      handler({
        operation: "create",
        data: { [TEMPLATE_COLLECTION_FIELD]: "articles" },
        transaction: TX,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "template-collection-refused" },
    });
  });

  it("holds nothing for an update that keeps its collection, or a delete", async () => {
    const { handler, held } = holding(["articles", "posts"]);

    await handler({
      operation: "update",
      data: { [TEMPLATE_COLLECTION_FIELD]: "articles", title: "New" },
      originalData: { [TEMPLATE_COLLECTION_FIELD]: "articles" },
      transaction: TX,
    });
    await handler({
      operation: "delete",
      data: { [TEMPLATE_COLLECTION_FIELD]: "articles" },
      transaction: TX,
    });
    expect(held).toEqual([]);

    // The control: an update pointing it at another collection holds that one.
    await handler({
      operation: "update",
      data: { [TEMPLATE_COLLECTION_FIELD]: "posts" },
      originalData: { [TEMPLATE_COLLECTION_FIELD]: "gone" },
      transaction: TX,
    });
    expect(held).toEqual(["posts"]);
  });
});
