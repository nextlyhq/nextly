/**
 * An existing install upgrading to the breakpoint removal's tables, with the
 * command a deployment runs, on every configured dialect: from a release
 * before the removal's runs table (schema 4), and from one with it but before
 * the table keeping what each removal took out (schema 5).
 *
 * The install is made the way a site at that release made it: a scratch
 * project configured with this plugin as that release shipped it (its first
 * migration modules, without the later tables), migrated with `nextly
 * migrate`. A row is stored in one of its tables. The project is then
 * configured with the plugin as it ships now and migrated again. Exactly the
 * modules after it must run: the runs table takes one open run at a time, the
 * fragments table keeps a row with its JSON (the shared styles' with no
 * host), the earlier row and the earlier modules' records are untouched, each
 * new module is recorded applied once, and migrating again does nothing.
 *
 * The database is one of the test's own on Postgres and MySQL (created beside
 * the integration database and dropped after), and a scratch file on SQLite,
 * because the command builds core's tables from nothing.
 *
 * @module __tests__/breakpoint-removals-migration.integration.test
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  getConfiguredTestDialects,
  type TestDialect,
} from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { migrations } from "../schema/migrations";
import {
  breakpointRemovalFragments,
  breakpointRemovals,
  SCHEMA_PREFIX,
  siteOptions,
} from "../schema/tables";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The tables as the database names them. */
const REMOVALS_TABLE = `${SCHEMA_PREFIX}__${breakpointRemovals.name}`;
const FRAGMENTS_TABLE = `${SCHEMA_PREFIX}__${breakpointRemovalFragments.name}`;
const OPTIONS_TABLE = `${SCHEMA_PREFIX}__${siteOptions.name}`;

/** How many modules ship before the one named `suffix`. */
function shippedBefore(suffix: string): number {
  const index = migrations.findIndex(module => module.name.endsWith(suffix));
  if (index < 1) throw new Error(`no module ${suffix} after the first`);
  return index;
}

/** The releases an install upgrades from, by how many modules they shipped. */
const RELEASES = [
  {
    release: "before the removal's runs (schema 4)",
    shipped: shippedBefore("_create_breakpoint_removals"),
  },
  {
    release: "before the removal's fragments (schema 5)",
    shipped: shippedBefore("_create_breakpoint_removal_fragments"),
  },
];

/** What a ledger entry of this plugin's modules reads as. */
interface LedgerEntry {
  filename: string;
  status: string;
  appliedAt: string | null;
}

/** A database of the test's own, its URL, and how to remove it. */
interface Database {
  readonly dialect: TestDialect;
  readonly url: string;
  drop(): Promise<void>;
}

