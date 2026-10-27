/**
 * A Recent entries card shows the fields its reader chose, on every configured
 * dialect, and never a field a read rule guards: such a field is never offered
 * to choose, a stored choice naming it falls back to the card's own fields, and
 * a read that asks for it anyway answers without it.
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

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
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
const NOTES = "ref_notes";

describe.each(getConfiguredTestDialects())(
  "a Recent entries card's Fields (%s)",
  dialect => {
    let handle: TestNextly;
    let caller: ReadCaller;
    let sources: PublishedContentSource[];
    let ctx: KnobContext;

    /** What a Recent entries card with `stored` asks, and the rows it is answered. */
    async function shown(stored: Record<string, unknown>): Promise<{
      select: string[] | undefined;
      rows: Record<string, unknown>[];
    }> {
      const recent = getWidget("core/recent-entries")!;
      const query = applyWidgetSettings(
        recent.query as WidgetQuery,
        recent.settings,
        stored,
        ctx
      );
      const result = await executeWidgetQuery(
        validateWidgetQuery(query),
        caller
      );
      expect(result.op).toBe("list");
      return {
        select: query.select,
        rows: (result as { items: Record<string, unknown>[] }).items,
      };
    }

    beforeAll(async () => {
      handle = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: NOTES,
            fields: [
              text({ name: "title" }),
              text({ name: "topic" }),
              text({ name: "secret", access: { read: () => false } }),
            ],
          }),
        ],
      });
      // A reader the gate finds holding super-admin.
      caller = { user: { id: await superAdminUser(handle, "ref-reader") } };
      await handle.nextly.create({
        collection: NOTES,
        data: { title: "First", topic: "Plans", secret: "hidden" },
      });
      // What the query endpoint does before resolving any query: publish the
      // collection sources from the live registry, which boot does not do.
      await refreshCollectionSources();
      sources = publishableContentSources([NOTES]);
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

    it("never offers a field a read rule guards to choose", () => {
      const notes = sources.find(source => source.collection === NOTES);
      // The control: the collection is published, with its other fields.
      expect(notes?.fields.map(field => field.name)).toContain("topic");
      expect(notes?.fields.map(field => field.name)).not.toContain("secret");
    });

    it("asks and answers the fields its reader chose, after the title", async () => {
      const { select, rows } = await shown({
        collection: NOTES,
        fields: ["topic"],
      });
      expect(select).toEqual(["title", "topic"]);
      expect(rows[0]).toMatchObject({ title: "First", topic: "Plans" });
    });

    it("falls back to its own fields from a stored choice naming a guarded field", async () => {
      // 🔴 Applied as stored, the read would ask for `secret`.
      const { select, rows } = await shown({
        collection: NOTES,
        fields: ["topic", "secret"],
      });
      expect(select).not.toContain("secret");
      expect(select?.[0]).toBe("title");
      expect(rows[0]).not.toHaveProperty("secret");
    });

    it("answers without a guarded field even when a query asks for it by name", async () => {
      // The second line of defence: the read itself withholds the field, and the
      // answer describes no column for it.
      const result = await executeWidgetQuery(
        validateWidgetQuery({
          source: `collection:${NOTES}`,
          op: "list",
          select: ["title", "secret"],
        }),
        caller
      );
      const answer = result as {
        items: Record<string, unknown>[];
        fields?: { name: string }[];
      };
      expect(answer.items[0]).not.toHaveProperty("secret");
      expect(answer.fields?.map(field => field.name)).not.toContain("secret");
    });
  }
);
