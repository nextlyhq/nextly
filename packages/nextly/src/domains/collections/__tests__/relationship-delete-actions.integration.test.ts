/**
 * Deleting an entry that a Schema Builder relationship's foreign key points at.
 *
 * A required relationship refuses the delete: the entry, and everything pointing at it, stays as
 * it was, and the refusal says what still points at it (the collection, the field and how many
 * entries) instead of the database's "Referenced record does not exist.". An optional relationship
 * is emptied in the database and the delete goes through. A bulk delete reports the refusal for
 * each entry it could not delete and deletes the others.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

describeEachDialect("deleting an entry a relationship points at", dialect => {
  let current: TestNextly;
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  beforeEach(async () => {
    // The Builder applies a collection's creation in development.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    for (const collection of [
      {
        name: "people",
        label: "Person",
        labels: { singular: "Person", plural: "People" },
        fields: [{ name: "name", type: "text" }],
      },
      {
        name: "notes",
        label: "Note",
        labels: { singular: "Note", plural: "Notes" },
        fields: [
          { name: "title", type: "text" },
          {
            name: "owner",
            label: "Owner",
            type: "relationship",
            required: true,
            options: { target: "people", relationType: "manyToOne" },
          },
          {
            name: "reviewer",
            label: "Reviewer",
            type: "relationship",
            options: { target: "people", relationType: "manyToOne" },
          },
        ],
      },
    ]) {
      const created = await handler.createCollection(collection);
      expect(created.success, JSON.stringify(created)).toBe(true);
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await current?.destroy();
  });

  async function person(name: string): Promise<string> {
    const made = await current.nextly.create({
      collection: "people",
      data: { name },
    });
    return String(made.item.id);
  }

  async function note(title: string, owner: string, reviewer?: string) {
    await current.nextly.create({
      collection: "notes",
      data: { title, owner, ...(reviewer ? { reviewer } : {}) },
    });
  }

  const rows = (statement: string) =>
    current.adapter.executeQuery<Record<string, unknown>>(statement);

  const people = async () =>
    (await rows(`SELECT ${q("id")} FROM ${q("dc_people")}`)).map(r =>
      String(r.id)
    );

  it("refuses deleting someone a required relationship points at, saying what points at them", async () => {
    const ada = await person("Ada");
    await note("One", ada);
    await note("Two", ada);

    const refusal = await current.nextly
      .delete({ collection: "people", id: ada })
      .then(
        () => null,
        (error: unknown) => error
      );

    expect(NextlyError.is(refusal)).toBe(true);
    expect((refusal as NextlyError).publicMessage).toBe(
      'This entry is still used by 2 Notes in "Owner". Change or delete those first.'
    );
    // Nothing changed: the person and both notes pointing at them are there.
    expect(await people()).toEqual([ada]);
    expect(
      (await rows(`SELECT ${q("owner")} FROM ${q("dc_notes")}`)).map(r =>
        String(r.owner)
      )
    ).toEqual([ada, ada]);
  });

  it("empties an optional relationship and deletes the entry it pointed at", async () => {
    const ada = await person("Ada");
    const grace = await person("Grace");
    await note("One", ada, grace);

    await current.nextly.delete({ collection: "people", id: grace });

    expect(await people()).toEqual([ada]);
    const [row] = await rows(`SELECT ${q("reviewer")} FROM ${q("dc_notes")}`);
    expect(row?.reviewer ?? null).toBeNull();
  });

  it("deletes the others in a bulk delete, and reports the one still pointed at", async () => {
    const ada = await person("Ada");
    const grace = await person("Grace");
    await note("One", ada);

    const result = await current.nextly.bulkDelete({
      collection: "people",
      ids: [ada, grace],
    });

    expect(result.successes.map(s => s.id)).toEqual([grace]);
    expect(result.failures).toEqual([
      {
        id: ada,
        code: "CONFLICT",
        message:
          'This entry is still used by 1 Note in "Owner". Change or delete those first.',
      },
    ]);
    expect(await people()).toEqual([ada]);
  });
});