/** A name this test generated, the only kind it builds DDL from. */
function scratchName(): string {
  const name = `pb_upgrade_${randomBytes(6).toString("hex")}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(name);
  return name;
}

/** A database created beside the integration one, or a scratch SQLite file. */
async function scratchDatabase(
  dialect: TestDialect,
  folder: string
): Promise<Database> {
  if (dialect === "sqlite") {
    return {
      dialect,
      url: `file:${join(folder, "site.sqlite")}`,
      drop: async () => {},
    };
  }
  const adminUrl =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL;
  if (adminUrl === undefined) throw new Error(`no URL for ${dialect}`);
  const name = scratchName();
  const admin = await createAdapter({ type: dialect, url: adminUrl });
  await admin.executeQuery(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    dialect,
    url: url.toString(),
    drop: async () => {
      try {
        await admin.executeQuery(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await admin.disconnect();
      }
    },
  };
}

/**
 * A scratch project configured with this plugin, its migration modules cut to
 * the first `PB_MODULES` when that is set (the plugin as an earlier release
 * shipped it, without the tables later modules create), and the `nextly`
 * command run in it against `database`.
 */
function project(database: Database): {
  nextly: (
    modules: number | undefined,
    ...args: string[]
  ) => Promise<{ stdout: string; stderr: string }>;
  close: () => void;
} {
  const folder = mkdtempSync(join(tmpdir(), "pb-upgrade-"));
  symlinkSync(join(packageRoot, "node_modules"), join(folder, "node_modules"));
  writeFileSync(
    join(folder, "nextly.config.ts"),
    [
      'import { defineConfig } from "nextly/config";',
      `import { pageBuilder } from ${JSON.stringify(join(packageRoot, "src/plugin.ts"))};`,
      `import { migrations } from ${JSON.stringify(join(packageRoot, "src/schema/migrations/index.ts"))};`,
      "",
      "const kept = Number(process.env.PB_MODULES ?? migrations.length);",
      "const plugin = pageBuilder();",
      "const schema = plugin.contributes?.schema;",
      "// The plugin as the release shipping `kept` modules declared it: the",
      "// tables its newest module's snapshot holds, and no others.",
      "const known = kept >= migrations.length ? undefined : new Set(",
      "  migrations[kept - 1].snapshot.sqlite.tables.map(table => table.name)",
      ");",
      "const shipped = known === undefined || schema === undefined ? plugin : {",
      "  ...plugin,",
      "  schemaVersion: migrations[kept - 1].schemaVersion,",
      "  contributes: {",
      "    ...plugin.contributes,",
      "    schema: {",
      "      ...schema,",
      "      migrations: migrations.slice(0, kept),",
      `      tables: (schema.tables ?? []).filter(table => known.has(${JSON.stringify(`${SCHEMA_PREFIX}__`)} + table.name)),`,
      "    },",
      "  },",
      "};",
      "export default defineConfig({ plugins: [shipped] });",
      "",
    ].join("\n"),
    { flag: "wx" }
  );
  return {
    nextly: (modules, ...args) => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: database.url,
        DB_DIALECT: database.dialect,
      };
      delete environment.PB_MODULES;
      if (modules !== undefined) environment.PB_MODULES = String(modules);
      return run(join(packageRoot, "node_modules/.bin/nextly"), args, {
        cwd: folder,
        env: environment,
        timeout: 120_000,
      });
    },
    close: () => rmSync(folder, { recursive: true, force: true }),
  };
}

/** This plugin's ledger, as `nextly migrate:status` reads it. */
async function ledger(
  nextly: ReturnType<typeof project>["nextly"]
): Promise<LedgerEntry[]> {
  const { stdout } = await nextly(
    undefined,
    "migrate:status",
    "--json",
    "--plugin",
    PAGE_BUILDER_PLUGIN_NAME
  );
  const read = JSON.parse(stdout) as { migrations: LedgerEntry[] };
  return read.migrations.map(({ filename, status, appliedAt }) => ({
    filename,
    status,
    appliedAt,
  }));
}

/**
 * An adapter on `database`. Core's environment is read when an adapter is
 * made, so it names this database while the adapter is open, and is put back
 * by `close`.
 */
async function openAdapter(database: Database): Promise<{
  adapter: Awaited<ReturnType<typeof createAdapter>>;
  close: () => Promise<void>;
}> {
  const own = {
    DATABASE_URL: process.env.DATABASE_URL,
    DB_DIALECT: process.env.DB_DIALECT,
  };
  process.env.DATABASE_URL = database.url;
  process.env.DB_DIALECT = database.dialect;
  const restore = () => {
    for (const [key, value] of Object.entries(own)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const adapter = await createAdapter({
      type: database.dialect,
      url: database.url,
    });
    return {
      adapter,
      close: async () => {
        try {
          await adapter.disconnect();
        } finally {
          restore();
        }
      },
    };
  } catch (error) {
    restore();
    throw error;
  }
}

/**
 * Rows written and read with SQL. An adapter made outside a booted site has
 * no registry of the plugin's tables, so its typed `insert` and `selectOne`
 * cannot address them. Every name here is a constant of this file; values
 * travel as parameters, and identifiers are quoted because MySQL reserves
 * `before`.
 */
function rowsOn(
  dialect: TestDialect,
  adapter: Awaited<ReturnType<typeof createAdapter>>
): {
  insert: (table: string, row: Record<string, string | null>) => Promise<void>;
  column: (table: string, id: string, column: string) => Promise<unknown>;
} {
  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const slot = (index: number) =>
    dialect === "postgresql" ? `$${String(index + 1)}` : "?";
  return {
    insert: async (table, row) => {
      const names = Object.keys(row);
      await adapter.executeQuery(
        `INSERT INTO ${quote(table)} (${names.map(quote).join(", ")}) VALUES (${names.map((_, index) => slot(index)).join(", ")})`,
        names.map(name => row[name] ?? null)
      );
    },
    column: async (table, id, column) => {
      const found = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${quote(column)} AS ${quote("read")} FROM ${quote(table)} WHERE ${quote("id")} = ${slot(0)}`,
        [id]
      );
      return found[0]?.read;
    },
  };
}

/** A module's ledger name. */
const ledgerName = (name: string) =>
  `plugin:${PAGE_BUILDER_PLUGIN_NAME}/${name}`;

