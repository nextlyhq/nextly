/**
 * A MySQL migration file that changes the type of a column a foreign key
 * covers has to lift the key around the change, as dev push does — MySQL
 * refuses the change while the key is in place (errors 1832/1833/3780).
 *
 * Asserted on the generated file's ORDER, in both directions: the drop must
 * precede the type change and the restore follow it, in the UP and the DOWN.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { clearActiveExtensionSchema } from "../../extension/active-schema";
import { col, defineTable } from "../../extension/dsl";
import type {
  ForeignKeySpec,
  Operation,
  TableSpec,
} from "../../pipeline/diff/types";
import { withForeignKeysLiftedForTypeChanges } from "../../pipeline/foreign-key-lift";
import { compileAppStreamTables } from "../app-stream";
import { generateMigration } from "../generate";

const logger = { warn: () => {} };

/** An app table referencing another, with the reference column's kind given. */
function tables(wide: boolean) {
  const parent = defineTable("parent", { id: col.serial() });
  const child = defineTable(
    "child",
    {
      id: col.serial(),
      parentId: wide ? col.bigint() : col.integer(),
    },
    {
      foreignKeys: [
        {
          columns: ["parentId"],
          references: { table: "parent", columns: ["id"] },
        },
      ],
    }
  );
  return {
    db: {
      schema: {
        extend: [
          ({ schema }: { schema: { addTable(d: unknown): void } }) => {
            schema.addTable(parent);
            schema.addTable(child);
          },
        ],
      },
    },
  };
}

let migrationsDir: string;
let clock = 0;

async function generate(wide: boolean, dialect: SupportedDialect) {
  clock += 1;
  const result = await generateMigration({
    name: `step_${String(clock)}`,
    dialect,
    migrationsDir,
    collections: [],
    singles: [],
    components: [],
    appStream: await compileAppStreamTables({
      config: tables(wide) as never,
      dialect,
      logger,
    }),
    nonInteractive: true,
    now: new Date(Date.UTC(2026, 8, 25, 10, clock)),
  });
  const [up, down] = (await readFile(result!.sqlPath, "utf-8")).split(
    "-- DOWN"
  );
  return { up, down };
}

/** Where each of the three statements sits, in one direction of the file. */
function positions(sql: string) {
  return {
    drop: sql.search(/DROP FOREIGN KEY `fk_child_parent_id`/),
    change: sql.search(/MODIFY[^;]*`parent_id`/),
    add: sql.search(/ADD CONSTRAINT `fk_child_parent_id` FOREIGN KEY/),
  };
}

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-fk-lift-"));
});

afterEach(() => clearActiveExtensionSchema());

describe("a MySQL migration retyping a column a foreign key covers", () => {
  it("drops the key before the change and restores it after, up and down", async () => {
    await generate(false, "mysql");
    const { up, down } = await generate(true, "mysql");
    for (const sql of [up, down]) {
      const at = positions(sql);
      expect(at.drop).toBeGreaterThanOrEqual(0);
      expect(at.change).toBeGreaterThan(at.drop);
      expect(at.add).toBeGreaterThan(at.change);
    }
  });

  it("leaves PostgreSQL's file alone, which changes the type in place", async () => {
    await generate(false, "postgresql");
    const { up } = await generate(true, "postgresql");
    expect(up).not.toMatch(/DROP CONSTRAINT[^;]*fk_child_parent_id/);
  });
});

describe("a key lifted around a type change the same operations rename", () => {
  const key: ForeignKeySpec = {
    name: "fk_child_parent_id",
    columns: ["parent_id"],
    referencesTable: "parent",
    referencesColumns: ["id"],
    onDelete: "no action",
    onUpdate: "no action",
  };
  const before: TableSpec[] = [
    {
      name: "child",
      columns: [{ name: "parent_id", type: "int", nullable: true }],
      foreignKeys: [key],
    },
  ];

  it("is found through the rename, dropped under its old names and restored under its new ones", () => {
    const ops: Operation[] = [
      {
        type: "rename_column",
        tableName: "child",
        fromColumn: "parent_id",
        toColumn: "owner_id",
        fromType: "int",
        toType: "int",
      },
      {
        type: "change_column_type",
        tableName: "child",
        columnName: "owner_id",
        fromType: "int",
        toType: "bigint",
      },
    ];
    const lifted = withForeignKeysLiftedForTypeChanges(ops, before, "mysql");
    expect(lifted[0]).toEqual({
      type: "drop_foreign_key",
      tableName: "child",
      foreignKey: key,
    });
    expect(lifted.at(-1)).toEqual({
      type: "add_foreign_key",
      tableName: "child",
      foreignKey: { ...key, columns: ["owner_id"] },
    });
  });

  it("treats a rename that changes the type as a type change", () => {
    const lifted = withForeignKeysLiftedForTypeChanges(
      [
        {
          type: "rename_column",
          tableName: "child",
          fromColumn: "parent_id",
          toColumn: "owner_id",
          fromType: "int",
          toType: "bigint",
        },
      ],
      before,
      "mysql"
    );
    expect(lifted.map(op => op.type)).toEqual([
      "drop_foreign_key",
      "rename_column",
      "add_foreign_key",
    ]);
  });
});
