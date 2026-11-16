/**
 * An installation in a PostgreSQL schema other than `public`, booted for real.
 *
 * What separates working from plausibly broken: every table — core, a
 * collection's, a plugin's — lands in the named schema and none in `public`
 * (a push still reading the desired tables as `public`'s creates them there,
 * or nothing at all); reads and writes reach them; a repeat push plans no
 * table or schema change (a push comparing the wrong namespace proposes
 * creating, dropping or moving every table, every time); and a setting moved
 * off an existing installation is refused, naming both schemas, in either
 * direction.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import { getDialectTables } from "../../../../database";
import { getPgDrizzleKit } from "../../../../database/drizzle-kit-lazy";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  definePlugin,
  type PluginContext,
} from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { col, defineTable } from "../../extension/dsl";
import { pushInActiveSchema } from "../../pipeline/pg-active-schema-push";
import { assertInstallationInConfiguredSchema } from "../postgres-schema";

const suite = getConfiguredTestDialects().includes("postgresql")
  ? describe
  : describe.skip;

const SCHEMA = "nx_tenant";

/** The PostgreSQL handle the installation check reads the catalogue through. */
type CatalogReader = Parameters<typeof assertInstallationInConfiguredSchema>[0];

const notes = defineTable("notes", { id: col.id(), body: col.shortText() });

const posts = defineCollection({
  slug: "npn_posts",
  fields: [text({ name: "title" })],
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Boot a fresh database, its installation in `schema` (`undefined`: public). */
async function boot(schema: string | undefined): Promise<PluginContext> {
  let ctx: PluginContext | undefined;
  current = await createTestNextly({
    dialect: "postgresql",
    ...(schema === undefined ? {} : { postgresSchema: schema }),
    collections: [posts],
    plugins: [
      definePlugin({
        name: "@test/named-schema",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "npn", tables: [notes] } },
        init(context) {
          ctx = context;
        },
      }),
    ],
  });
  if (!ctx) throw new Error("the plugin's init did not run");
  return ctx;
}

/** Every base table in `public` and in the named schema, by schema. */
async function tablesBySchema(
  handle: TestNextly
): Promise<Record<string, string[]>> {
  const rows = await handle.adapter.executeQuery<{ s: string; t: string }>(
    `SELECT table_schema AS s, table_name AS t
       FROM information_schema.tables
      WHERE table_schema IN ('public', '${SCHEMA}')
        AND table_type = 'BASE TABLE'`
  );
  const out: Record<string, string[]> = { public: [], [SCHEMA]: [] };
  for (const row of rows) out[row.s]?.push(row.t);
  return out;
}

suite("an installation in a named PostgreSQL schema", () => {
  it("keeps every core, collection and plugin table in it, and none in public", async () => {
    const ctx = await boot(SCHEMA);
    const handle = current as TestNextly;

    const tables = await tablesBySchema(handle);
    expect(tables.public).toEqual([]);
    expect(tables[SCHEMA]).toEqual(
      expect.arrayContaining(["nextly_schema_events", "users", "npn__notes"])
    );
    expect(tables[SCHEMA]?.some(name => name.includes("npn_posts"))).toBe(true);

    // Reads and writes reach them through the connection's search_path.
    const created = await handle.nextly.create({
      collection: "npn_posts",
      data: { title: "hello" },
    });
    expect(created.item.title).toBe("hello");
    await ctx.db.insert(notes, { body: "kept" });
    expect((await ctx.db.select(notes).all()).map(row => row.body)).toEqual([
      "kept",
    ]);
  });

  it("plans no table or schema change on a repeat push of the core tables", async () => {
    await boot(SCHEMA);
    const handle = current as TestNextly;
    const core = getDialectTables("postgresql") as unknown as Record<
      string,
      unknown
    >;
    const kit = await getPgDrizzleKit();
    const { users } = core;

    const answer = await pushInActiveSchema({ users }, (schema, desired) =>
      kit.pushSchema(desired, handle.adapter.getDrizzle() as never, {
        schemas: [schema],
        tables: ["users"],
      })
    );

    const structural = answer.sqlStatements.filter(statement =>
      /\b(CREATE|DROP)\s+(TABLE|SCHEMA)\b|SET SCHEMA/i.test(statement)
    );
    expect(structural).toEqual([]);
  });

  it("refuses a start in public once the installation is in the named schema, naming both", async () => {
    await boot(SCHEMA);
    const handle = current as TestNextly;
    const db = handle.adapter.getDrizzle<CatalogReader>();

    await expect(
      assertInstallationInConfiguredSchema(db, SCHEMA, {})
    ).resolves.toBeUndefined();
    const error = await assertInstallationInConfiguredSchema(
      db,
      "public",
      {}
    ).catch((caught: unknown) => caught);
    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      true
    );
    expect((error as NextlyError).publicMessage).toContain(`"${SCHEMA}"`);
    expect((error as NextlyError).publicMessage).toContain('"public"');
  });

  it("refuses a start in a named schema once the installation is in public, naming both", async () => {
    await boot(undefined);
    const handle = current as TestNextly;
    const db = handle.adapter.getDrizzle<CatalogReader>();

    expect((await tablesBySchema(handle)).public).toEqual(
      expect.arrayContaining(["nextly_schema_events"])
    );
    const error = await assertInstallationInConfiguredSchema(
      db,
      "nx_other",
      {}
    ).catch((caught: unknown) => caught);
    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      true
    );
    expect((error as NextlyError).publicMessage).toContain('"nx_other"');
    expect((error as NextlyError).publicMessage).toContain('"public"');
    // A separate installation, started on purpose, is let through.
    await expect(
      assertInstallationInConfiguredSchema(db, "nx_other", {
        NEXTLY_POSTGRES_SCHEMA_NEW_INSTALL: "1",
      })
    ).resolves.toBeUndefined();
  });
});
