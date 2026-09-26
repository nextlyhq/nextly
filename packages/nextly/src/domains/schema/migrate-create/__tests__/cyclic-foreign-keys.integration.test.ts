/**
 * A plugin migration that creates two tables referencing each other, run on
 * a real server.
 *
 * A cycle is the one case the diff's dependency order cannot settle: one of
 * the two tables is created while the other does not exist yet. PostgreSQL and
 * MySQL refuse a key to a missing table, so the generated file has to add that
 * key after both tables exist — and its down migration has to take it away
 * before either table goes. Asked of the database, by running the file, since
 * the statements look plausible either way.
 */
import { afterEach, expect, it } from "vitest";

import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { SupportedDialect } from "../../../../database/schema-registry";
import type { ForeignKeySpec, TableSpec } from "../../pipeline/diff/types";
import { buildPluginMigration } from "../generate-plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function key(from: string, column: string, to: string): ForeignKeySpec {
  return {
    name: `fk_${from}_${column}`,
    columns: [column],
    referencesTable: to,
    referencesColumns: ["id"],
    onDelete: "no action",
    onUpdate: "no action",
  };
}

// `cyc_team.captain_id` → `cyc_member`, `cyc_member.team_id` → `cyc_team`.
function cycle(): TableSpec[] {
  const id = {
    name: "id",
    type: "varchar(36)",
    nullable: false,
    primaryKey: true,
  };
  return [
    {
      name: "cyc_member",
      columns: [id, { name: "team_id", type: "varchar(36)", nullable: true }],
      indexes: [],
      foreignKeys: [key("cyc_member", "team_id", "cyc_team")],
    },
    {
      name: "cyc_team",
      columns: [
        id,
        { name: "captain_id", type: "varchar(36)", nullable: true },
      ],
      indexes: [],
      foreignKeys: [key("cyc_team", "captain_id", "cyc_member")],
    },
  ];
}

describeEachDialect(
  "a generated migration creating a foreign-key cycle",
  dialect => {
    it("runs up, enforces both keys, and runs down", async () => {
      current = await createTestNextly({ dialect });
      const adapter = current.adapter;
      const tables = cycle();
      const built = buildPluginMigration({
        pluginName: "cycle-fixture",
        schemaVersion: 1,
        name: "init",
        now: new Date("2026-09-26T00:00:00Z"),
        existing: [],
        tablesByDialect: {
          postgresql: tables,
          mysql: tables,
          sqlite: tables,
        } as Record<SupportedDialect, TableSpec[]>,
      });
      expect(built).not.toBeNull();
      const { up, down } = built!.module.dialects[dialect];

      for (const statement of up) await adapter.executeQuery(statement);
      await adapter.executeQuery(`INSERT INTO cyc_team (id) VALUES ('t1')`);
      await adapter.executeQuery(
        `INSERT INTO cyc_member (id, team_id) VALUES ('m1', 't1')`
      );
      // Both keys hold: a dangling reference is refused in either direction.
      await expect(
        adapter.executeQuery(
          `INSERT INTO cyc_member (id, team_id) VALUES ('m2', 'missing')`
        )
      ).rejects.toThrow();
      await expect(
        adapter.executeQuery(
          `INSERT INTO cyc_team (id, captain_id) VALUES ('t2', 'missing')`
        )
      ).rejects.toThrow();

      await adapter.executeQuery(`DELETE FROM cyc_member`);
      await adapter.executeQuery(`DELETE FROM cyc_team`);
      for (const statement of down) await adapter.executeQuery(statement);
      expect(await adapter.tableExists("cyc_member")).toBe(false);
      expect(await adapter.tableExists("cyc_team")).toBe(false);
    });
  }
);

describeEachDialect(
  "a generated migration dropping a foreign-key cycle",
  dialect => {
    it("runs up and down, restoring both keys", async () => {
      current = await createTestNextly({ dialect });
      const adapter = current.adapter;
      const tables = cycle();
      const all = {
        postgresql: tables,
        mysql: tables,
        sqlite: tables,
      } as Record<SupportedDialect, TableSpec[]>;
      const none = { postgresql: [], mysql: [], sqlite: [] } as Record<
        SupportedDialect,
        TableSpec[]
      >;
      const first = buildPluginMigration({
        pluginName: "cycle-fixture",
        schemaVersion: 1,
        name: "init",
        now: new Date("2026-09-26T00:00:00Z"),
        existing: [],
        tablesByDialect: all,
      })!.module;
      const second = buildPluginMigration({
        pluginName: "cycle-fixture",
        schemaVersion: 2,
        name: "drop",
        now: new Date("2026-09-26T00:01:00Z"),
        existing: [first],
        tablesByDialect: none,
      });
      expect(second).not.toBeNull();

      for (const statement of first.dialects[dialect].up) {
        await adapter.executeQuery(statement);
      }
      const { up, down } = second!.module.dialects[dialect];
      // Dropping both tables while each references the other.
      for (const statement of up) await adapter.executeQuery(statement);
      expect(await adapter.tableExists("cyc_member")).toBe(false);
      expect(await adapter.tableExists("cyc_team")).toBe(false);

      // And back: both tables return with both keys enforced.
      for (const statement of down) await adapter.executeQuery(statement);
      await adapter.executeQuery(`INSERT INTO cyc_team (id) VALUES ('t1')`);
      await expect(
        adapter.executeQuery(
          `INSERT INTO cyc_member (id, team_id) VALUES ('m2', 'missing')`
        )
      ).rejects.toThrow();
      await expect(
        adapter.executeQuery(
          `INSERT INTO cyc_team (id, captain_id) VALUES ('t2', 'missing')`
        )
      ).rejects.toThrow();
    });
  }
);
