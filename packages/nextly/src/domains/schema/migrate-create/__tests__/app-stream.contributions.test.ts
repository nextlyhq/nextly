/**
 * Every element a contribution adds has to reach the migration stream that
 * carries it — once, under the name the table's spec gives it.
 *
 * The property asserted throughout is CONVERGENCE: the first generation emits
 * the element and the second emits nothing. An element recorded under a name
 * the spec does not use, or not recorded at all, fails the second half — the
 * generator re-adds it on every run, and MySQL refuses the duplicate key.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { runChecks } from "../../../../cli/commands/migrate-check";
import { definePlugin } from "../../../../plugins/plugin-context";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../utils/resolve-table-name";
import { clearActiveExtensionSchema } from "../../extension/active-schema";
import { col, defineTable } from "../../extension/dsl";
import { compileAppStreamTables } from "../app-stream";
import { buildDesiredSnapshotFromConfig, generateMigration } from "../generate";
import { loadLatestSnapshot } from "../snapshot-io";

const logger = { warn: () => {} };

const plugin = definePlugin({
  name: "fx",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    schema: {
      prefix: "fx",
      tables: [defineTable("notes", { id: col.id(), title: col.shortText() })],
    },
  },
});

type Hook = (args: {
  schema: { extendTable(name: string, input: Record<string, unknown>): void };
}) => void;

function config(extend: Hook[]): Record<string, unknown> {
  return { plugins: [plugin], db: { schema: { extend } } };
}

let migrationsDir: string;
let clock = 0;

async function generate(
  cfg: Record<string, unknown>,
  dialect: SupportedDialect = "postgresql"
) {
  clock += 1;
  return generateMigration({
    name: `step_${String(clock)}`,
    dialect,
    migrationsDir,
    collections: [],
    singles: [],
    components: [],
    appStream: await compileAppStreamTables({
      config: cfg as never,
      dialect,
      logger,
    }),
    nonInteractive: true,
    now: new Date(Date.UTC(2026, 8, 25, 10, clock)),
  });
}

const upOf = async (path: string) =>
  (await readFile(path, "utf-8")).split("-- DOWN")[0];

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-contrib-"));
});

afterEach(() => {
  clearActiveExtensionSchema();
});

describe("an unnamed index the app contributes to a plugin's table", () => {
  const uniqueIndex: Hook = ({ schema }) => {
    schema.extendTable("fx__notes", {
      columns: { appRef: col.shortText({ nullable: true }) },
      indexes: [{ columns: ["app_ref"], unique: true }],
    });
  };

  it("is recorded under the name the spec gives it, so it is emitted once", async () => {
    const first = await generate(config([uniqueIndex]));
    expect(await upOf(first!.sqlPath)).toMatch(/uq_fx__notes_app_ref/);
    const latest = await loadLatestSnapshot(join(migrationsDir, "meta"));
    expect(latest?.data.contributions?.fx__notes?.indexes).toEqual([
      "uq_fx__notes_app_ref",
    ]);

    // Nothing changed, so nothing is owed.
    expect(await generate(config([uniqueIndex]))).toBeNull();
  });

  it("is dropped when the app withdraws it", async () => {
    await generate(config([uniqueIndex]));
    const withdrawn = await generate(config([]));
    expect(await upOf(withdrawn!.sqlPath)).toMatch(
      /DROP INDEX[^;]*uq_fx__notes_app_ref/
    );
  });
});

describe("an enum column the app contributes to a plugin's table", () => {
  const enumColumn: Hook = ({ schema }) => {
    schema.extendTable("fx__notes", {
      columns: { appState: col.enum(["open", "done"], { nullable: true }) },
    });
  };

  it("carries its CHECK in the app's stream, once", async () => {
    const first = await generate(config([enumColumn]));
    const up = await upOf(first!.sqlPath);
    expect(up).toMatch(/ADD COLUMN "app_state"/);
    expect(up).toMatch(/ADD CONSTRAINT "ck_fx__notes_app_state_enum"/);
    const latest = await loadLatestSnapshot(join(migrationsDir, "meta"));
    expect(latest?.data.contributions?.fx__notes?.checks).toEqual([
      "ck_fx__notes_app_state_enum",
    ]);

    expect(await generate(config([enumColumn]))).toBeNull();
  });

  it("drops its CHECK with it when withdrawn", async () => {
    await generate(config([enumColumn]));
    const withdrawn = await generate(config([]));
    const up = await upOf(withdrawn!.sqlPath);
    expect(up).toMatch(
      /DROP CONSTRAINT (IF EXISTS )?"ck_fx__notes_app_state_enum"/
    );
    expect(up).toMatch(/DROP COLUMN "app_state"/);
  });
});

describe("what a hook contributes to the app's ENTITY tables", () => {
  const POSTS = resolveCollectionTableName("posts");
  const SITE = resolveSingleTableName({ slug: "site" });
  const HERO = resolveComponentTableName("hero");
  const TABLES = [POSTS, SITE, HERO];

  /** A column with a default, an enum column and an index, on every entity kind. */
  const contributes: Hook = ({ schema }) => {
    for (const table of TABLES) {
      schema.extendTable(table, {
        columns: {
          reviewNote: col.shortText({ default: "none" }),
          reviewState: col.enum(["open", "done"], { nullable: true }),
        },
        indexes: [{ columns: ["reviewNote"] }],
      });
    }
  };

  const entityConfig = (extend: Hook[]) => ({
    collections: [{ slug: "posts", fields: [{ name: "body", type: "text" }] }],
    singles: [{ slug: "site", fields: [{ name: "motto", type: "text" }] }],
    fieldGroups: [
      { slug: "hero", fields: [{ name: "caption", type: "text" }] },
    ],
    db: { schema: { extend } },
  });

  const entities = {
    collections: [
      {
        slug: "posts",
        tableName: POSTS,
        fields: [{ name: "body", type: "text" }],
      },
    ],
    singles: [
      {
        slug: "site",
        tableName: SITE,
        fields: [{ name: "motto", type: "text" }],
      },
    ],
    components: [
      {
        slug: "hero",
        tableName: HERO,
        fields: [{ name: "caption", type: "text" }],
      },
    ],
  };

  async function generateEntities(extend: Hook[]) {
    clock += 1;
    return generateMigration({
      name: `entities_${String(clock)}`,
      dialect: "postgresql",
      migrationsDir,
      ...entities,
      appStream: await compileAppStreamTables({
        config: entityConfig(extend) as never,
        dialect: "postgresql",
        logger,
      }),
      nonInteractive: true,
      now: new Date(Date.UTC(2026, 8, 25, 10, clock)),
    });
  }

  /** migrate:check's verdict on the migrations directory, as its error lines. */
  async function check(extend: Hook[]): Promise<string[]> {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    try {
      await runChecks({
        migrationsDir,
        desiredSnapshot: buildDesiredSnapshotFromConfig(
          entities.collections,
          entities.singles,
          entities.components,
          "postgresql"
        ),
        appStream: await compileAppStreamTables({
          config: entityConfig(extend) as never,
          dialect: "postgresql",
          logger,
        }),
        logger: {
          error: (m: string) => errors.push(m),
          success: () => {},
          info: () => {},
          warn: () => {},
          debug: () => {},
        } as never,
      });
    } finally {
      exit.mockRestore();
    }
    return errors;
  }

  it("reach migrate:create on a collection, a Single and a component", async () => {
    await generateEntities([]);
    const result = await generateEntities([contributes]);
    const up = await upOf(result!.sqlPath);
    for (const table of TABLES) {
      expect(up).toContain(
        `ALTER TABLE "${table}" ADD COLUMN "review_note" varchar(255) NOT NULL DEFAULT 'none'`
      );
      expect(up).toContain(`ALTER TABLE "${table}" ADD COLUMN "review_state"`);
      expect(up).toMatch(
        new RegExp(`CREATE INDEX[^;]*"idx_${table}_review_note"`)
      );
      expect(up).toContain(`"ck_${table}_review_state_enum"`);
    }
  });

  it("are pending for migrate:check until generated, and then settled", async () => {
    await generateEntities([]);
    expect((await check([contributes])).join("\n")).toMatch(/SCHEMA_DRIFT/);
    await generateEntities([contributes]);
    expect(await check([contributes])).toEqual([]);
    // And a second generation owes nothing.
    expect(await generateEntities([contributes])).toBeNull();
  });

  it("are dropped, check first, when withdrawn", async () => {
    await generateEntities([]);
    await generateEntities([contributes]);
    const withdrawn = await generateEntities([]);
    const up = await upOf(withdrawn!.sqlPath);
    for (const table of TABLES) {
      expect(up).toMatch(
        new RegExp(
          `DROP CONSTRAINT (IF EXISTS )?"ck_${table}_review_state_enum"[\\s\\S]*DROP COLUMN "review_state"`
        )
      );
    }
  });
});

