/**
 * `nextly migrate` writes the permissions and grants from the migrations, and
 * `migrate:down` to a point whose own snapshot records them undoes only the
 * rolled-back migrations' own changes to the permissions, adding and removing
 * no grant. On every configured dialect.
 *
 * The database starts empty: a scratch database on PostgreSQL and MySQL, a new
 * file on SQLite. Nothing boots against it; the commands are driven
 * themselves, and only the config file is not read from disk.
 *
 * - A plugin release that only adds a permission is applied as a recorded
 *   migration: the admin role holds it before any start, `migrate:status`
 *   lists it, and a second run writes nothing. An unrelated settings-only
 *   migration and its rollback leave it live and granted.
 * - Rolling back that permission-only migration orphans the permission with
 *   its grants kept, though the plugin's configured release still declares it:
 *   the point's snapshot speaks for the plugin.
 * - Rolling back a migration that added a collection orphans its permissions.
 * - Rolling back a migration that orphaned an app permission clears its mark.
 * - A plugin installed after the newest snapshot, before the rolled-back
 *   migration, keeps its permissions and every grant.
 * - A declared permission orphaned by hand is restored by the next run.
 * - Before the registry record exists, a rollback between two migrations
 *   whose snapshots predate the registry metadata changes no orphan mark.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { NextlyError } from "../../../errors";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
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
import { runMigrateDown } from "../migrate-down";
import { runMigrateStatus } from "../migrate-status";
import { runPluginInstall } from "../plugin-lifecycle-runner";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

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
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      };
    },
  };
});

/** A plugin `name` at `version` declaring `permissions`, each `[action, resource]`. */
function plugin(
  name: string,
  version: string,
  ...permissions: [action: string, resource: string][]
): PluginDefinition {
  return definePlugin({
    name,
    version,
    nextly: "*",
    contributes: {
      permissions: permissions.map(([action, resource]) => ({
        action,
        resource,
      })),
    },
  });
}

const SEO_V1 = plugin("@test/mdp-seo", "1.0.0", ["read", "mdp-seo"]);
/** Its next release, which only adds a permission. */
const SEO_V2 = plugin(
  "@test/mdp-seo",
  "1.1.0",
  ["read", "mdp-seo"],
  ["audit", "mdp-seo"]
);
/** A plugin installed after the newest snapshot. */
const LATE = plugin("@test/mdp-late", "1.0.0", ["sync", "mdp-late"]);

/** A config of the posts collection described as `description`, `extra` collections, the app's `permissions` and `plugins`. */
function config(
  parts: {
    description?: string;
    extra?: string[];
    permissions?: [action: string, resource: string][];
    plugins?: PluginDefinition[];
  } = {}
) {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "mdp-posts",
        description: parts.description ?? "Posts",
        fields: [text({ name: "title" })],
      }),
      ...(parts.extra ?? []).map(slug =>
        defineCollection({ slug, fields: [text({ name: "body" })] })
      ),
    ],
    permissions: (parts.permissions ?? []).map(([action, resource]) => ({
      action,
      resource,
    })),
    plugins: parts.plugins ?? [],
    db: { migrationsDir: "./migrations" },
  });
}

