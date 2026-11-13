/**
 * A write to a field group's row is traced to the document it sits in by
 * reading the row's parent, keyed by the table's own key. That key is found
 * on the runtime table on every dialect, whether the table declares it on the
 * column or, as SQLite's field-group table does, on the table.
 */
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../database/schema-registry";
import { FieldGroupSchemaService } from "../../../domains/field-groups/services/field-group-schema-service";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { contentTarget } from "../content-target";

const GROUP = "comp_ct_meta";

function groupTable(dialect: SupportedDialect): unknown {
  return new FieldGroupSchemaService(dialect).generateRuntimeSchema(
    GROUP,
    [{ name: "note", type: "text" }] as never,
    { typeColumn: STORAGE_FORMAT.columns.type }
  );
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "a field group's write is traced to its document (%s)",
  dialect => {
    it("reads the row's parent by the table's key", async () => {
      const runtime = groupTable(dialect);
      const conditions: SQL[] = [];
      const db = {
        select: () => ({
          from: (table: unknown) => {
            expect(table).toBe(runtime);
            return {
              where: (condition: SQL) => {
                conditions.push(condition);
                return {
                  limit: () =>
                    Promise.resolve([{ table: "dc_ct_posts", id: "post-1" }]),
                };
              },
            };
          },
        }),
      };

      const target = await contentTarget(GROUP, "row-1", {
        contentEntity: table =>
          table === GROUP
            ? { kind: "component", slug: "ct_meta" }
            : table === "dc_ct_posts"
              ? { kind: "collection", slug: "ct_posts" }
              : undefined,
        entityTable: table => (table === GROUP ? runtime : undefined),
        db: () => db,
      });

      expect(target).toEqual({
        kind: "collection",
        slug: "ct_posts",
        id: "post-1",
      });
      expect(conditions).toHaveLength(1);
    });
  }
);
