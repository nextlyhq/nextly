/**
 * What a module does beyond what its schema snapshot shows, which decides
 * whether it may be recorded as applied without running.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../../database/schema-registry";
import type { TableSpec } from "../../../pipeline/diff/types";
import { sqliteTableRebuildStatements } from "../../../pipeline/sql-templates/sqlite-rebuild";
import { moduleEffects } from "../module-effects";

const THINGS: TableSpec = {
  name: "p__things",
  columns: [
    { name: "id", type: "text", nullable: false, primaryKey: true },
    { name: "label", type: "text", nullable: false },
  ],
  indexes: [],
};

/**
 * A module whose UP on `dialect` is `up`, standing at `tables` after and at
 * `start` before.
 */
function module(
  up: string[],
  tables: TableSpec[] = [THINGS],
  dialect: SupportedDialect = "postgresql",
  start: TableSpec[] = []
) {
  const none = { up: [], down: [] };
  const empty = { tables: [] };
  return {
    dialects: {
      postgresql: none,
      mysql: none,
      sqlite: none,
      [dialect]: { up, down: [] },
    },
    snapshot: {
      postgresql: empty,
      mysql: empty,
      sqlite: empty,
      [dialect]: { tables },
    },
    before: {
      postgresql: empty,
      mysql: empty,
      sqlite: empty,
      [dialect]: { tables: start },
    },
  };
}

describe("moduleEffects", () => {
  it("reads table and index DDL as schema", () => {
    expect(
      moduleEffects(
        module([
          'CREATE TABLE "p__things" ("id" text PRIMARY KEY, "label" text NOT NULL)',
          'CREATE UNIQUE INDEX "uq_p__things_label" ON "p__things" ("label")',
          'ALTER TABLE "p__things" ADD COLUMN "score" integer',
          'DROP INDEX IF EXISTS "idx_old"',
          'DROP TABLE "p__old"',
        ]),
        "postgresql"
      )
    ).toBe("schema");
    // Nothing to run at all: a module of comments.
    expect(moduleEffects(module(["-- nothing"]), "postgresql")).toBe("schema");
  });

  it("reads a generated SQLite rebuild as schema, its copies included", () => {
    // The guard and the `__new_` copy are written into and gone by the end.
    const rebuild = sqliteTableRebuildStatements(THINGS);
    expect(rebuild.some(statement => statement.startsWith("INSERT"))).toBe(
      true
    );
    expect(moduleEffects(module(rebuild, [THINGS], "sqlite"), "sqlite")).toBe(
      "schema"
    );
  });

  it.each([
    'INSERT INTO "p__things" ("id", "label") VALUES (\'a\', \'A\')',
    "UPDATE p__things SET label = upper(label)",
    "DELETE FROM p__things WHERE label = ''",
    "CREATE TRIGGER p__things_touch AFTER UPDATE ON p__things FOR EACH ROW EXECUTE FUNCTION touch()",
    "SELECT setval('p__seq', 10)",
  ])("reads a module of only other work as data: %s", statement => {
    expect(moduleEffects(module([statement]), "postgresql")).toBe("data");
  });

  it("reads schema with other work as mixed, a seed of its own new table included", () => {
    // The seeded table outlives the module, so its rows are an effect the
    // snapshot does not show: adopting this module would leave it empty.
    expect(
      moduleEffects(
        module([
          'CREATE TABLE "p__things" ("id" text PRIMARY KEY, "label" text NOT NULL)',
          'INSERT INTO "p__things" ("id", "label") VALUES (\'a\', \'A\')',
        ]),
        "postgresql"
      )
    ).toBe("mixed");
    expect(
      moduleEffects(
        module([
          'ALTER TABLE "p__things" ADD COLUMN "score" integer',
          'UPDATE "p__things" SET "score" = 0',
        ]),
        "postgresql"
      )
    ).toBe("mixed");
  });

  it("reads a seeded table the module leaves standing as mixed, though its target lacks it", async () => {
    const seeded = [
      'CREATE TABLE "p__things" ("id" text PRIMARY KEY, "label" text NOT NULL)',
      'CREATE TABLE "p__audit" ("id" text PRIMARY KEY)',
      'INSERT INTO "p__audit" ("id") VALUES (\'a\')',
    ];
    expect(moduleEffects(module(seeded), "postgresql")).toBe("mixed");
    // The control: the same table dropped by a later statement is scaffolding.
    expect(
      moduleEffects(module([...seeded, 'DROP TABLE "p__audit"']), "postgresql")
    ).toBe("schema");
  });

  it("reads a module whose snapshot does not move as data, its DDL included", () => {
    // A `--blank` module: dev push builds the snapshot, which has no partial
    // index to build, so standing past it proves nothing about this one.
    const partial = module(
      [
        'CREATE INDEX "idx_p__things_part" ON "p__things" ("id") WHERE "id" IS NOT NULL',
      ],
      [THINGS],
      "postgresql",
      [THINGS]
    );
    expect(moduleEffects(partial, "postgresql")).toBe("data");
    // Nothing to run at all stays adoptable.
    expect(
      moduleEffects(
        module(["-- nothing"], [THINGS], "postgresql", [THINGS]),
        "postgresql"
      )
    ).toBe("schema");
  });

  it("counts transaction-scoped settings and savepoints as neither", () => {
    expect(
      moduleEffects(
        module([
          "SET LOCAL lock_timeout = '5s'",
          'ALTER TABLE "p__things" ADD COLUMN "score" integer',
        ]),
        "postgresql"
      )
    ).toBe("schema");
    expect(
      moduleEffects(
        module([
          "SAVEPOINT s",
          "UPDATE p__things SET label = 'x'",
          "RELEASE s",
        ]),
        "postgresql"
      )
    ).toBe("data");
  });
});