describe.each(getConfiguredTestDialects())(
  "migrate and migrate:down write the permissions from the migrations (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-migrate-down-perms-"));
      mkdirSync(join(state.dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "empty.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_mdp");
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
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0, 0)));
    }, 60_000);

    afterEach(async () => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    });

    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, clock, 0)));
    }

    /** A command's context, with everything it says captured. */
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
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    function messageOf(error: unknown): string {
      return NextlyError.is(error)
        ? error.publicMessage
        : String((error as Error).message);
    }

    /** `nextly migrate:create --non-interactive` with `cfg`, which must succeed. */
    async function migrateCreate(cfg: unknown): Promise<void> {
      state.config = cfg;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      try {
        await runMigrateCreate(`step${clock}`, { cwd: state.dir }, context);
      } catch (error) {
        throw new Error(
          `migrate:create failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      } finally {
        setNonInteractive(false);
      }
    }

    /** `nextly migrate` with `cfg`, which must succeed; what it said. */
    async function migrate(cfg: unknown): Promise<string[]> {
      state.config = cfg;
      tick();
      const { context, said } = command();
      try {
        await runMigrate({ cwd: state.dir, throwOnFailure: true }, context);
      } catch (error) {
        throw new Error(
          `migrate failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      }
      return said;
    }

    /** `nextly migrate:down --step 1` with `cfg`, which must succeed; what it said. */
    async function migrateDown(
      cfg: unknown,
      dryRun = false
    ): Promise<string[]> {
      state.config = cfg;
      tick();
      const { context, said } = command();
      setNonInteractive(true);
      try {
        await runMigrateDown(
          { cwd: state.dir, step: 1, acceptDataLoss: true, dryRun },
          context
        );
      } catch (error) {
        throw new Error(
          `migrate:down failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      } finally {
        setNonInteractive(false);
      }
      return said;
    }

    /** With a connection of the test's own, closed after. */
    async function on<T>(fn: (adapter: DrizzleAdapter) => Promise<T>) {
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    /** Every permission's slug, by whether it is marked orphaned. */
    async function marks(): Promise<Record<string, boolean>> {
      return on(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT ${q}slug${q} AS slug, ${q}orphaned_at${q} AS orphaned FROM ${q}permissions${q}`
        );
        return Object.fromEntries(
          rows.map(row => [String(row.slug), row.orphaned != null])
        );
      });
    }

    /** The slugs of the permissions marked orphaned, sorted. */
    async function orphaned(): Promise<string[]> {
      return Object.entries(await marks())
        .filter(([, marked]) => marked)
        .map(([slug]) => slug)
        .sort();
    }

    /** Every grant, as `role:permission`, sorted. */
    async function grants(): Promise<string[]> {
      return on(async adapter => {
        const rows = await adapter.executeQuery<Record<string, unknown>>(
          `SELECT r.${q}slug${q} AS role, p.${q}slug${q} AS permission FROM ${q}role_permissions${q} rp JOIN ${q}roles${q} r ON r.${q}id${q} = rp.${q}role_id${q} JOIN ${q}permissions${q} p ON p.${q}id${q} = rp.${q}permission_id${q}`
        );
        return rows
          .map(row => `${String(row.role)}:${String(row.permission)}`)
          .sort();
      });
    }

    /** The lines that say a permission's orphan mark changed. */
    const markLines = (said: readonly string[]) =>
      said.filter(line => /orphan mark cleared|marked orphaned/.test(line));

    it("applies a plugin's permission-only release as a recorded migration, and keeps it live across an unrelated migration's rollback", async () => {
      await migrateCreate(config({ plugins: [SEO_V1] }));
      await migrate(config({ plugins: [SEO_V1] }));

      // The plugin's next release only adds a permission: a migration with no
      // table statements records it.
      const v2 = config({ plugins: [SEO_V2] });
      await migrateCreate(v2);
      await migrate(v2);
      expect(await marks()).toMatchObject({ "audit-mdp-seo": false });
      expect(await grants()).toContain("admin:audit-mdp-seo");
      const settled = { marks: await marks(), grants: await grants() };

      // `migrate:status` lists it applied, and a second run writes nothing.
      state.config = v2;
      const status = command();
      await runMigrateStatus({ cwd: state.dir, json: true }, status.context);
      expect(status.said.join("\n")).not.toMatch(/"pending":\s*\[\s*\{/);
      const again = await migrate(v2);
      expect(markLines(again)).toEqual([]);
      expect({ marks: await marks(), grants: await grants() }).toEqual(settled);

      // An unrelated settings-only migration, then its rollback: the
      // permission stays live and the admin holds it after each.
      const described = config({ description: "All posts", plugins: [SEO_V2] });
      await migrateCreate(described);
      await migrate(described);
      expect({ marks: await marks(), grants: await grants() }).toEqual(settled);
      await migrateDown(described);
      expect({ marks: await marks(), grants: await grants() }).toEqual(settled);
    }, 300_000);

    it("orphans, with its grants, the permission a rolled-back permission-only migration added, though the configured release declares it", async () => {
      await migrateCreate(config({ plugins: [SEO_V1] }));
      await migrate(config({ plugins: [SEO_V1] }));
      const v2 = config({ plugins: [SEO_V2] });
      await migrateCreate(v2);
      await migrate(v2);
      const before = await grants();
      expect(before).toContain("admin:audit-mdp-seo");

      // A dry run says the marks would be undone, and changes nothing.
      const marked = await marks();
      const preview = await migrateDown(v2, true);
      expect(preview.join("\n")).toMatch(
        /permission orphan marks would go back to what .* records, every grant kept/
      );
      expect(await marks()).toEqual(marked);

      // The build that rolls back still carries the release with the permission.
      const said = await migrateDown(v2);

      expect(await orphaned()).toEqual(["audit-mdp-seo"]);
      expect(await grants()).toEqual(before);
      expect(markLines(said)).toEqual([
        expect.stringMatching(
          /^Permission "audit-mdp-seo" .*marked orphaned\. Its grants are kept/
        ),
      ]);
    }, 300_000);

    it("orphans the permissions of a collection a rolled-back migration added, keeping their grants", async () => {
      await migrateCreate(config());
      await migrate(config());
      const added = config({ extra: ["mdp-notes"] });
      await migrateCreate(added);
      await migrate(added);
      const before = await grants();
      const notes = Object.keys(await marks()).filter(slug =>
        slug.endsWith("-mdp-notes")
      );
      expect(notes.length).toBeGreaterThan(0);

      await migrateDown(added);

      expect(await orphaned()).toEqual(notes.sort());
      expect(await grants()).toEqual(before);
    }, 300_000);

    it("clears the mark a rolled-back migration set on an app permission, with its grants as they were", async () => {
      const declaring = config({ permissions: [["export", "mdp-posts"]] });
      await migrateCreate(declaring);
      await migrate(declaring);
      const before = await grants();
      expect(before).toContain("admin:export-mdp-posts");

      // A migration that stops declaring it orphans it.
      await migrateCreate(config());
      await migrate(config());
      expect(await orphaned()).toEqual(["export-mdp-posts"]);

      await migrateDown(config());

      expect(await orphaned()).toEqual([]);
      expect(await grants()).toEqual(before);
    }, 300_000);

    it("leaves the permissions of a plugin installed after the point, before the rolled-back migration, and every grant", async () => {
      await migrateCreate(config());
      await migrate(config());
      // Installed after the newest snapshot: its install writes its access.
      const withLate = config({ plugins: [LATE] });
      state.config = withLate;
      tick();
      await runPluginInstall(LATE.name, {}, command().context);
      expect(await marks()).toMatchObject({ "sync-mdp-late": false });

      // A migration that records it, with a collection, then rolled back.
      const added = config({ extra: ["mdp-notes"], plugins: [LATE] });
      await migrateCreate(added);
      await migrate(added);
      const before = await grants();
      expect(before).toContain("admin:sync-mdp-late");

      await migrateDown(added);

      expect(await marks()).toMatchObject({ "sync-mdp-late": false });
      expect(
        (await orphaned()).filter(slug => !slug.endsWith("-mdp-notes"))
      ).toEqual([]);
      expect(await grants()).toEqual(before);
    }, 300_000);

    it("restores a declared permission orphaned by hand, even with no migration pending", async () => {
      const declaring = config({ permissions: [["export", "mdp-posts"]] });
      await migrateCreate(declaring);
      await migrate(declaring);
      const before = await grants();
      await on(adapter =>
        adapter.executeQuery(
          `UPDATE ${q}permissions${q} SET ${q}orphaned_at${q} = ${q === "`" ? "NOW()" : "CURRENT_TIMESTAMP"} WHERE ${q}slug${q} = 'export-mdp-posts'`
        )
      );
      expect(await orphaned()).toEqual(["export-mdp-posts"]);

      await migrate(declaring);

      expect(await orphaned()).toEqual([]);
      expect(await grants()).toEqual(before);
    }, 300_000);

    it("changes no orphan mark rolling back between two migrations whose snapshots predate the registry metadata, before the record exists", async () => {
      const declaring = config({ permissions: [["export", "mdp-posts"]] });
      await migrateCreate(declaring);
      // The next migration adds a collection and stops declaring the app's
      // permission.
      const later = config({ extra: ["mdp-notes"] });
      await migrateCreate(later);
      // Both snapshots as an earlier release wrote them: no registry metadata.
      const meta = join(state.dir, "migrations", "meta");
      for (const name of readdirSync(meta).filter(n =>
        n.endsWith(".snapshot.json")
      )) {
        const file = join(meta, name);
        const snapshot = JSON.parse(readFileSync(file, "utf-8")) as Record<
          string,
          unknown
        >;
        delete snapshot.entities;
        delete snapshot.permissions;
        writeFileSync(file, JSON.stringify(snapshot, null, 2));
      }
      await migrate(later);
      // An earlier version's snapshot orphans nothing.
      expect(await orphaned()).toEqual([]);
      // As before this release: no registry record.
      await on(adapter =>
        adapter.executeQuery(
          `DELETE FROM ${q}nextly_meta${q} WHERE ${q}key${q} = 'registry_record'`
        )
      );
      const before = { marks: await marks(), grants: await grants() };

      await migrateDown(later);

      expect({ marks: await marks(), grants: await grants() }).toEqual(before);
    }, 300_000);
  }
);
