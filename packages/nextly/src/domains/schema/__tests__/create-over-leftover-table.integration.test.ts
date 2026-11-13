/**
 * A create is recorded applied only over a table that has the shape it asked for.
 *
 * A table standing under the create's name that nothing registered describes is never built over:
 * an empty one is replaced, so the table that ends up there holds exactly the requested columns;
 * one holding rows is refused, naming the table and how many rows it holds, and left as it was.
 * Two creates of one name at once leave one of them standing and refuse the other, naming it.
 *
 * Each leftover table is made by the creating SQL a Builder create renders, for other fields than
 * the create asks for, so it is the wreckage an interrupted earlier attempt would leave.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../field-groups/services/field-group-schema-service";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import { applyMigrationStatements } from "../services/apply-migration-statements";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** What a create raised, or undefined when it went through. */
async function refusalOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return error;
  }
}

const STALE = [{ name: "stale", type: "number" }];
const REQUESTED = [
  { name: "title", type: "text" },
  { name: "score", type: "number" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a create over a leftover table — ${dialect}`, () => {
    beforeEach(async () => {
      t = await createTestNextly({ dialect });
    });

    const app = () => t as TestNextly;

    async function liveColumns(table: string): Promise<string[]> {
      const snapshot = await introspectLiveColumns(
        app().adapter.getDrizzle(),
        dialect,
        [table]
      );
      return (snapshot.tables[0]?.columns ?? []).map(column => column.name);
    }

    async function rowCount(table: string): Promise<number> {
      const q = dialect === "mysql" ? "`" : '"';
      const [row] = await app().adapter.executeQuery<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM ${q}${table}${q}`
      );
      return Number(row?.n ?? 0);
    }

    /** A value a column of `type` accepts, for a row that only has to exist. */
    function valueFor(type: string): string {
      const t = type.toLowerCase();
      if (/bool/.test(t)) return dialect === "postgresql" ? "true" : "1";
      if (/int|numeric|decimal|real|double|float|serial/.test(t)) return "0";
      if (/timestamp|date|time/.test(t)) return "'2026-01-01 00:00:00'";
      if (/json/.test(t)) return "'[]'";
      return "'x'";
    }

    /**
     * Put `count` rows in a table, each giving every column it requires a value; `given` sets
     * some columns to values of its own (a component row's parent, say).
     */
    async function holdRows(
      table: string,
      count: number,
      given: Record<string, string> = {}
    ): Promise<void> {
      const q = dialect === "mysql" ? "`" : '"';
      const columns =
        (
          await introspectLiveColumns(app().adapter.getDrizzle(), dialect, [
            table,
          ])
        ).tables[0]?.columns ?? [];
      const required = columns.filter(
        column =>
          column.name === "id" ||
          (!column.nullable && column.default === undefined)
      );
      for (let i = 0; i < count; i++) {
        const values = required.map(column =>
          column.name === "id"
            ? `'leftover-${i}'`
            : column.name in given
              ? `'${given[column.name]}'`
              : valueFor(column.type)
        );
        await app().adapter.executeQuery(
          `INSERT INTO ${q}${table}${q} (${required.map(c => `${q}${c.name}${q}`).join(", ")}) VALUES (${values.join(", ")})`
        );
      }
    }

    /** The table a field-group create for other fields leaves behind. */
    async function leftoverFieldGroupTable(table: string): Promise<void> {
      await applyMigrationStatements(
        app().adapter,
        new FieldGroupSchemaService(dialect).generateMigrationSQL(
          table,
          STALE as never
        )
      );
    }

    /** The table a Single create for other fields leaves behind. */
    async function leftoverSingleTable(table: string): Promise<void> {
      await applyMigrationStatements(
        app().adapter,
        new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateMigrationSQL(table, STALE as never, { hasStatus: false })
      );
    }

    const createFieldGroup = (slug: string) =>
      dispatchComponents(
        "createComponent",
        {},
        { slug, label: slug, fields: REQUESTED }
      );
    const createSingle = (slug: string) =>
      dispatchSingles(
        "createSingle",
        {},
        { slug, label: slug, fields: REQUESTED }
      );

    it("replaces an empty leftover field-group table with the requested columns", async () => {
      await leftoverFieldGroupTable("comp_lfempty");

      await createFieldGroup("lfempty");

      const columns = await liveColumns("comp_lfempty");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
      expect(columns).not.toContain("stale");
      const stored = await app()
        .getService("fieldGroupRegistryService")
        .getComponentBySlug("lfempty");
      expect(stored?.migrationStatus).toBe("applied");
    });

    it("refuses a field-group create over a leftover holding rows, naming it and its row count", async () => {
      await leftoverFieldGroupTable("comp_lfheld");
      await holdRows("comp_lfheld", 2);

      const refused = await refusalOf(createFieldGroup("lfheld"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"comp_lfheld" (2 rows)'),
      });
      expect(await rowCount("comp_lfheld")).toBe(2);
      expect(await liveColumns("comp_lfheld")).toContain("stale");
      expect(
        await app()
          .getService("fieldGroupRegistryService")
          .getComponentBySlug("lfheld")
      ).toBeNull();
    });

    it("replaces an empty leftover Single table with the requested columns", async () => {
      await leftoverSingleTable("single_lsempty");

      await createSingle("lsempty");

      const columns = await liveColumns("single_lsempty");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
      expect(columns).not.toContain("stale");
    });

    it("refuses a Single create over a leftover holding rows, naming it and its row count", async () => {
      await leftoverSingleTable("single_lsheld");
      await holdRows("single_lsheld", 1);

      const refused = await refusalOf(createSingle("lsheld"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"single_lsheld" (1 row)'),
      });
      expect(await rowCount("single_lsheld")).toBe(1);
    });

    // Two creates of one name at once: the schema lock lets one in and refuses the other until it
    // is done, and a create of a name already taken is refused by name, lock or no lock.
    // A Single's field-group rows live in the shared field-group tables, naming its table as their
    // parent: a leftover whose content is there is not wreckage, however empty its own table.
    it("refuses a Single create over an empty leftover whose field-group rows name it, deleting nothing", async () => {
      await leftoverSingleTable("single_lsfg");
      await createFieldGroup("lsfgchip");
      await holdRows("comp_lsfgchip", 1, { _parent_table: "single_lsfg" });

      const refused = await refusalOf(createSingle("lsfg"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"comp_lsfgchip" (1 row)'),
      });
      expect(await rowCount("comp_lsfgchip")).toBe(1);
      expect(await liveColumns("single_lsfg")).toContain("stale");
    });

    it("lets one of two field-group creates of one name at once stand, and refuses the other", async () => {
      const outcomes = await Promise.allSettled([
        createFieldGroup("lftwice"),
        createFieldGroup("lftwice"),
      ]);

      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(o => o.status === "rejected")).toHaveLength(1);
      const columns = await liveColumns("comp_lftwice");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
    });

    it("refuses a field-group create of a name already created, naming it", async () => {
      await createFieldGroup("lfagain");

      const refused = await refusalOf(createFieldGroup("lfagain"));

      expect(refused).toMatchObject({
        publicMessage: expect.stringContaining('"lfagain"'),
      });
    });
  });
}
