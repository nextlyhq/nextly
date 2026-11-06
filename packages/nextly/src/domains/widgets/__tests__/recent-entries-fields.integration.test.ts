/**
 * A Recent entries card shows the fields its reader chose, on every configured
 * dialect, and never a field a read rule guards: such a field is never offered
 * to choose, a stored choice naming it falls back to the card's own fields, and
 * a read that asks for it anyway answers without it.
 *
 * The declaration is core's, its `load` run as the reader: the reader's
 * sources are what the workspace payload publishes them
 * (`publishableContentSources`), the settings become the query through
 * `applyWidgetSettings`, the one path the admin's own cards take too, and the
 * query runs against real rows as the reader.
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
import { recentEntriesWidget } from "../core-widgets/recent-entries";
import { executeWidgetQuery } from "../execute";
import {
  publishableContentSources,
  type PublishedContentSource,
} from "../publish";
import { validateWidgetQuery, type WidgetQuery } from "../query";

import { loadCard } from "./core-card-load";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "ref_notes";

describe.each(getConfiguredTestDialects())(
  "a Recent entries card's Fields (%s)",
  dialect => {
    let handle: TestNextly;
    let caller: ReadCaller;
    let sources: PublishedContentSource[];

    /** What a Recent entries card with `stored` asks, and the rows it is answered. */
    async function shown(stored: Record<string, unknown>): Promise<{
      select: string[] | undefined;
      rows: readonly Record<string, unknown>[];
    }> {
      const asked: WidgetQuery[] = [];
      const answer = await loadCard(recentEntriesWidget, stored, caller, {
        asked: query => asked.push(query),
      });
      // The one list it reads (beside the check `describe` makes): the
      // select it ASKED, not the columns the read answered, which leave a
      // guarded field out whatever is asked.
      const lists = asked.filter(query => query.op === "list");
      expect(lists).toHaveLength(1);
      return { select: lists[0]?.select, rows: answer.rows };
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
