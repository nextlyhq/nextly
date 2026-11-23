/**
 * `nextly migrate` tells a site once which reads its visitors lost to the
 * Public role only where they really lost them, on every configured dialect.
 *
 * Two earlier states of a database, each left by a first run of the command
 * driven as the earlier release left it:
 *
 * - Migrated, but never started, by 0.0.2-alpha.75: its `nextly migrate` made
 *   the preset roles and recorded the release that set their grants
 *   (`preset_grants_release`), but did not make the Public role or decide the
 *   notice. Every release that writes the record judges visitors by the
 *   Public role, so they could not read a collection with no read rule before
 *   the upgrade either: the upgrade's run tells nothing, and records the
 *   notice not due.
 * - Seeded by a release from before the Public role: the preset roles made by
 *   its start, no record, no Public role, no notice decided. Its visitors read
 *   a collection with no read rule, and after the upgrade's run do not: that
 *   run tells it once, naming that collection and not one whose rule lets
 *   anyone read.
 *
 * The commands are driven themselves (`runMigrateCreate`, `runMigrate`); only
 * the config file is not read from disk.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { PUBLIC_READ_NOTICE_META_KEY } from "../../../domains/auth/services/public-read-grant";
import { PUBLIC_ROLE_SLUG } from "../../../domains/auth/services/public-role";
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

/**
 * The earlier release a run is driven as, if any:
 * - `migrated-by-alpha-75`: `nextly migrate` of 0.0.2-alpha.75, which made the
 *   preset roles and recorded the release, and neither made the Public role
 *   nor decided the notice;
 * - `seeded-before-public-role`: a release whose start made the preset roles,
 *   with no Public role, no notice decided and no record of the release.
 */
type Earlier = "migrated-by-alpha-75" | "seeded-before-public-role";

const state = vi.hoisted(() => ({
  config: undefined as unknown,
  release: "0.0.2-alpha.81",
  earlier: undefined as
    | "migrated-by-alpha-75"
    | "seeded-before-public-role"
    | undefined,
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

/** An earlier release did not decide the notice. */
vi.mock(
  "../../../domains/auth/services/public-read-grant",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/auth/services/public-read-grant")
      >();
    return {
      ...original,
      recordPublicReadNotice: async (
        ...args: Parameters<typeof original.recordPublicReadNotice>
      ) => {
        if (state.earlier !== undefined) return;
        await original.recordPublicReadNotice(...args);
      },
    };
  }
);

/** An earlier release did not make the Public role. */
vi.mock("../../../domains/auth/services/public-role", async importOriginal => {
  const original =
    await importOriginal<
      typeof import("../../../domains/auth/services/public-role")
    >();
  return {
    ...original,
    seedPublicRole: async (
      ...args: Parameters<typeof original.seedPublicRole>
    ) => {
      if (state.earlier !== undefined) {
        return { made: false as const, retryAt: Date.now() + 60_000 };
      }
      return original.seedPublicRole(...args);
    },
  };
});

/** A release from before the record did not write it. */
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
      if (state.earlier === "seeded-before-public-role") return;
      await original.recordPresetGrantsRelease(...args);
    },
  };
});

const CONFIG = defineConfig({
  collections: [
    // No read rule: visitors read it only before the Public role judged them.
    defineCollection({
      slug: "categories",
      fields: [text({ name: "name" })],
    }),
    // Anyone may read it, before the upgrade and after.
    defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
      access: { read: () => true },
    }),
  ],
  db: { migrationsDir: "./migrations" },
});

/** The once-only notice's opening sentence. */
const NOTICE = "Before this upgrade they could read these";

