/**
 * A widget query is CALLER INPUT, so it must earn exactly what any other read
 * earns and nothing more.
 *
 * `execute.test.ts` mocks `getNextly`, so it can only assert the arguments the
 * executor builds -- it can never observe what the read path does with them.
 * The claim this branch rests on ("we delegate enforcement to the ordinary read
 * path") is therefore invisible to it: an argument that DISABLES a guard looks
 * exactly like one that does not at a mock boundary. This boots a real Nextly
 * on in-memory SQLite and runs the executor against it, so the enforcement is
 * observed rather than restated.
 *
 * Two properties, both about the same thing:
 *   - a caller the collection's read rule denies gets nothing;
 *   - a `where` (or `sort`) naming a field with a read rule is REFUSED, the
 *     same named refusal `GET /api/collections/:slug` gives, rather than
 *     answered. Answering it is a field-value oracle: `count` with
 *     `{ id: eq X, salary: { greater_than: N } }` replies 1 or 0, and ~20 of
 *     those bisect a figure the caller may never read.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { executeWidgetQuery, type ReadCaller } from "../execute";
import { validateWidgetQuery } from "../query";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const EMPLOYEES = "employees";

/** The caller under test: a real editor, never an admin, never trusted. */
const editor: ReadCaller = {
  user: { id: "editor-1", roles: ["editor"] },
};

type WriteHandler = {
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean; data: Record<string, unknown> | null }>;
};

/**
 * A collection whose ROWS are readable by anyone but whose `salary` field
 * carries a read rule -- the shape a field rule exists for, and the shape the
 * oracle lives in. `readableRows` flips the collection-level rule so the same
 * fixture serves the permission test too.
 */
async function boot(readableRows: boolean): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: EMPLOYEES,
        access: {
          read: () => readableRows,
          create: () => true,
          update: () => true,
        },
        fields: [
          text({ name: "title" }),
          text({ name: "salary", access: { read: () => false } }),
        ],
      }),
    ],
  });

  const handler = t.getService("collectionsHandler") as unknown as WriteHandler;
  await handler.createEntry(
    { collectionName: EMPLOYEES, overrideAccess: true },
    { title: "alice", salary: "120000" }
  );
  await handler.createEntry(
    { collectionName: EMPLOYEES, overrideAccess: true },
    { title: "bob", salary: "60000" }
  );
  return t;
}

describe("executeWidgetQuery against a real instance", () => {
  it("returns rows to a caller the collection's read rule admits", async () => {
    // The positive control. Without it, every assertion below is satisfied by
    // a widget path that is simply broken for everyone.
    current = await boot(true);

    const result = await executeWidgetQuery(
      validateWidgetQuery({ source: `collection:${EMPLOYEES}`, op: "count" }),
      editor
    );

    expect(result).toEqual({ op: "count", total: 2 });
  });

  it("denies a caller the collection's read rule refuses", async () => {
    current = await boot(false);

    await expect(
      executeWidgetQuery(
        validateWidgetQuery({ source: `collection:${EMPLOYEES}`, op: "count" }),
        editor
      )
    ).rejects.toThrow();
  });

  it("REFUSES a where that names a field carrying a read rule", async () => {
    current = await boot(true);

    // The oracle, written out. A count answers 1 or 0 for a guessed value and
    // hands back no row to redact, so redaction never sees the value leave.
    const probe = validateWidgetQuery({
      source: `collection:${EMPLOYEES}`,
      op: "count",
      where: { salary: { equals: "120000" } },
    });

    await expect(executeWidgetQuery(probe, editor)).rejects.toThrow(
      /FIELD_NOT_FILTERABLE|cannot be used to filter|Validation failed/
    );
  });

  it("REFUSES a sort that names a field carrying a read rule", async () => {
    // The ordering variant of the same leak: the rows come back redacted and
    // their ORDER is a comparison of the hidden column.
    current = await boot(true);

    const probe = validateWidgetQuery({
      source: `collection:${EMPLOYEES}`,
      op: "list",
      sort: "-salary",
      select: ["id"],
    });

    await expect(executeWidgetQuery(probe, editor)).rejects.toThrow(
      /FIELD_NOT_SORTABLE|cannot be used to sort|Validation failed/
    );
  });

  it("still filters on a field the caller may read", async () => {
    // The negative control. An executor that refused every filter would pass
    // both refusal tests above and ship a dashboard that renders nothing.
    current = await boot(true);

    const result = await executeWidgetQuery(
      validateWidgetQuery({
        source: `collection:${EMPLOYEES}`,
        op: "count",
        where: { title: { equals: "alice" } },
      }),
      editor
    );

    expect(result).toEqual({ op: "count", total: 1 });
  });
});
