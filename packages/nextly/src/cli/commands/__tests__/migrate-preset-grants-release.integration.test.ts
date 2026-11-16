/**
 * `nextly migrate` records the Nextly release that set the preset roles'
 * grants, keeping the newest, and a run from an older release leaves every
 * preset grant as the newer one set it, on every configured dialect.
 *
 * Two releases are told apart by the version `nextly migrate` reads
 * (`getCoreVersion`) and by their presets, which resolve the same
 * permissions differently: the older one (0.9.0) has the viewer preset also
 * grant `export-pgr-posts`, a grant the newer one withholds, and the newer
 * one (0.10.0) has the author preset also grant `delete-pgr-posts`, a grant
 * the older one withholds. `0.10.0` is newer than `0.9.0` only by semantic
 * version, not as text. Both run over the same app migrations.
 *
 * The database starts empty: a scratch database on PostgreSQL and MySQL, a new
 * file on SQLite. The commands are driven themselves (`runMigrateCreate`,
 * `runMigrate`); only the config file is not read from disk.
 *
 * - The record after a run from one release, then a newer one, then the
 *   first again, names the first, then the newer, then still the newer.
 * - A run from the older release after the newer one leaves every role's
 *   grant rows as they were, row for row, and says which release set them.
 * - A run from the newer release whose preset step fails between two preset
 *   roles' replacements, just before the record is written, or just after it
 *   and before the transaction commits, leaves every role's grants and the
 *   record as the older release left them, says so, and finishes the rest of
 *   its run.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  ROLE_PRESETS,
  resolvePreset,
  type RolePreset,
} from "../../../auth/role-presets";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { RolePermissionService } from "../../../domains/auth/services/role-permission-service";
import { readPresetGrantsRelease } from "../../../domains/meta/preset-grants-release";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, the release they run as, and the failure injected. */
const state = vi.hoisted(() => ({
  config: undefined as unknown,
  release: "0.9.0",
  /** Where the next recording of the release fails, if anywhere. */
  failRecord: undefined as "before" | "after" | undefined,
  /** How many times an injected failure was reached. */
  injected: 0,
}));

vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
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

/** The release `nextly migrate` runs as. */
vi.mock("../../../plugins/core-version", () => ({
  getCoreVersion: () => state.release,
}));

/** The record's write, failing just before or just after it where asked. */
vi.mock("../../../domains/meta/preset-grants-release", async importOriginal => {
  const original =
    await importOriginal<
      typeof import("../../../domains/meta/preset-grants-release")
    >();
  return {
    ...original,
    recordPresetGrantsRelease: async (
      ...args: Parameters<typeof original.recordPresetGrantsRelease>
    ) => {
      const at = state.failRecord;
      if (at === "before") {
        state.injected += 1;
        throw new Error("stopped just before the record is written");
      }
      await original.recordPresetGrantsRelease(...args);
      if (at === "after") {
        state.injected += 1;
        throw new Error("stopped just after the record is written");
      }
    },
  };
});

const OLD = "0.9.0";
const NEW = "0.10.0";

const CONFIG = defineConfig({
  collections: [
    defineCollection({ slug: "pgr-posts", fields: [text({ name: "title" })] }),
  ],
  // The app's own permission, which only the older release's viewer grants.
  permissions: [{ action: "export", resource: "pgr-posts" }],
  db: { migrationsDir: "./migrations" },
});

/** The presets' own rules, put back after each test. */
const original = new Map<string, RolePreset["grants"]>();

function preset(slug: string): RolePreset {
  const found = ROLE_PRESETS.find(p => p.slug === slug);
  if (!found) throw new Error(`no preset ${slug}`);
  return found;
}