describe.each(getConfiguredTestDialects())(
  "nextly migrate tells a site of the reads its visitors lost only where they lost them (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-public-read-notice-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_public_read_notice"
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
      state.earlier = undefined;
    }, 60_000);

    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      state.earlier = undefined;
      await drop();
      rmSync(dir, { recursive: true, force: true });
    });

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
      const { context, said } = command();
      setNonInteractive(true);
      const code = await exiting(() =>
        runMigrateCreate("initial", { cwd: dir }, context)
      ).finally(() => setNonInteractive(false));
      expect(code, said.join("\n")).toBeUndefined();
    }

    /** `nextly migrate`, as `earlier` where given, else as this release: its output. */
    async function migrate(earlier?: Earlier): Promise<string[]> {
      state.earlier = earlier;
      state.release =
        earlier === "migrated-by-alpha-75" ? "0.0.2-alpha.75" : "0.0.2-alpha.81";
      state.config = CONFIG;
      const { context, said } = command();
      try {
        const code = await exiting(() => runMigrate({ cwd: dir }, context));
        expect(code, said.join("\n")).toBeUndefined();
      } finally {
        state.earlier = undefined;
      }
      return said;
    }

    async function withAdapter<T>(
      fn: (adapter: DrizzleAdapter, meta: MetaService) => Promise<T>
    ): Promise<T> {
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      try {
        const logger = {
          debug() {},
          info() {},
          warn() {},
          error() {},
        } as unknown as ConstructorParameters<typeof MetaService>[1];
        return await fn(adapter, new MetaService(adapter, logger));
      } finally {
        await adapter.disconnect();
      }
    }

    /** The slugs of the roles stored. */
    async function roleSlugs(): Promise<string[]> {
      return withAdapter(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT ${q}slug${q} AS slug FROM ${q}roles${q}`
        );
        return rows.map(row => String(row.slug)).sort();
      });
    }

    /** The permission slugs the Public role holds. */
    async function publicHolds(): Promise<string[]> {
      return withAdapter(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT p.${q}slug${q} AS slug FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q} WHERE r.${q}slug${q} = '${PUBLIC_ROLE_SLUG}'`
        );
        return rows.map(row => String(row.slug)).sort();
      });
    }

    /** The notice's recorded state, and the release recorded with the preset grants. */
    async function recorded(): Promise<{
      notice: unknown;
      release: string | undefined;
    }> {
      return withAdapter(async (_adapter, meta) => ({
        notice: await meta.get<unknown>(PUBLIC_READ_NOTICE_META_KEY),
        release: await readPresetGrantsRelease(meta),
      }));
    }

    const notices = (said: readonly string[]) =>
      said.filter(line => line.includes(NOTICE));

    it("tells a database migrated but never started by 0.0.2-alpha.75 nothing of reads lost", async () => {
      await migrateCreate();
      await migrate("migrated-by-alpha-75");
      // The state that release's `nextly migrate` left: the preset roles and
      // the record, and no Public role or notice decided.
      const slugs = await roleSlugs();
      expect(slugs).toEqual(
        expect.arrayContaining(["admin", "author", "editor", "viewer"])
      );
      expect(slugs).not.toContain(PUBLIC_ROLE_SLUG);
      expect(await recorded()).toEqual({
        notice: null,
        release: "0.0.2-alpha.75",
      });

      const said = await migrate();

      expect(notices(said), said.join("\n")).toEqual([]);
      expect((await recorded()).notice).toBe("not-due");
      // The run reached the Public role's steps: the role is made, and
      // granted the read anyone may make, and not the one with no rule.
      const held = await publicHolds();
      expect(held).toContain("read-posts");
      expect(held).not.toContain("read-categories");

      // Nor at a later run.
      expect(notices(await migrate())).toEqual([]);
    }, 240_000);

    it("tells a database seeded before the Public role, once, which reads its visitors lost", async () => {
      await migrateCreate();
      await migrate("seeded-before-public-role");
      const slugs = await roleSlugs();
      expect(slugs).toEqual(
        expect.arrayContaining(["admin", "author", "editor", "viewer"])
      );
      expect(slugs).not.toContain(PUBLIC_ROLE_SLUG);
      expect(await recorded()).toEqual({ notice: null, release: undefined });

      const said = await migrate();

      // Visitors read "categories" before, and the Public role does not hold
      // its read now; "posts" they read before and after.
      const held = await publicHolds();
      expect(held).toContain("read-posts");
      expect(held).not.toContain("read-categories");
      expect(notices(said), said.join("\n")).toHaveLength(1);
      const [notice] = notices(said);
      expect(notice).toContain('collection "categories" (no read rule)');
      expect(notice).not.toContain('"posts"');
      expect((await recorded()).notice).toBe("shown");

      // Once only.
      expect(notices(await migrate())).toEqual([]);
    }, 240_000);
  }
);
