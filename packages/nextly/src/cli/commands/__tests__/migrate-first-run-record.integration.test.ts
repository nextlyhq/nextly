/**
 * A database's first `nextly migrate` on this release writes the registry
 * record once, and the registry baseline where its point has no registry
 * metadata, on every configured dialect.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`), on a
 * scratch database (a new file on SQLite); only the config file is not read
 * from disk. Two stand-ins for an earlier release:
 * - a migration file it wrote is one `migrate:create` writes here with the
 *   registry metadata (`entities`) and the permission record taken out of its
 *   snapshot, which is what its own `migrate:create` left out;
 * - a database it last migrated is one this release migrated with the record
 *   then deleted, the one row the earlier release does not write, and the
 *   registry rows edited where its starts would have left them elsewhere.
 *
 * Covered: the refusal of a migration without the metadata ordered where
 * nothing records the registry after it; a first run with no migration
 * carrying the metadata (rows from the configuration, upgrade and new site);
 * one whose first migration carrying it is pending; one where it is already
 * applied; the rows coming only from the migrations once the record exists;
 * and a first run stopped at each point, then finished by the next run.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { loadedDialect } from "../../../database/dialect-tables";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  readRegistryRecord,
  type RegistryRecord,
} from "../../../domains/schema/migrate/registry-record";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { NextlyError } from "../../../errors";
import { buildCollectionRevalidationIntent } from "../../../revalidation/intent-builders";
import { CACHE_TAG_EXPIRIES_TABLE } from "../../../schemas/cache-tag-expiries/table-name";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, set before each run. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

/** A stop armed for the next registry record write: it is written, then the run fails. */
const stops = vi.hoisted(() => ({ afterRecordWritten: false }));

vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = loaded.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        dependencies: [],
      };
    },
  };
});

/**
 * The record's writer, failing once just after it has written the record and
 * before its transaction commits, when a test arms it.
 */
vi.mock(
  "../../../domains/schema/migrate/registry-record",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/migrate/registry-record")
      >();
    return {
      ...original,
      storeRegistryRecord: async (
        ...args: Parameters<typeof original.storeRegistryRecord>
      ) => {
        await original.storeRegistryRecord(...args);
        if (stops.afterRecordWritten) {
          stops.afterRecordWritten = false;
          throw new Error("stopped after the record was written");
        }
      },
    };
  }
);

const SLUG = "fr-posts";

/** The app's config: one collection, with `extra` fields beyond its two. */
function config(extra: readonly string[] = []): unknown {
  return defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          text({ name: "summary" }),
          ...extra.map(name => text({ name })),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });
}

/** A new site's config, declaring no entity. */
const EMPTY = defineConfig({
  collections: [],
  db: { migrationsDir: "./migrations" },
});

/** The bookkeeping a run leaves, as two databases can be compared by it. */
interface Bookkeeping {
  rows: Record<string, string[]>;
  permissions: string[];
  grants: string[];
  record:
    | {
        point: string | null;
        baseline?: { rows: Record<string, string[]>; permissions: string[] };
      }
    | undefined;
}

/** A registry row's field names, from the stored `fields` in whichever form it reads. */
function fieldNames(fields: unknown): string[] {
  const list: unknown =
    typeof fields === "string" ? (JSON.parse(fields) as unknown) : fields;
  return (list as { name: string }[]).map(field => field.name);
}