/** Run as `release`, with its presets. */
function runAs(release: typeof OLD | typeof NEW): void {
  state.release = release;
  const viewer = original.get("viewer")!;
  const author = original.get("author")!;
  preset("viewer").grants =
    release === OLD
      ? (p, c) =>
          viewer(p, c) || (p.action === "export" && p.resource === "pgr-posts")
      : viewer;
  preset("author").grants =
    release === NEW
      ? (p, c) =>
          author(p, c) || (p.action === "delete" && p.resource === "pgr-posts")
      : author;
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate records the release that set the preset grants (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeAll(() => {
      for (const p of ROLE_PRESETS) original.set(p.slug, p.grants);
    });

    afterAll(() => {
      for (const p of ROLE_PRESETS) p.grants = original.get(p.slug)!;
    });

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-preset-release-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_preset_release"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, 0, 0)));
      state.failRecord = undefined;
      state.injected = 0;
    }, 60_000);

    afterEach(async () => {
      vi.restoreAllMocks();
      for (const p of ROLE_PRESETS) p.grants = original.get(p.slug)!;
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(dir, { recursive: true, force: true });
    });

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 11, 12, 0, clock, 0)));
    }

    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
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

    async function migrateCreate(): Promise<void> {
      state.config = CONFIG;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate("initial", { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate` from `release`: its exit code (undefined when it succeeded) and output. */
    async function migrate(
      release: typeof OLD | typeof NEW
    ): Promise<{ code: number | undefined; said: string[] }> {
      runAs(release);
      state.config = CONFIG;
      tick();
      const { context, said } = command();
      const code = await exiting(() => runMigrate({ cwd: dir }, context));
      return { code, said };
    }

    async function migrateOk(
      release: typeof OLD | typeof NEW
    ): Promise<string[]> {
      const { code, said } = await migrate(release);
      expect(code, said.join("\n")).toBeUndefined();
      return said;
    }

    async function open(): Promise<DrizzleAdapter> {
      return (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
    }

    /** The recorded release, read on the test's own connection. */
    async function recorded(): Promise<string | undefined> {
      const adapter = await open();
      try {
        const logger = {
          debug() {},
          info() {},
          warn() {},
          error() {},
        } as unknown as ConstructorParameters<typeof MetaService>[1];
        return await readPresetGrantsRelease(new MetaService(adapter, logger));
      } finally {
        await adapter.disconnect();
      }
    }

    /** Every grant row of every role, as `<row id> <role> <permission>`, sorted. */
    async function grantRows(): Promise<string[]> {
      const adapter = await open();
      try {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT rp.${q}id${q} AS id, r.${q}slug${q} AS role, p.${q}slug${q} AS permission FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q}`
        );
        return rows
          .map(
            row =>
              `${String(row.id)} ${String(row.role)} ${String(row.permission)}`
          )
          .sort();
      } finally {
        await adapter.disconnect();
      }
    }

    /** The permission slugs `role` holds, read from `rows`. */
    function held(rows: readonly string[], role: string): string[] {
      return rows
        .map(row => row.split(" "))
        .filter(([, r]) => r === role)
        .map(([, , permission]) => permission)
        .sort();
    }

    it("records the newest release that set the grants", async () => {
      await migrateCreate();

      await migrateOk(OLD);
      expect(await recorded()).toBe(OLD);

      await migrateOk(NEW);
      expect(await recorded()).toBe(NEW);

      // The older release again: the newer one stays recorded.
      await migrateOk(OLD);
      expect(await recorded()).toBe(NEW);
    }, 240_000);

    it("leaves every preset grant as the newer release set it, and says which release set them", async () => {
      await migrateCreate();
      await migrateOk(NEW);
      const before = await grantRows();
      // The newer release's grants: the author's delete, and no viewer export.
      expect(held(before, "author")).toContain("delete-pgr-posts");
      expect(held(before, "viewer")).not.toContain("export-pgr-posts");

      // The control: the older release's presets resolve these same
      // permissions differently, both ways.
      runAs(OLD);
      const stored = before
        .map(row => row.split(" ")[2])
        .map(slug => {
          const [action, ...rest] = slug.split("-");
          return { action, resource: rest.join("-"), owner: null };
        });
      const olderViewer = resolvePreset(preset("viewer"), stored).map(
        p => `${p.action}-${p.resource}`
      );
      const olderAuthor = resolvePreset(preset("author"), stored).map(
        p => `${p.action}-${p.resource}`
      );
      expect(olderViewer).toContain("export-pgr-posts");
      expect(olderAuthor).not.toContain("delete-pgr-posts");

      const said = await migrateOk(OLD);

      // Row for row, ids included: nothing added, removed or rewritten.
      expect(await grantRows()).toEqual(before);
      expect(await recorded()).toBe(NEW);
      const notice = said.find(line => line.includes(`Nextly ${NEW}`));
      expect(notice, said.join("\n")).toContain(OLD);
      expect(notice).toContain("left as they were");
      // The rest of the run goes on to its end.
      expect(said.join("\n")).toMatch(/migrate completed/);
    }, 240_000);

    it("leaves every role's grants and the record as they were when a newer release's run stops part-way", async () => {
      await migrateCreate();
      await migrateOk(OLD);
      const older = await grantRows();
      expect(await recorded()).toBe(OLD);
      expect(held(older, "viewer")).toContain("export-pgr-posts");
      expect(held(older, "author")).not.toContain("delete-pgr-posts");

      // Between two preset roles' replacements: the viewer's, after the
      // author's has been made on the same transaction.
      const replace = RolePermissionService.prototype.replaceRolePermissionsOn;
      let replaced = 0;
      let changedFirst = false;
      const spy = vi
        .spyOn(RolePermissionService.prototype, "replaceRolePermissionsOn")
        .mockImplementation(async function (
          this: RolePermissionService,
          ...args: Parameters<typeof replace>
        ) {
          replaced += 1;
          if (replaced === ROLE_PRESETS.length) {
            state.injected += 1;
            throw new Error("stopped between two preset roles");
          }
          const changed = await replace.apply(this, args);
          changedFirst ||= changed;
          return changed;
        });
      const between = await migrateOk(NEW);
      spy.mockRestore();
      expect(state.injected).toBe(1);
      expect(between.join("\n")).toMatch(
        /preset roles' grants were not set, so none of them changed: stopped between two preset roles/
      );
      // The control: a replacement before the failure did change grants.
      expect(changedFirst).toBe(true);
      expect(await grantRows()).toEqual(older);
      expect(await recorded()).toBe(OLD);

      for (const at of ["before", "after"] as const) {
        state.failRecord = at;
        const stopped = await migrateOk(NEW);
        state.failRecord = undefined;
        expect(stopped.join("\n")).toMatch(
          new RegExp(`none of them changed: stopped just ${at} the record`)
        );
        expect(await grantRows()).toEqual(older);
        expect(await recorded()).toBe(OLD);
      }
      expect(state.injected).toBe(3);

      // A run that finishes sets the newer release's grants and records it.
      await migrateOk(NEW);
      const newer = await grantRows();
      expect(held(newer, "viewer")).not.toContain("export-pgr-posts");
      expect(held(newer, "author")).toContain("delete-pgr-posts");
      expect(await recorded()).toBe(NEW);

      // The older release's run after it leaves them.
      await migrateOk(OLD);
      expect(await grantRows()).toEqual(newer);
      expect(await recorded()).toBe(NEW);
    }, 300_000);
  }
);
