/**
 * Breakdown divides a collection's entries as the card's settings ask, on
 * every configured dialect, and never by a field a read rule guards: such a
 * field is never offered as a Group by, a stored setting naming it falls back
 * to what the collection divides by, and a query naming it is refused.
 *
 * The declaration is core's, as the registry holds it; the reader's sources
 * are what the workspace payload publishes them (`publishableContentSources`);
 * the settings become the query through `applyWidgetSettings`, the admin's
 * one path; and the query runs against real rows as the reader.
 */

// Must be set before the harness boots (env validation).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, select, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../collection-sources";
import { executeWidgetQuery } from "../execute";
import {
  publishableContentSources,
  type PublishedContentSource,
} from "../publish";
import { validateWidgetQuery, type WidgetQuery } from "../query";
import { getWidget } from "../registry";
import { applyWidgetSettings, type KnobContext } from "../settings";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const ITEMS = "bd_items";
const POSTS = "bd_posts";

const kinds = [
  { label: "Book", value: "book" },
  { label: "Film", value: "film" },
];

describe.each(getConfiguredTestDialects())("a Breakdown card (%s)", dialect => {
  let handle: TestNextly;
  let caller: ReadCaller;
  let sources: PublishedContentSource[];
  let ctx: KnobContext;

  /** What a Breakdown card with `stored` asks and is answered, bucket by bucket. */
  async function divided(
    stored: Record<string, unknown>
  ): Promise<{ groupBy: string | undefined; buckets: Record<string, number> }> {
    const breakdown = getWidget("core/breakdown")!;
    const query = applyWidgetSettings(
      breakdown.query as WidgetQuery,
      breakdown.settings,
      stored,
      ctx
    );
    const result = await executeWidgetQuery(validateWidgetQuery(query), caller);
    expect(result.op).toBe("groupBy");
    const buckets = (
      result as { buckets: { value: string | null; count: number }[] }
    ).buckets;
    return {
      groupBy: query.groupBy,
      buckets: Object.fromEntries(
        buckets.map(bucket => [String(bucket.value), bucket.count])
      ),
    };
  }

  beforeAll(async () => {
    handle = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: ITEMS,
          fields: [
            text({ name: "title" }),
            // Declared first, so a breakdown reading the first choice
            // field regardless of read rules would group by it.
            select({
              name: "secret",
              options: kinds,
              access: { read: () => false },
            }),
            select({ name: "kind", options: kinds }),
          ],
        }),
        defineCollection({
          slug: POSTS,
          status: true,
          fields: [
            text({ name: "title" }),
            select({ name: "kind", options: kinds }),
          ],
        }),
      ],
    });
    caller = { user: { id: "bd-reader", roles: ["super-admin"] } };
    for (const kind of ["book", "book", "film"]) {
      await handle.nextly.create({
        collection: ITEMS,
        data: { title: kind, kind, secret: kind === "book" ? "film" : "book" },
      });
    }
    await handle.nextly.create({
      collection: POSTS,
      data: { title: "live", kind: "film", status: "published" },
    });
    await handle.nextly.create({
      collection: POSTS,
      data: { title: "pending", kind: "film" },
    });
    // What the query endpoint does before resolving any query: publish the
    // collection sources from the live registry, which boot does not do.
    await refreshCollectionSources();
    sources = publishableContentSources([ITEMS, POSTS]);
    ctx = {
      sourceOf: collection =>
        sources.find(source => source.collection === collection),
      fieldsOf: collection =>
        sources.find(source => source.collection === collection)?.fields,
    };
  }, 120_000);

  afterAll(async () => {
    await handle?.destroy();
  });

  it("never offers a field a read rule guards as a Group by", () => {
    const items = sources.find(source => source.collection === ITEMS);
    // The control: the collection is published, with its other fields.
    expect(items?.fields.map(field => field.name)).toContain("kind");
    expect(items?.fields.map(field => field.name)).not.toContain("secret");
  });

  it("divides a collection with no lifecycle by its first choice field a reader may use", async () => {
    // 🔴 Read without the read rule, the first choice field is `secret`.
    expect(await divided({ collection: ITEMS })).toEqual({
      groupBy: "kind",
      buckets: { book: 2, film: 1 },
    });
  });

  it("falls back from a stored grouping by a guarded field to the collection's own", async () => {
    expect(
      (await divided({ collection: ITEMS, groupBy: "secret" })).groupBy
    ).toBe("kind");
  });

  it("keeps a stored grouping the reader may use", async () => {
    expect(await divided({ collection: POSTS, groupBy: "kind" })).toEqual({
      groupBy: "kind",
      buckets: { film: 2 },
    });
  });

  it("divides a collection with a lifecycle by status", async () => {
    expect(await divided({ collection: POSTS })).toEqual({
      groupBy: "status",
      buckets: { draft: 1, published: 1 },
    });
  });

  it("refuses a query that groups by a guarded field, by name", async () => {
    // As the refusal reaches a caller: its code and the key it names, so a
    // query failing for any other reason does not pass for this one.
    const refusal = await executeWidgetQuery(
      validateWidgetQuery({
        source: `collection:${ITEMS}`,
        op: "groupBy",
        groupBy: "secret",
        status: "all",
      }),
      caller
    ).then(
      () => "answered",
      (error: unknown) => JSON.stringify(error)
    );
    expect(refusal).toContain("FIELD_NOT_GROUPABLE");
    expect(refusal).toContain("groupBy.secret");
    // The control: the same query by a field a reader may use is answered.
    expect(
      (await divided({ collection: ITEMS, groupBy: "kind" })).groupBy
    ).toBe("kind");
  });
});