describe.each(getConfiguredTestDialects())(
  "a first nextly migrate writes the registry record and its baseline (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    const drops: (() => Promise<void>)[] = [];
    let clock = 0;
    let files = 0;
    const q = dialect === "mysql" ? "`" : '"';

    /** A new empty database the commands can be pointed at. */
    async function scratch(): Promise<string> {
      if (dialect === "sqlite") {
        files += 1;
        return `file:${join(dir, `db-${files}.db`)}`;
      }
      const made = await createScratchDatabase(dialect, "nextly_first_run");
      drops.push(made.drop);
      return made.url;
    }

    /** Point the commands at `url`. */
    function use(url: string): void {
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
    }

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "nextly-first-run-"));
      mkdirSync(join(dir, "migrations"));
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, 0, 0)));
    });

    afterEach(async () => {
      stops.afterRecordWritten = false;
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      for (const drop of drops.splice(0)) await drop();
      rmSync(dir, { recursive: true, force: true });
    });

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, clock, 0)));
    }

    /**
     * A command's context, with everything it says captured. `stopAt` makes
     * the first message starting with it throw, a stop of the run just there.
     */
    function command(stopAt?: string): {
      context: CommandContext;
      said: string[];
    } {
      const said: string[] = [];
      let armed = stopAt;
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
        if (armed !== undefined && message.startsWith(armed)) {
          armed = undefined;
          throw new Error(`stopped at "${message}"`);
        }
      };
      return {
        context: {
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: dir,
        } as CommandContext,
        said,
      };
    }

    /** Run `fn`, turning `process.exit` into the code it was called with. */
    async function exiting(
      fn: () => Promise<void>
    ): Promise<number | undefined> {
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await fn();
        return undefined;
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return Number(match[1]);
        throw error;
      } finally {
        exit.mockRestore();
      }
    }

    /** `nextly migrate:create --name=<name>`, which must succeed; returns the migration's base name. */
    async function migrateCreate(name: string, cfg: unknown): Promise<string> {
      loaded.config = cfg;
      tick();
      const before = new Set(migrationNames());
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
      const made = migrationNames().filter(base => !before.has(base));
      expect(made).toHaveLength(1);
      return made[0];
    }

    /** The app's migrations, by base name, in run order. */
    function migrationNames(): string[] {
      return readdirSync(join(dir, "migrations"))
        .filter(file => /^\d.*\.sql$/.test(file) && !/\.\w+\.sql$/.test(file))
        .map(file => file.replace(/\.sql$/, ""))
        .sort();
    }

    /** Make `base`'s snapshot one an earlier release wrote: no registry metadata, no permissions. */
    function asEarlierRelease(base: string): void {
      const path = join(dir, "migrations", "meta", `${base}.snapshot.json`);
      const snapshot = JSON.parse(readFileSync(path, "utf-8")) as Record<
        string,
        unknown
      >;
      delete snapshot.entities;
      delete snapshot.permissions;
      writeFileSync(path, JSON.stringify(snapshot, null, 2));
    }

    /** `nextly migrate`; returns the error it failed with, if it did, and what it said. */
    async function migrateRun(
      cfg: unknown,
      stopAt?: string
    ): Promise<{ failure: string | undefined; said: string[] }> {
      loaded.config = cfg;
      tick();
      const { context, said } = command(stopAt);
      try {
        await runMigrate({ cwd: dir, throwOnFailure: true }, context);
        return { failure: undefined, said };
      } catch (error) {
        const failure = NextlyError.is(error)
          ? error.publicMessage
          : String((error as Error).message);
        return { failure, said };
      }
    }

    /** `nextly migrate`, which must succeed; returns what it said. */
    async function migrate(cfg: unknown): Promise<string[]> {
      const { failure, said } = await migrateRun(cfg);
      expect(failure, said.join("\n")).toBeUndefined();
      return said;
    }

    /** A connection of the test's own to the database at `url`. */
    async function open(url: string): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    /** With a connection to `url`, closed after. */
    async function on<T>(
      url: string,
      fn: (adapter: DrizzleAdapter) => Promise<T>
    ): Promise<T> {
      const adapter = await open(url);
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    async function recordOf(
      adapter: DrizzleAdapter
    ): Promise<RegistryRecord | undefined> {
      return readRegistryRecord(adapter.getDrizzle(), dialect);
    }

    /** What an earlier release leaves: the database without the record. */
    async function deleteRecord(adapter: DrizzleAdapter): Promise<void> {
      await adapter.executeQuery(
        `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
      );
    }

    /** The collection's registry row's field names, or undefined where there is no row. */
    async function rowFields(
      adapter: DrizzleAdapter
    ): Promise<string[] | undefined> {
      const rows = await adapter.executeQuery<{ fields: unknown }>(
        `SELECT ${q}fields${q} AS fields FROM ${q}dynamic_collections${q} WHERE ${q}slug${q} = '${SLUG}'`
      );
      return rows.length === 0 ? undefined : fieldNames(rows[0].fields);
    }

    /** Store `names` as the collection row's fields, with an older build's hash, as an earlier start would have left it. */
    async function setRowFields(
      adapter: DrizzleAdapter,
      names: readonly string[]
    ): Promise<void> {
      const fields = JSON.stringify(
        names.map(name => ({ name, type: "text" }))
      );
      await adapter.executeQuery(
        `UPDATE ${q}dynamic_collections${q} SET ${q}fields${q} = '${fields}', ${q}schema_hash${q} = 'an-older-build' WHERE ${q}slug${q} = '${SLUG}'`
      );
    }

    /** Whether the permission `slug` is stored and not orphaned. */
    async function live(
      adapter: DrizzleAdapter,
      slug: string
    ): Promise<boolean> {
      const rows = await adapter.executeQuery<{ slug: unknown }>(
        `SELECT ${q}slug${q} AS slug FROM ${q}permissions${q} WHERE ${q}slug${q} = '${slug}' AND ${q}orphaned_at${q} IS NULL`
      );
      return rows.length === 1;
    }

    /** The slugs of the permissions the role `slug` holds, sorted. */
    async function grantsOf(
      adapter: DrizzleAdapter,
      slug: string
    ): Promise<string[]> {
      const rows = await adapter.executeQuery<{ slug: unknown }>(
        `SELECT p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q} WHERE r.${q}slug${q} = '${slug}'`
      );
      return rows.map(row => String(row.slug)).sort();
    }

    /** A permission no configuration here declares, granted to the admin role, as a removed plugin leaves one. */
    async function addUndeclaredGrant(adapter: DrizzleAdapter): Promise<void> {
      const { permissions, rolePermissions } = loadedDialect(dialect).tables;
      const db = adapter.getDrizzle() as {
        insert(table: unknown): {
          values(values: Record<string, unknown>): Promise<unknown>;
        };
      };
      const now = new Date();
      await db.insert(permissions).values({
        id: "fr-gone-perm",
        name: "Sync gone feeds",
        slug: "sync-fr-gone",
        action: "sync",
        resource: "fr-gone",
        owner: "@test/fr-gone",
        createdAt: now,
        updatedAt: now,
      });
      const [admin] = await adapter.executeQuery<{ id: unknown }>(
        `SELECT ${q}id${q} AS id FROM ${q}roles${q} WHERE ${q}slug${q} = 'admin'`
      );
      await db.insert(rolePermissions).values({
        id: "fr-gone-grant",
        roleId: String(admin.id),
        permissionId: "fr-gone-perm",
        createdAt: now,
      });
    }

    /** The bookkeeping at `url`, in a form two databases compare by. */
    async function bookkeeping(url: string): Promise<Bookkeeping> {
      return on(url, async adapter => {
        const rows: Record<string, string[]> = {};
        for (const row of await adapter.executeQuery<{
          slug: unknown;
          fields: unknown;
        }>(
          `SELECT ${q}slug${q} AS slug, ${q}fields${q} AS fields FROM ${q}dynamic_collections${q}`
        )) {
          rows[String(row.slug)] = fieldNames(row.fields);
        }
        const permissions = (
          await adapter.executeQuery<{ slug: unknown; orphaned: unknown }>(
            `SELECT ${q}slug${q} AS slug, ${q}orphaned_at${q} AS orphaned FROM ${q}permissions${q}`
          )
        )
          .map(
            p => `${String(p.slug)}${p.orphaned == null ? "" : " (orphaned)"}`
          )
          .sort();
        const grants = (
          await adapter.executeQuery<{ role: unknown; slug: unknown }>(
            `SELECT r.${q}slug${q} AS role, p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q}`
          )
        )
          .map(g => `${String(g.role)}:${String(g.slug)}`)
          .sort();
        const record = await recordOf(adapter);
        return {
          rows,
          permissions,
          grants,
          record:
            record === undefined
              ? undefined
              : {
                  point: record.point,
                  ...(record.baseline === undefined
                    ? {}
                    : {
                        baseline: {
                          rows: Object.fromEntries(
                            Object.entries(record.baseline.collections).map(
                              ([slug, row]) => [slug, fieldNames(row.fields)]
                            )
                          ),
                          permissions: record.baseline.permissions,
                        },
                      }),
                },
        };
      });
    }

    describe("a migration without the registry metadata", () => {
      it("is refused once the record exists, with nothing changed and the file named", async () => {
        const url = await scratch();
        use(url);
        await migrateCreate("one", config());
        await migrate(config());
        const earlier = await migrateCreate("two", config(["extra"]));
        asEarlierRelease(earlier);
        const before = await bookkeeping(url);
        expect(before.record).toBeDefined();

        const { failure } = await migrateRun(config(["extra"]));

        expect(failure).toContain(`${earlier}.sql`);
        expect(failure).toContain("nextly migrate:create");
        expect(await bookkeeping(url)).toEqual(before);
        await on(url, async adapter => {
          const applied = await adapter.executeQuery<{ f: unknown }>(
            `SELECT ${q}filename${q} AS f FROM ${q}nextly_schema_events${q} WHERE ${q}filename${q} = '${earlier}.sql'`
          );
          expect(applied).toEqual([]);
          const columns = await adapter.executeQuery<{ c: unknown }>(
            dialect === "sqlite"
              ? `SELECT name AS c FROM pragma_table_info('dc_${SLUG.replace("-", "_")}') WHERE name = 'extra'`
              : `SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'dc_${SLUG.replace("-", "_")}' AND column_name = 'extra'`
          );
          expect(columns).toEqual([]);
        });
      }, 180_000);

      it("is refused on a first run when a pending migration that carries it comes first", async () => {
        const url = await scratch();
        use(url);
        await migrateCreate("one", config());
        const earlier = await migrateCreate("two", config(["extra"]));
        asEarlierRelease(earlier);

        const { failure } = await migrateRun(config(["extra"]));

        expect(failure).toContain(`${earlier}.sql`);
        // Refused before the lock: nothing at all was created.
        await on(url, async adapter => {
          expect(await adapter.tableExists("nextly_meta")).toBe(false);
          expect(await adapter.tableExists("nextly_schema_events")).toBe(false);
        });
      }, 180_000);
    });

    describe("a first run with no migration carrying the registry metadata", () => {
      it("sets up a new site with no app migration: the record before any, no row, every permission it added", async () => {
        const url = await scratch();
        use(url);

        const said = await migrate(EMPTY);

        const after = await bookkeeping(url);
        expect(after.record).toEqual({
          point: null,
          baseline: { rows: {}, permissions: expect.any(Array) },
        });
        expect(after.rows).toEqual({});
        // Every permission the run added is in the baseline, and only those.
        expect(after.record?.baseline?.permissions).toEqual(after.permissions);
        expect(after.permissions).toContain("read-users");
        expect(said).toContain(
          "First run on this release: 0 registry rows written from the configuration (0 declared, the rest already matched), and kept with the database's registry record as its baseline. From now on the registry rows come from the migrations."
        );
      }, 180_000);

      it("upgrades a database an earlier release migrated: rows from the configuration, no new orphan, grants kept, the record with its baseline", async () => {
        const url = await scratch();
        use(url);
        const earlier = await migrateCreate("one", config());
        asEarlierRelease(earlier);
        await migrate(config());
        // As the earlier release left it: no record, a row an older build's
        // start rewrote without a field, and a permission no build here
        // declares that the admin role holds.
        await on(url, async adapter => {
          await deleteRecord(adapter);
          await setRowFields(adapter, ["title"]);
          await addUndeclaredGrant(adapter);
          // A grant the admin preset gives, missing, so the run's one commit
          // changes a grant, and with it records the content expiry it owes.
          await adapter.executeQuery(
            `DELETE FROM ${q}role_permissions${q} WHERE ${q}role_id${q} = (SELECT ${q}id${q} FROM ${q}roles${q} WHERE ${q}slug${q} = 'admin') AND ${q}permission_id${q} = (SELECT ${q}id${q} FROM ${q}permissions${q} WHERE ${q}slug${q} = 'read-${SLUG}')`
          );
          await adapter.executeQuery(
            `DELETE FROM ${q}${CACHE_TAG_EXPIRIES_TABLE}${q}`
          );
        });

        const said = await migrate(config());

        await on(url, async adapter => {
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
          ]);
          expect(await live(adapter, "sync-fr-gone")).toBe(true);
          expect(await grantsOf(adapter, "admin")).toEqual(
            expect.arrayContaining(["sync-fr-gone", `read-${SLUG}`])
          );
          // The expiry the grant owes, recorded with it: the collection's tags.
          const expired = (
            await adapter.executeQuery<{ tag: unknown }>(
              `SELECT ${q}tag${q} AS tag FROM ${q}${CACHE_TAG_EXPIRIES_TABLE}${q}`
            )
          ).map(row => String(row.tag));
          expect(expired).toEqual(
            expect.arrayContaining(
              buildCollectionRevalidationIntent(SLUG, undefined)!.tags
            )
          );
          const record = await recordOf(adapter);
          expect(record?.point).toBe(earlier);
          expect(
            fieldNames(record?.baseline?.collections[SLUG]?.fields)
          ).toEqual(["slug", "title", "summary"]);
          expect(record?.baseline?.permissions).toEqual(
            expect.arrayContaining(["read-fr-posts", "sync-fr-gone"])
          );
        });
        expect(said).toContain(
          "First run on this release: 1 registry row written from the configuration (1 declared, the rest already matched), and kept with the database's registry record as its baseline. From now on the registry rows come from the migrations."
        );

        // With the record, a configuration that differs changes no row until
        // a migration records it.
        await migrate(config(["extra"]));
        await on(url, async adapter => {
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
          ]);
        });
        await migrateCreate("two", config(["extra"]));
        await migrate(config(["extra"]));
        await on(url, async adapter => {
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
            "extra",
          ]);
          // The record is written once.
          expect((await recordOf(adapter))?.point).toBe(earlier);
        });
      }, 240_000);
    });

    describe("a first run whose first migration carrying the metadata is pending", () => {
      it("takes the record and the baseline, the rows as they stood, just before it applies", async () => {
        const url = await scratch();
        use(url);
        const earlier = await migrateCreate("one", config());
        asEarlierRelease(earlier);
        await migrate(config());
        await on(url, deleteRecord);
        await migrateCreate("two", config(["extra"]));

        await migrate(config(["extra"]));

        await on(url, async adapter => {
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
            "extra",
          ]);
          const record = await recordOf(adapter);
          expect(record?.point).toBe(earlier);
          expect(
            fieldNames(record?.baseline?.collections[SLUG]?.fields)
          ).toEqual(["slug", "title", "summary"]);
        });
      }, 240_000);

      it("takes it once a pending migration an earlier release wrote, ordered first, has applied", async () => {
        const url = await scratch();
        use(url);
        const earlier = await migrateCreate("one", config());
        asEarlierRelease(earlier);
        await migrateCreate("two", config(["extra"]));

        await migrate(config(["extra"]));

        await on(url, async adapter => {
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
            "extra",
          ]);
          const record = await recordOf(adapter);
          expect(record?.point).toBe(earlier);
          // Nothing had written the collection's row when it was taken.
          expect(record?.baseline?.collections).toEqual({});
        });
      }, 240_000);

      it("takes a new site's record at the point before any app migration, with no row", async () => {
        const url = await scratch();
        use(url);
        await migrateCreate("one", config());

        const said = await migrate(config());

        await on(url, async adapter => {
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
          ]);
          const record = await recordOf(adapter);
          expect(record?.point).toBeNull();
          expect(record?.baseline?.collections).toEqual({});
        });
        expect(said.join("\n")).not.toContain("written from the configuration");
      }, 180_000);
    });

    describe("a first run finding the metadata already applied", () => {
      it("writes the rows from that snapshot, orphans nothing, and records that point with no baseline", async () => {
        const url = await scratch();
        use(url);
        const first = await migrateCreate("one", config());
        await migrate(config());
        // An earlier release applied this release's migration: no record,
        // a row behind its snapshot, and a permission no build declares.
        await on(url, async adapter => {
          await deleteRecord(adapter);
          await setRowFields(adapter, ["title"]);
          await addUndeclaredGrant(adapter);
        });

        await migrate(config(["extra"]));

        await on(url, async adapter => {
          // From the snapshot, not the configuration, which has `extra`.
          expect(await rowFields(adapter)).toEqual([
            "slug",
            "title",
            "summary",
          ]);
          expect(await live(adapter, "sync-fr-gone")).toBe(true);
          expect(await grantsOf(adapter, "admin")).toContain("sync-fr-gone");
          expect(await recordOf(adapter)).toEqual({ point: first });
        });
      }, 180_000);
    });

    describe("a first run stopped part-way", () => {
      /** Each database holds no record and nothing the run wrote, or the record with its baseline. */
      async function stoppedCleanly(url: string): Promise<void> {
        const state = await bookkeeping(url);
        if (state.record === undefined) {
          expect(state.rows).toEqual({});
          expect(state.permissions).toEqual([]);
          expect(state.grants).toEqual([]);
        } else {
          expect(state.record.baseline).toBeDefined();
        }
      }

      it.each([
        [
          "after a pending migration commits and before the bookkeeping",
          "Phase 3: writing the registry rows from the configuration",
        ],
        ["after the record is written and before it commits", "record"],
      ])(
        "with no migration carrying the metadata, stopped %s, is finished by the next run",
        async (_when, stopAt) => {
          const reference = await scratch();
          use(reference);
          const earlier = await migrateCreate("one", config());
          asEarlierRelease(earlier);
          await migrate(config());

          const url = await scratch();
          use(url);
          if (stopAt === "record") stops.afterRecordWritten = true;
          const stopped = await migrateRun(
            config(),
            stopAt === "record" ? undefined : stopAt
          );
          expect(stopped.failure, stopped.said.join("\n")).toBeDefined();
          expect((await bookkeeping(url)).record).toBeUndefined();
          await stoppedCleanly(url);

          await migrate(config());
          expect(await bookkeeping(url)).toEqual(await bookkeeping(reference));
        },
        240_000
      );

      it.each([
        [
          "just after the record commits and before the migration applies",
          "Registry record taken at",
        ],
        [
          "just after the migration commits and before any bookkeeping",
          "Phase 3: recording migration metadata",
        ],
      ])(
        "with a pending migration carrying the metadata, stopped %s, is finished by the next run",
        async (_when, stopAt) => {
          const reference = await scratch();
          use(reference);
          await migrateCreate("one", config());
          await migrate(config());

          const url = await scratch();
          use(url);
          const stopped = await migrateRun(config(), stopAt);
          expect(stopped.failure, stopped.said.join("\n")).toBeDefined();
          const state = await bookkeeping(url);
          expect(state.record).toEqual({
            point: null,
            baseline: { rows: {}, permissions: [] },
          });
          await stoppedCleanly(url);

          await migrate(config());
          expect(await bookkeeping(url)).toEqual(await bookkeeping(reference));
        },
        240_000
      );
    });
  }
);