describe("what a hook contributes to an extendable CORE table", () => {
  const onUsers: Hook = ({ schema }) => {
    schema.extendTable("users", {
      columns: { nickname: col.shortText({ nullable: true }) },
      indexes: [{ columns: ["nickname"] }],
    });
  };

  it("rides the app's migrations as elements of the core table, once", async () => {
    const first = await generate(config([onUsers]));
    const up = await upOf(first!.sqlPath);
    expect(up).toContain(`ALTER TABLE "users" ADD COLUMN "nickname"`);
    expect(up).toMatch(/CREATE INDEX[^;]*"idx_users_nickname"/);
    // Only the contribution: the core table itself is not the app's.
    expect(up).not.toMatch(/CREATE TABLE "users"/);
    expect(await generate(config([onUsers]))).toBeNull();

    const withdrawn = await generate(config([]));
    expect(await upOf(withdrawn!.sqlPath)).toContain(
      `ALTER TABLE "users" DROP COLUMN "nickname"`
    );
  });

  it("is withdrawn even by a config that has no schema hooks left at all", async () => {
    await generate(config([onUsers]));
    // No plugin and no hook: nothing is compiled, and the removal is still
    // owed.
    const withdrawn = await generate({ db: { schema: { extend: [] } } });
    expect(await upOf(withdrawn!.sqlPath)).toContain(
      `ALTER TABLE "users" DROP COLUMN "nickname"`
    );
  });
});
