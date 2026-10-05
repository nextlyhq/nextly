/**
 * A plugin module's DOWN runs as one statement per driver call.
 *
 * A module's `down` entries are per-operation renderings, and `generateSQL`
 * does not promise one statement per operation: a foreign-key action change is
 * a drop and an add in one entry, and PostgreSQL's drop of a unique index drops
 * its constraint too. On MySQL the connection runs with `multipleStatements`
 * off, so such an entry must reach the driver as separate statements, or it is
 * refused whole and the module stays applied.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import type {
  ChangeForeignKeyActionOp,
  TableSpec,
} from "../../../domains/schema/pipeline/diff/types";
import { generateSQL } from "../../../domains/schema/pipeline/sql-templates/index";
import { pluginModuleDownStatements } from "../plugin-lifecycle-runner";

/** No `;` outside a trailing terminator: one statement, as a driver takes it. */
function isSingleStatement(statement: string): boolean {
  return !statement.trim().replace(/;$/, "").includes(";");
}

describe("pluginModuleDownStatements", () => {
  it("splits a foreign-key action change into its drop and its add on mysql", () => {
    // The entry is rendered by the real renderer for the operation, which is
    // what a module's DOWN holds for it.
    const op: ChangeForeignKeyActionOp = {
      type: "change_foreign_key_action",
      tableName: "fx__posts",
      constraintName: "fk_fx__posts_author_id",
      columnName: "author_id",
      referencesTable: "fx__authors",
      referencesColumn: "id",
      fromOnDelete: "RESTRICT",
      fromOnUpdate: "NO ACTION",
      toOnDelete: "CASCADE",
      toOnUpdate: "NO ACTION",
    };
    const entry = generateSQL(op, "mysql");
    // The precondition: the rendering is ONE entry holding two statements.
    // Without it this test would pass on the unsplit entries too.
    expect(isSingleStatement(entry)).toBe(false);
    const down = [entry];
    const module = {
      dialects: {
        postgresql: { up: [], down: [] },
        mysql: { up: [], down },
        sqlite: { up: [], down: [] },
      },
    };

    const statements = pluginModuleDownStatements(module, "mysql");

    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/DROP FOREIGN KEY `fk_fx__posts_author_id`/);
    expect(statements[1]).toMatch(/ADD CONSTRAINT .*ON DELETE CASCADE/);
    expect(statements.every(isSingleStatement)).toBe(true);
  });

  it("splits the compound DOWN the generator writes for an added unique index", () => {
    // Generated, not hand-written: v2 adds a unique index, so its DOWN drops
    // it, which PostgreSQL renders as a constraint drop and an index drop in
    // one entry.
    const table = (unique: boolean): TableSpec => ({
      name: "fx__notes",
      columns: [
        { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
        { name: "label", type: "varchar(255)", nullable: false },
      ],
      indexes: unique
        ? [{ name: "uq_fx__notes_label", columns: ["label"], unique: true }]
        : [],
    });
    const byDialect = (spec: TableSpec) =>
      ({ postgresql: [spec], mysql: [spec], sqlite: [spec] }) as Record<
        SupportedDialect,
        TableSpec[]
      >;
    const first = buildPluginMigration({
      pluginName: "fx",
      schemaVersion: 1,
      name: "init",
      now: new Date(Date.UTC(2026, 8, 1)),
      tablesByDialect: byDialect(table(false)),
      existing: [],
    })!.module;
    const second = buildPluginMigration({
      pluginName: "fx",
      schemaVersion: 2,
      name: "unique_label",
      now: new Date(Date.UTC(2026, 8, 2)),
      tablesByDialect: byDialect(table(true)),
      existing: [first],
    })!.module;
    const down = second.dialects.postgresql.down;
    expect(down).toHaveLength(1);
    expect(isSingleStatement(down[0])).toBe(false);

    const statements = pluginModuleDownStatements(second, "postgresql");

    expect(statements).toHaveLength(2);
    expect(statements.every(isSingleStatement)).toBe(true);
    expect(statements.join("\n")).toMatch(/DROP CONSTRAINT IF EXISTS/);
    expect(statements.join("\n")).toMatch(/DROP INDEX/);
  });

  it("leaves entries that are already single statements as they are", () => {
    // The control: splitting is not rewriting.
    const down = [
      "ALTER TABLE `fx__notes` DROP COLUMN `score`",
      "DROP TABLE IF EXISTS `fx__tags`",
    ];
    const module = {
      dialects: {
        postgresql: { up: [], down: [] },
        mysql: { up: [], down },
        sqlite: { up: [], down: [] },
      },
    };
    expect(
      pluginModuleDownStatements(module, "mysql").map(s => s.replace(/;$/, ""))
    ).toEqual(down);
  });

  it("keeps a statement whatever keyword it starts with", () => {
    // A hand-written DOWN may clean up through a procedure or a session
    // setting; none of them may be dropped for not being DDL.
    const down = [
      "CALL fx_cleanup_notes()",
      "SET @fx_uninstalling = 1",
      "DROP TABLE IF EXISTS `fx__notes`",
    ];
    const module = {
      dialects: {
        postgresql: { up: [], down: [] },
        mysql: { up: [], down },
        sqlite: { up: [], down: [] },
      },
    };
    expect(
      pluginModuleDownStatements(module, "mysql").map(s => s.replace(/;$/, ""))
    ).toEqual(down);
  });
});
