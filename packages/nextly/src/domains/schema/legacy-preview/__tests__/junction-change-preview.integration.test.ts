/**
 * The Schema Builder's save preview of a relationship whose links move into or out of a link table.
 *
 * A many-to-many keeps its links in a table of its own (`usesJunctionTable`). Made a single link,
 * the save drops that table and every link in it, so the preview must call the change destructive,
 * count the links it drops, and say so. The other way, the save drops the single link's column and
 * makes a new, empty link table, so the links that column holds are lost too, and counted there.
 *
 * Every case goes through the dispatcher's preview action, the route the Builder calls.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { ServiceContainer } from "../../../../services";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

/** A many-to-many as the API stores it: `relationTo`, and its relation type in `options`. */
const TAGS = {
  name: "tags",
  type: "relationship",
  relationTo: "jc_tags",
  options: { target: "jc_tags", relationType: "manyToMany" },
};

/** The same field made a single link: no relation type, so no link table. */
const ONE_TAG = { name: "tags", type: "relationship", relationTo: "jc_tags" };

interface ChangedRow {
  name: string;
  reason: string;
  rowCount: number;
  classification: string;
}

interface Preview {
  hasDestructiveChanges: boolean;
  classification: string;
  changes: { changed: ChangedRow[]; unchanged: string[] };
  warnings: string[];
}

describeEachDialect(
  "the preview of a relationship moving into or out of its link table",
  dialect => {
    let t: TestNextly;
    let basePath: string;

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const query = <T>(sql: string): Promise<T[]> =>
      (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    const columnsOf = async (table: string): Promise<string[]> =>
      (
        await query<{ name: string }>(
          dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : dialect === "mysql"
              ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`
              : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' ORDER BY ordinal_position`
        )
      ).map(row => row.name);
    const moment =
      dialect === "mysql"
        ? "'2026-11-18 00:00:00'"
        : "'2026-11-18T00:00:00.000Z'";

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-junction-preview-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "jc_tags",
          label: "Tag",
          fields: [{ name: "label", type: "text" }],
        }
      );
      await query(
        `INSERT INTO ${q("dc_jc_tags")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("label")}) VALUES ('t1', 'News', 't1', 'News'), ('t2', 'Sport', 't2', 'Sport')`
      );
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    /** The preview the Builder is shown for saving `jc_posts` with `fields`. */
    async function previewOf(fields: unknown[]): Promise<Preview> {
      const answer = await dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "jc_posts" },
        { fields }
      );
      const body = (
        answer instanceof Response ? await answer.json() : answer
      ) as Preview & { data?: Preview };
      return body.data ?? body;
    }

    async function createPosts(field: Record<string, unknown>) {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: "jc_posts", label: "Post", fields: [field] }
      );
      await query(
        `INSERT INTO ${q("dc_jc_posts")} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('p1', 'Hello', 'p1')`
      );
    }

    // A group with no name only lays fields out: the many-to-many inside it is a field of the row,
    // and making it a single link drops its links as at the top.
    it("calls a many-to-many inside a group with no name made a single link destructive", async () => {
      const laidOut = (field: Record<string, unknown>) => ({
        type: "group",
        label: "Details",
        fields: [field],
      });
      await createPosts(laidOut(TAGS));

      const preview = await previewOf([laidOut(ONE_TAG)]);
      const report = JSON.stringify(preview, null, 2);
      expect(
        preview.changes.changed.find(row => row.name === "tags"),
        report
      ).toMatchObject({ classification: "destructive" });
      expect(preview.warnings.join(" "), report).toMatch(/tags/);
    });

    it("calls a many-to-many made a single link destructive, counting the links it drops", async () => {
      await createPosts(TAGS);
      // Two links in its link table, as the junction's own columns name them.
      const junction = new DynamicCollectionSchemaService(
        undefined,
        dialect as TestDialect
      ).junctionTableNameFor("dc_jc_posts", TAGS as FieldDefinition);
      const columns = await columnsOf(junction);
      for (const [id, tag] of [
        ["j1", "t1"],
        ["j2", "t2"],
      ]) {
        await query(
          `INSERT INTO ${q(junction)} (${columns.map(q).join(", ")}) VALUES (${columns
            .map(c =>
              c === "id"
                ? `'${id}'`
                : /source|post|parent/.test(c)
                  ? "'p1'"
                  : /target|tag|child|related/.test(c)
                    ? `'${tag}'`
                    : /order|position/.test(c)
                      ? "0"
                      : /created|updated/.test(c)
                        ? moment
                        : "NULL"
            )
            .join(", ")})`
        );
      }

      const preview = await previewOf([ONE_TAG]);
      const report = JSON.stringify(preview, null, 2);
      expect(
        preview.changes.changed.find(row => row.name === "tags"),
        report
      ).toMatchObject({
        reason: "relation_changed",
        rowCount: 2,
        classification: "destructive",
      });
      expect(preview.hasDestructiveChanges, report).toBe(true);
      expect(preview.classification, report).not.toBe("safe");
      expect(preview.warnings, report).toContain(
        "Changing 'tags' from many-to-many to a single link drops its link table and the 2 links it holds."
      );
    });

    // The save drops the single link's column and makes an empty link table, so the link the
    // post holds goes with the column.
    it("calls a single link made a many-to-many destructive, counting the links its column drops", async () => {
      await createPosts(ONE_TAG);
      await query(
        `UPDATE ${q("dc_jc_posts")} SET ${q("tags")} = 't1' WHERE ${q("id")} = 'p1'`
      );
      const preview = await previewOf([TAGS]);
      const report = JSON.stringify(preview, null, 2);
      expect(
        preview.changes.changed.find(row => row.name === "tags"),
        report
      ).toMatchObject({
        reason: "relation_changed",
        rowCount: 1,
        classification: "destructive",
      });
      expect(preview.hasDestructiveChanges, report).toBe(true);
      expect(preview.warnings, report).toContain(
        "Changing 'tags' from a single link to many-to-many drops the column holding its 1 links; its new link table starts empty."
      );
    });
  }
);