/** A JSON column's value as a driver hands it back: parsed, or its text. */
function json(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

describe.each(getConfiguredTestDialects())(
  "an install upgrading to the breakpoint removal's tables (%s)",
  (dialect: TestDialect) => {
    it.each(RELEASES)(
      "applies only the modules after the release $release, keeps what was stored, and does nothing the second time",
      async ({ shipped }) => {
        const folder = mkdtempSync(join(tmpdir(), "pb-upgrade-db-"));
        const database = await scratchDatabase(dialect, folder);
        const site = project(database);
        let opened: Awaited<ReturnType<typeof openAdapter>> | undefined;
        try {
          // The earlier release's install.
          const first = await site.nextly(shipped, "migrate");
          expect(first.stdout).toContain(
            `Plugin migrations: ${String(shipped)} applied`
          );
          // Read with the current release's list: the earlier modules
          // applied, the new ones listed and not applied.
          const before = await ledger(site.nextly);
          expect(before.map(entry => entry.filename)).toEqual(
            migrations.map(module => ledgerName(module.name))
          );
          expect(
            before.slice(0, shipped).every(entry => entry.status === "applied")
          ).toBe(true);
          expect(
            before.slice(shipped).every(entry => entry.status !== "applied")
          ).toBe(true);
          opened = await openAdapter(database);
          let { adapter } = opened;
          // CONTROL: that release has no fragments table, and the runs table
          // only from schema 5.
          expect(await adapter.tableExists(FRAGMENTS_TABLE)).toBe(false);
          expect(await adapter.tableExists(REMOVALS_TABLE)).toBe(
            shipped > shippedBefore("_create_breakpoint_removals")
          );
          await rowsOn(dialect, adapter).insert(OPTIONS_TABLE, {
            id: "kept-option",
            name: "upgrade-probe",
            value: "kept",
          });
          await opened.close();
          opened = undefined;

          // The upgrade.
          const upgrade = await site.nextly(undefined, "migrate");
          expect(upgrade.stdout).toContain(
            `Plugin migrations: ${String(migrations.length - shipped)} applied, 0 adopted, ${String(shipped)} already recorded`
          );

          opened = await openAdapter(database);
          adapter = opened.adapter;
          expect(await adapter.tableExists(REMOVALS_TABLE)).toBe(true);
          expect(await adapter.tableExists(FRAGMENTS_TABLE)).toBe(true);
          // One open run at a time: a second open row is refused, and any
          // number of closed ones are kept.
          const row = (id: string, openKey: string | null) => ({
            id,
            removed_ids: '["mobile"]',
            before: "null",
            started_by: "user:upgrade",
            open_key: openKey,
          });
          const rows = rowsOn(dialect, adapter);
          await rows.insert(REMOVALS_TABLE, row("open-1", "site"));
          await expect(
            rows.insert(REMOVALS_TABLE, row("open-2", "site"))
          ).rejects.toBeDefined();
          await rows.insert(REMOVALS_TABLE, row("done-1", null));
          await rows.insert(REMOVALS_TABLE, row("done-2", null));
          expect(await rows.column(REMOVALS_TABLE, "done-2", "open_key")).toBe(
            null
          );
          expect(await rows.column(REMOVALS_TABLE, "open-1", "phase")).toBe(
            "converting"
          );
          // What a removal took out, with its JSON kept whole, and the shared
          // styles' row with no host.
          const fragment = {
            nodes: {
              t1: { styles: { base: { mobile: { color: "#1155cc" } } } },
            },
          };
          await rows.insert(FRAGMENTS_TABLE, {
            id: "fragment-1",
            run_id: "0190a000-0000-7000-8000-000000000001",
            document_key: "collection\u001fpages\u001fp1",
            host: JSON.stringify({
              kind: "collection",
              slug: "pages",
              id: "p1",
              path: ["content"],
            }),
            form: "draft",
            fragment: JSON.stringify(fragment),
          });
          await rows.insert(FRAGMENTS_TABLE, {
            id: "fragment-2",
            run_id: "0190a000-0000-7000-8000-000000000001",
            document_key: "site-style",
            host: null,
            form: "site",
            fragment: JSON.stringify({ classes: {}, overridden: [] }),
          });
          expect(
            json(await rows.column(FRAGMENTS_TABLE, "fragment-1", "fragment"))
          ).toEqual(fragment);
          expect(
            await rows.column(FRAGMENTS_TABLE, "fragment-2", "host")
          ).toBeNull();
          expect(
            await rows.column(FRAGMENTS_TABLE, "fragment-1", "created_at")
          ).not.toBeNull();
          // The row stored before the upgrade is as it was.
          expect(await rows.column(OPTIONS_TABLE, "kept-option", "value")).toBe(
            "kept"
          );

          // The earlier modules' records untouched, each new one applied once.
          const after = await ledger(site.nextly);
          expect(after.slice(0, shipped)).toEqual(before.slice(0, shipped));
          for (const module of migrations.slice(shipped)) {
            expect(
              after.filter(entry => entry.filename === ledgerName(module.name))
            ).toEqual([expect.objectContaining({ status: "applied" })]);
          }
          expect(after).toHaveLength(migrations.length);

          // Migrating again does nothing.
          const again = await site.nextly(undefined, "migrate");
          expect(again.stdout).toContain("Nothing to migrate");
          expect(await ledger(site.nextly)).toEqual(after);
        } finally {
          await opened?.close();
          site.close();
          await database.drop();
          rmSync(folder, { recursive: true, force: true });
        }
      },
      300_000
    );
  }
);
