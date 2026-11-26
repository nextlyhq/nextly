/**
 * `nextly repair-columns` where no applied snapshot says what was last migrated, on every
 * configured dialect.
 *
 * Each case is made with the real commands: `migrate:create` and `migrate` write and apply the
 * migrations, and a start with `NODE_ENV` unset (a seed script) rewrites the registry row from
 * another configuration, as it does. Then one thing is taken away:
 *
 * - every snapshot, from a project whose database records that snapshots were written for its
 *   migrations: the run stops (`MISSING_SNAPSHOT`), dry run included, and converts nothing;
 * - the registry record, from a project whose snapshots record no entities, as an earlier release
 *   left it before `nextly migrate` of this one ran: the run goes on and says once, on standard
 *   error, that what was last applied is taken from the registry;
 * - the entity record of the newest applied snapshot, as an earlier release's `migrate:create`
 *   wrote it after one that has it: the run stops, naming the file and the way out, and the way out
 *   as printed leaves nothing to report.
 *
 * Every column judged here is as its newest migration left it, so a run that reports one as
 * `would convert`, or converts it, reads an older definition.
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

import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: state.config,
    appConfig: state.config,
    pluginConsent: undefined,
    projectRoot: state.dir,
    dependencies: [],
  }),
}));

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  number,
  relationship,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { shutdownServices } from "../../../di/register";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { introspectLiveColumns } from "../../../domains/schema/pipeline/diff/introspect-live";
import { getNextly, shutdownNextly, startSettled } from "../../../init";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { sanitizeConfig } from "../../../shared/types/config";
import { createContext, type CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { REGISTRY_STANDS_IN_NOTICE } from "../../../domains/schema/repair-columns/read-entities";
import { repairColumnsAction } from "../repair-columns";

/** The refusal of a newest applied snapshot that records no entities, as proposed. */
const NEWEST_WITHOUT_RECORD = "SNAPSHOT_WITHOUT_ENTITIES";

const TABLE = "dc_rsh_posts";
const COLUMNS = ["author", "rating"] as const;
const SECRET = "test-secret-must-be-at-least-32-characters-long!!";

/** The two definitions a case moves between: `author` becomes required, `rating` a float. */
type Shape = { author: boolean; rating: "integer" | "float"; extra?: true };
const FIRST: Shape = { author: false, rating: "integer" };
const SECOND: Shape = { author: true, rating: "float" };
/** What a seed script's configuration declares: `author` optional again, as in `FIRST`. */
const ELSEWHERE: Shape = { author: false, rating: "float" };

const configOf = (shape: Shape) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "rsh_posts",
        fields: [
          text({ name: "title" }),
          relationship({
            name: "author",
            relationTo: "users",
            required: shape.author,
          }),
          number({
            name: "rating",
            ...(shape.rating === "float"
              ? { options: { format: "float" } }
              : {}),
          } as never),
        ],
      }),
      // A second collection, for a configuration that adds one.
      ...(shape.extra
        ? [
            defineCollection({
              slug: "rsh_notes",
              fields: [text({ name: "body" })],
            }),
          ]
        : []),
    ],
    db: { migrationsDir: "./migrations" },
  } as never);

describe.each(getConfiguredTestDialects())(
  "repair-columns with an applied history no snapshot speaks for (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-rsh-"));
      mkdirSync(join(state.dir, "migrations"));
      url = `file:${join(state.dir, "site.db")}`;
      drop = async () => undefined;
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "nextly_rsh");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NEXTLY_SECRET", SECRET);
      vi.stubEnv("CI", "");
      _resetEnvCache();
      vi.spyOn(process, "cwd").mockReturnValue(state.dir);
      // Each migration file is named by the clock.
      vi.useFakeTimers({ toFake: ["Date"] });
      tick();
    }, 120_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      process.exitCode = undefined;
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      // The second collection's table, on the shared SQLite file it is removed with the folder.
      rmSync(state.dir, { recursive: true, force: true });
    }, 120_000);

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 26, 12, 0, clock, 0)));
      clearCachedSnapshot();
      clearLiveSnapshots();
    }

    const context = (): CommandContext =>
      ({
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: state.dir,
      }) as CommandContext;

    /** `fn`, a command that must succeed, with nobody to ask. */
    async function succeeds(fn: () => Promise<unknown>): Promise<void> {
      setNonInteractive(true);
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await fn();
      } finally {
        exit.mockRestore();
        setNonInteractive(false);
      }
    }

    /** `nextly migrate:create` of `shape`, then `nextly migrate`. */
    async function migrated(shape: Shape, name: string): Promise<void> {
      state.config = configOf(shape);
      tick();
      await succeeds(() =>
        runMigrateCreate(
          name,
          { cwd: state.dir, acceptDataLoss: true } as never,
          context()
        )
      );
      tick();
      await succeeds(() =>
        runMigrate(
          { cwd: state.dir, throwOnFailure: true, acceptDataLoss: true },
          context()
        )
      );
    }

    async function withDatabase<R>(fn: (adapter: any) => Promise<R>) {
      const adapter = (await createAdapter({
        type: dialect,
        url,
      } as never)) as any;
      try {
        await adapter.connect?.();
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    /** The two columns as the database holds them. */
    const columns = () =>
      withDatabase(async adapter => {
        const live = await introspectLiveColumns(
          adapter.getDrizzle(),
          dialect,
          [TABLE]
        );
        const table = live.tables.find(t => t.name === TABLE);
        return Object.fromEntries(
          (table?.columns ?? [])
            .filter(c => (COLUMNS as readonly string[]).includes(c.name))
            .map(c => [c.name, { type: c.type, nullable: c.nullable }])
        );
      });

    /** One entry, so a conversion has a row to judge. */
    const entry = () =>
      withDatabase(adapter =>
        adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${["id", "title", "slug", "author", "rating"].map(q).join(", ")}) VALUES ('p1', 'T', 'p1', 'u1', 4)`
        )
      );

    /** A start with `NODE_ENV` unset, as a seed script runs one, from `shape`. */
    async function scriptStart(shape: Shape): Promise<void> {
      vi.stubEnv("NODE_ENV", undefined);
      _resetEnvCache();
      try {
        await getNextly({
          config: sanitizeConfig(configOf(shape) as never) as never,
        });
        await startSettled();
      } finally {
        await shutdownNextly();
        await shutdownServices();
        vi.stubEnv("NODE_ENV", "test");
        _resetEnvCache();
      }
    }

    const metaDir = () => join(state.dir, "migrations", "meta");
    const snapshots = () =>
      readdirSync(metaDir())
        .filter(f => f.endsWith(".snapshot.json"))
        .sort();

    /**
     * `file` as an earlier release's `migrate:create` wrote it: its tables and checksum alone, and
     * the field-group names its history is on, which a version 2 snapshot always records.
     */
    function asEarlierRelease(file: string): void {
      const path = join(metaDir(), file);
      const { version, fieldGroupStorage, migrationHash, snapshot } =
        JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      writeFileSync(
        path,
        JSON.stringify(
          {
            version,
            ...(fieldGroupStorage === undefined ? {} : { fieldGroupStorage }),
            migrationHash,
            snapshot,
          },
          null,
          2
        )
      );
    }

    /** The point the registry record was taken at, and whether it keeps a baseline. */
    const recordPoint = () =>
      withDatabase(async adapter => {
        const [row] = (await adapter.executeQuery(
          `SELECT ${q("value")} AS v FROM ${q("nextly_meta")} WHERE ${q("key")} = 'registry_record'`
        )) as Array<{ v: unknown }>;
        let value: unknown = row?.v;
        while (typeof value === "string") value = JSON.parse(value);
        const record = value as { point?: string; baseline?: unknown };
        return record.baseline === undefined ? record.point : "with baseline";
      });

    /** The database as it stood before `nextly migrate` of this release first ran: no record. */
    const withoutRegistryRecord = () =>
      withDatabase(adapter =>
        adapter.executeQuery(
          `DELETE FROM ${q("nextly_meta")} WHERE ${q("key")} = 'registry_record'`
        )
      );

    /** What a run without `--json` writes to each stream, with the global options given. */
    async function plainRun(shape: Shape, globals: Record<string, unknown>) {
      state.config = configOf(shape);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const spies = [
        vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
          stdout.push(String(chunk));
          return true;
        }),
        vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
          stderr.push(String(chunk));
          return true;
        }),
        vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
          stdout.push(a.join(" "));
        }),
        vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
          stderr.push(a.join(" "));
        }),
      ];
      process.exitCode = undefined;
      try {
        await repairColumnsAction(createContext)({ json: false }, {
          optsWithGlobals: () => ({ cwd: state.dir, ...globals }),
        } as unknown as Command);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      const lines = (chunks: string[]) =>
        chunks
          .join("\n")
          .split("\n")
          .filter(line => line.trim() !== "");
      return { stdout: lines(stdout), stderr: lines(stderr) };
    }

    /** `nextly repair-columns --json`, with or without `--apply`, as `shape` is configured. */
    async function repair(shape: Shape, apply: boolean, table = TABLE) {
      state.config = configOf(shape);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const spies = [
        vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
          stdout.push(String(chunk));
          return true;
        }),
        vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
          stderr.push(String(chunk));
          return true;
        }),
      ];
      process.exitCode = undefined;
      try {
        await repairColumnsAction(createContext)({ json: true, apply }, {
          optsWithGlobals: () => ({ cwd: state.dir }),
        } as unknown as Command);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      // The document is standard output's only content.
      const document = JSON.parse(stdout.join("")) as {
        result: {
          records: Array<{ table: string; column: string; outcome: string }>;
        } | null;
        errors: Array<{ code: string; message: string; next: string }>;
      };
      const ours = (document.result?.records ?? []).filter(
        r => r.table === table
      );
      return {
        exitCode: process.exitCode,
        codes: document.errors.map(e => e.code),
        errors: document.errors,
        outcomes: ours.map(r => `${r.column} ${r.outcome}`).sort(),
        stderr: stderr
          .join("")
          .split("\n")
          .filter(line => line.trim() !== ""),
      };
    }

    /** What a run names as converting, or as able to: never a column as its newest migration left it. */
    const converting = (outcomes: readonly string[]) =>
      outcomes.filter(o => /(would-convert|converted)$/.test(o));

    describe("every snapshot lost, where the database records that they were written", () => {
      it.each([
        ["one migration", false],
        ["two migrations", true],
      ] as const)(
        "stops with MISSING_SNAPSHOT and converts nothing, after a seed script rewrote the row (%s)",
        async (_, two) => {
          if (two) await migrated(FIRST, "first");
          await migrated(SECOND, "second");
          await entry();
          await scriptStart(ELSEWHERE);
          rmSync(metaDir(), { recursive: true });
          const before = await columns();

          for (const apply of [false, true]) {
            const run = await repair(ELSEWHERE, apply);
            expect(run.codes, JSON.stringify(run)).toEqual([
              "MISSING_SNAPSHOT",
            ]);
            expect(run.exitCode).toBe(1);
            expect(converting(run.outcomes)).toEqual([]);
          }
          expect(await columns()).toEqual(before);
        },
        300_000
      );

      it("stops where the record's point is a blank migration after the one whose snapshot was lost", async () => {
        // The record keeps no baseline where an applied snapshot recorded the entities, as one an
        // earlier release's `nextly migrate` applied did before this release's first ran. Here
        // that first run finds a blank migration applied last, which becomes the record's point.
        await migrated(SECOND, "second");
        await entry();
        tick();
        await succeeds(() =>
          runMigrateCreate(
            "custom",
            { cwd: state.dir, blank: true } as never,
            context()
          )
        );
        tick();
        await succeeds(() =>
          runMigrate({ cwd: state.dir, throwOnFailure: true }, context())
        );
        await withoutRegistryRecord();
        tick();
        await succeeds(() =>
          runMigrate({ cwd: state.dir, throwOnFailure: true }, context())
        );
        expect(await recordPoint()).toMatch(/_custom$/);
        await scriptStart(ELSEWHERE);
        rmSync(metaDir(), { recursive: true });
        const before = await columns();
        const run = await repair(ELSEWHERE, true);
        expect(run.codes, JSON.stringify(run)).toEqual(["MISSING_SNAPSHOT"]);
        expect(run.errors[0].message).toContain("second");
        expect(await columns()).toEqual(before);
      }, 300_000);

      it("stops where the rows are as migrate left them, too", async () => {
        await migrated(SECOND, "second");
        await entry();
        rmSync(metaDir(), { recursive: true });
        const run = await repair(SECOND, false);
        expect(run.codes, JSON.stringify(run)).toEqual(["MISSING_SNAPSHOT"]);
        expect(run.exitCode).toBe(1);
      }, 300_000);

      it.each([
        ["as last migrated", false],
        ["changed since, and put back first", true],
      ] as const)(
        "its second way, a migration written and applied, leaves nothing to report (configuration %s)",
        async (_, changed) => {
          await migrated(FIRST, "first");
          await migrated(SECOND, "second");
          await entry();
          await scriptStart(ELSEWHERE);
          rmSync(metaDir(), { recursive: true });
          const before = await columns();
          // As the refusal prints it: with the configuration as it was at the last
          // `nextly migrate`, `nextly migrate:create`, then `nextly migrate`.
          await migrated(SECOND, "record");
          const run = await repair(SECOND, true);
          expect(run.codes, JSON.stringify(run)).toEqual([]);
          expect(converting(run.outcomes), JSON.stringify(run)).toEqual([]);
          expect(await columns()).toEqual(before);
          if (!changed) return;
          // The change made since is then a migration of its own, as any is.
          await migrated(ELSEWHERE, "change");
          const after = await repair(ELSEWHERE, false);
          expect(after.codes, JSON.stringify(after)).toEqual([]);
          expect(after.outcomes).toEqual([]);
        },
        300_000
      );

      it("control: its second way is refused where the configuration changed since and was not put back", async () => {
        // Why the advice names the configuration it needs: written from a changed one, the
        // migration describes tables the database does not have.
        await migrated(SECOND, "second");
        await entry();
        rmSync(metaDir(), { recursive: true });
        await expect(migrated(ELSEWHERE, "record")).rejects.toThrow(/drift/i);
      }, 300_000);

      it("control: with the snapshots there, a seed script's row converts nothing", async () => {
        await migrated(FIRST, "first");
        await migrated(SECOND, "second");
        await entry();
        await scriptStart(ELSEWHERE);
        const before = await columns();
        const run = await repair(ELSEWHERE, true);
        expect(run.codes).toEqual([]);
        expect(converting(run.outcomes), JSON.stringify(run)).toEqual([]);
        expect(await columns()).toEqual(before);
      }, 300_000);
    });

    describe("snapshots that record no entities, and no registry record yet", () => {
      /** Migrated, then as an earlier release left it: old snapshots and no record. */
      async function earlierProject(): Promise<void> {
        await migrated(SECOND, "second");
        await entry();
        for (const file of snapshots()) asEarlierRelease(file);
        await withoutRegistryRecord();
      }

      it("goes on, saying once on standard error that the registry stands in, and keeps --json clean", async () => {
        await earlierProject();
        for (const apply of [false, true]) {
          const run = await repair(SECOND, apply);
          expect(run.codes, JSON.stringify(run)).toEqual([]);
          expect(run.exitCode).toBe(0);
          expect(run.outcomes).toEqual([]);
          expect(run.stderr).toEqual([REGISTRY_STANDS_IN_NOTICE]);
        }
      }, 300_000);

      it("says it once on standard error without --json, and nothing under --quiet", async () => {
        await earlierProject();
        const plain = await plainRun(SECOND, {});
        expect(
          plain.stderr.filter(line => line === REGISTRY_STANDS_IN_NOTICE)
        ).toHaveLength(1);
        expect(plain.stdout).not.toContain(REGISTRY_STANDS_IN_NOTICE);
        const quiet = await plainRun(SECOND, { quiet: true });
        expect([...quiet.stdout, ...quiet.stderr]).not.toContain(
          REGISTRY_STANDS_IN_NOTICE
        );
      }, 300_000);

      it("cannot take a configuration changed since into the record: nextly migrate, as advised, refuses it first", async () => {
        // The baseline that first run keeps is written from the configuration; one that changes a
        // table no migration records is refused before anything is written.
        await earlierProject();
        state.config = configOf(ELSEWHERE);
        tick();
        await expect(
          runMigrate({ cwd: state.dir, throwOnFailure: true }, context())
        ).rejects.toThrow();
        const run = await repair(ELSEWHERE, false);
        expect(run.stderr).toEqual([REGISTRY_STANDS_IN_NOTICE]);
      }, 300_000);

      it("control: says nothing where the database has its registry record", async () => {
        await migrated(SECOND, "second");
        await entry();
        const run = await repair(SECOND, false);
        expect(run.exitCode).toBe(0);
        expect(run.stderr.filter(line => /registry/i.test(line))).toEqual([]);
      }, 300_000);

      it("control: says nothing where no migration was applied (db:sync only)", async () => {
        state.config = configOf(SECOND);
        await succeeds(() =>
          runDbSync({ cwd: state.dir, autoSync: true } as never, context())
        );
        const run = await repair(SECOND, false);
        expect(run.stderr.filter(line => /registry/i.test(line))).toEqual([]);
      }, 300_000);
    });

    describe("snapshots that record no entities, migrated since by this release", () => {
      /**
       * As an earlier release's project stands once `nextly migrate` of this one has run: its
       * snapshots record no entities, so that run wrote the rows from the configuration and kept
       * them as the registry record's baseline.
       */
      async function migratedEarlierProject(): Promise<void> {
        await migrated(SECOND, "second");
        await entry();
        for (const file of snapshots()) asEarlierRelease(file);
        await withoutRegistryRecord();
        tick();
        await succeeds(() =>
          runMigrate({ cwd: state.dir, throwOnFailure: true }, context())
        );
      }

      const pending = (outcomes: readonly string[]) =>
        outcomes.filter(o => o.endsWith("pending-migration"));

      it("converts nothing after a seed script rewrote the row, and reports its columns pending", async () => {
        await migratedEarlierProject();
        await scriptStart(ELSEWHERE);
        const before = await columns();
        for (const apply of [false, true]) {
          const run = await repair(ELSEWHERE, apply);
          expect(run.codes, JSON.stringify(run)).toEqual([]);
          expect(converting(run.outcomes), JSON.stringify(run)).toEqual([]);
          expect(pending(run.outcomes)).toContain("author pending-migration");
        }
        expect(await columns()).toEqual(before);
      }, 300_000);

      it("converts nothing after db:sync moved the row and the table on", async () => {
        await migratedEarlierProject();
        state.config = configOf(ELSEWHERE);
        await succeeds(() =>
          runDbSync({ cwd: state.dir, autoSync: true } as never, context())
        );
        const before = await columns();
        const run = await repair(ELSEWHERE, true);
        expect(run.codes, JSON.stringify(run)).toEqual([]);
        expect(converting(run.outcomes), JSON.stringify(run)).toEqual([]);
        expect(await columns()).toEqual(before);
      }, 300_000);

      it("reports an entity the baseline does not hold as pending, converting nothing", async () => {
        await migratedEarlierProject();
        // db:sync after the record: a collection no migration made.
        state.config = configOf({ ...SECOND, extra: true });
        await succeeds(() =>
          runDbSync({ cwd: state.dir, autoSync: true } as never, context())
        );
        const run = await repair(
          { ...SECOND, extra: true },
          true,
          "dc_rsh_notes"
        );
        expect(run.codes, JSON.stringify(run)).toEqual([]);
        expect(converting(run.outcomes)).toEqual([]);
        expect(run.outcomes, JSON.stringify(run)).toContain(
          "body pending-migration"
        );
      }, 300_000);

      it("control: reports nothing where the rows are as that migrate left them", async () => {
        await migratedEarlierProject();
        const run = await repair(SECOND, true);
        expect(run.codes, JSON.stringify(run)).toEqual([]);
        expect(run.exitCode).toBe(0);
        expect(run.outcomes).toEqual([]);
      }, 300_000);
    });

    describe("the newest applied snapshot records no entities, an older one does", () => {
      it.each([
        ["with the registry record", false],
        ["before this release's migrate", true],
      ] as const)(
        "stops naming the file and the way out, and converts nothing (%s)",
        async (_, noRecord) => {
          await migrated(FIRST, "first");
          await migrated(SECOND, "second");
          await entry();
          const newest = snapshots().at(-1)!;
          asEarlierRelease(newest);
          if (noRecord) await withoutRegistryRecord();
          const before = await columns();

          for (const apply of [false, true]) {
            const run = await repair(SECOND, apply);
            expect(run.codes, JSON.stringify(run)).toEqual([
              NEWEST_WITHOUT_RECORD,
            ]);
            expect(run.exitCode).toBe(1);
            expect(converting(run.outcomes)).toEqual([]);
            const [refusal] = run.errors;
            expect(refusal.message).toContain(
              newest.replace(/\.snapshot\.json$/, "")
            );
            expect(refusal.next).toContain("nextly migrate:create");
            expect(refusal.next).toContain("nextly migrate");
          }
          expect(await columns()).toEqual(before);
        },
        300_000
      );

      it("leaves nothing to report once its way out is taken as printed", async () => {
        await migrated(FIRST, "first");
        await migrated(SECOND, "second");
        await entry();
        asEarlierRelease(snapshots().at(-1)!);
        // The way out: a migration this release writes, then `nextly migrate`.
        await migrated(SECOND, "record");
        const before = await columns();
        const run = await repair(SECOND, true);
        expect(run.codes, JSON.stringify(run)).toEqual([]);
        expect(run.exitCode).toBe(0);
        expect(run.outcomes).toEqual([]);
        expect(await columns()).toEqual(before);
      }, 300_000);
    });
  }
);
