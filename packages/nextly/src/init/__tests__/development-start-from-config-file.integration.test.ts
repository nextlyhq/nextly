/**
 * A development start of an app whose configuration is a file on disk, on
 * every dialect.
 *
 * Such a start also reloads the configuration from its file as part of its
 * apply (`reloadNextlyConfig`), the same reload an HMR save runs. With nothing
 * changed since the last start, that reload has nothing to compare and its
 * syncs leave permissions to the start's own seeding, so:
 * - each permission is ensured at most once in the start;
 * - the start writes no bookkeeping, and sends as many statements for 50
 *   entities as for 5.
 * An HMR save is not a start: its reload compares every entity's table and
 * seeds, as it always has.
 *
 * The file is read from disk at every load, as the configuration loader reads
 * it. Only its compile is stood in for: the loader imports the compiled module
 * through Node's VM, whose dynamic-import hook vitest does not provide, so the
 * file is JSON and `loadConfig` builds the configuration from it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

// What the configuration loader returns for the file in the working directory,
// read from disk at every call.
vi.mock("../../cli/utils/config-loader", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../cli/utils/config-loader")>();
  const [{ readFileSync }, path, config, { sanitizeConfig }] =
    await Promise.all([
      import("node:fs"),
      import("node:path"),
      import("../../config"),
      import("../../shared/types/config"),
    ]);
  const load = async () => {
    const file = path.join(process.cwd(), "nextly.config.json");
    const declared = JSON.parse(readFileSync(file, "utf8")) as {
      collections: Array<{
        slug: string;
        label?: string;
        fields: Array<{ name: string }>;
      }>;
    };
    return {
      config: sanitizeConfig(
        config.defineConfig({
          collections: declared.collections.map(c =>
            config.defineCollection({
              slug: c.slug,
              fields: c.fields.map(f => config.text({ name: f.name })),
              ...(c.label
                ? { labels: { singular: c.label, plural: c.label } }
                : {}),
            })
          ),
        })
      ),
      configPath: file,
      dependencies: [],
    };
  };
  return { ...actual, loadConfig: load };
});

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import { clearConfigCache, loadConfig } from "../../cli/utils/config-loader";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { PermissionService } from "../../domains/auth/services/permission-service";
import { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { getNextly, startSettled } from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { reloadNextlyConfig } from "../reload-config";
import { holdBootSeeding } from "../seed-permissions";

/**
 * The configuration file of an app with `n` collections, each with one text
 * field; `relabelled` gains a label, a change that leaves its table as it is.
 */
function configFile(n: number, relabelled?: string): string {
  const collections = Array.from({ length: n }, (_, i) => ({
    slug: `p${i}x`,
    fields: [{ name: "title", type: "text" }],
    ...(`p${i}x` === relabelled ? { label: "Renamed" } : {}),
  }));
  return `${JSON.stringify({ collections })}\n`;
}

/** The entities a statement names, by slug or by table. */
function named(call: RecordedStatement): Set<string> {
  const said = `${call.text} ${JSON.stringify(call.values)}`;
  // Not \b: in a table name (`dc_p0x`) the underscore is a word character.
  return new Set(
    [...said.matchAll(/(?<![a-z0-9])(p\d+x)(?![a-z0-9])/gi)].map(match =>
      match[1].toLowerCase()
    )
  );
}

/** The statements of `calls` that write the bookkeeping, as the spec names it. */
const bookkeepingWrites = (calls: readonly RecordedStatement[]) =>
  calls
    .filter(
      call =>
        /^\s*(insert|update|delete|replace)\b/i.test(call.text) &&
        /\b(dynamic_collections|dynamic_singles|dynamic_components|permissions|roles|role_permissions|user_field_definitions)\b/i.test(
          call.text
        )
    )
    .map(call => call.text.replace(/\s+/g, " ").slice(0, 120));

describe.each(getConfiguredTestDialects())(
  "a development start from a configuration file (%s)",
  (dialect: TestDialect) => {
    const cleanups: Array<() => Promise<void> | void> = [];

    afterEach(async () => {
      await shutdownServices();
      clearConfigCache();
      vi.unstubAllEnvs();
      _resetEnvCache();
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    });

    /**
     * An app folder holding `nextly.config.json` for `n` collections, as the
     * working directory, and a database migrated for it on which one
     * development start has run. Returns what opens that database.
     */
    async function startedApp(
      n: number
    ): Promise<() => Promise<DrizzleAdapter>> {
      const dir = mkdtempSync(join(tmpdir(), "nextly-config-file-"));
      writeFileSync(join(dir, "nextly.config.json"), configFile(n));
      const before = process.cwd();
      process.chdir(dir);
      cleanups.push(() => {
        process.chdir(before);
        rmSync(dir, { recursive: true, force: true });
      });

      let url: string;
      if (dialect === "sqlite") {
        url = `file:${join(dir, "app.db")}`;
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_config_file"
        );
        url = scratch.url;
        cleanups.push(scratch.drop);
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const adapterFor = () =>
        createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0]) as Promise<DrizzleAdapter>;

      const { config } = await loadConfig();
      await createTestNextly({
        adapter: (await adapterFor()) as never,
        collections: config.collections as never,
      });
      await shutdownServices();
      await recordStart(adapterFor);
      return adapterFor;
    }

    /** Every statement one development start sends, its configuration read from the file. */
    async function recordStart(
      adapterFor: () => Promise<DrizzleAdapter>
    ): Promise<RecordedStatement[]> {
      vi.stubEnv("NODE_ENV", "development");
      const { config } = await loadConfig();
      const adapter = await adapterFor();
      const recorder = await recordStatements(adapter, dialect);
      try {
        const nextly = await getNextly({ config: config as never, adapter });
        await startSettled();
        recorder.uninstall();
        await nextly.shutdown();
      } finally {
        recorder.uninstall();
      }
      return recorder.calls;
    }

    it("ensures each permission at most once", async () => {
      const adapterFor = await startedApp(5);
      const ensured = new Map<string, number>();
      const count = (action: string, resource: string) => {
        if (!/^p\d+x$/.test(resource)) return;
        const key = `${action}:${resource}`;
        ensured.set(key, (ensured.get(key) ?? 0) + 1);
      };
      const one = vi.spyOn(PermissionService.prototype, "ensurePermission");
      const many = vi.spyOn(PermissionService.prototype, "ensurePermissions");
      try {
        await recordStart(adapterFor);
        for (const [action, resource] of one.mock.calls)
          count(action, resource);
        for (const [declared] of many.mock.calls) {
          for (const { action, resource } of declared) count(action, resource);
        }
      } finally {
        one.mockRestore();
        many.mockRestore();
      }
      expect(ensured.size).toBeGreaterThan(0);
      expect([...ensured].filter(([, n]) => n > 1)).toEqual([]);
    }, 300_000);

    it("with nothing changed writes no bookkeeping, and sends as many statements for 50 entities as for 5", async () => {
      const few = await recordStart(await startedApp(5));
      await shutdownServices();
      const many = await recordStart(await startedApp(50));

      expect(bookkeepingWrites(few)).toEqual([]);
      expect(bookkeepingWrites(many)).toEqual([]);
      expect(many.length).toBe(few.length);
    }, 600_000);

    it("leaves an HMR save as it was: its reload compares every entity's table", async () => {
      const adapterFor = await startedApp(5);
      vi.stubEnv("NODE_ENV", "development");
      const { config } = await loadConfig();
      const adapter = await adapterFor();
      const nextly = await getNextly({ config: config as never, adapter });
      await startSettled();

      const recorder = await recordStatements(adapter, dialect);
      try {
        // An HMR save of the unchanged file: not a start.
        await reloadNextlyConfig();
      } finally {
        recorder.uninstall();
      }
      await nextly.shutdown();

      const seen = new Set(recorder.calls.flatMap(call => [...named(call)]));
      expect([...seen].sort()).toEqual(["p0x", "p1x", "p2x", "p3x", "p4x"]);
    }, 300_000);

    it("records nothing for a start whose reload did not land", async () => {
      const adapterFor = await startedApp(5);
      /** The fingerprint the last recording start left for p2x. */
      const recordedP2x = async () => {
        const reader = await adapterFor();
        try {
          const rows = await reader.executeQuery<{ value: unknown }>(
            "SELECT value FROM nextly_meta WHERE key = 'development_start:entity:collection:p2x'"
          );
          return rows.map(row => String(row.value));
        } finally {
          await reader.disconnect();
        }
      };
      const before = await recordedP2x();
      expect(before).toHaveLength(1);

      // A new label: in line with its table, so a start whose reload lands
      // records it. This start's reload does not land: the registry sync it
      // runs after the one `registerServices` runs fails.
      writeFileSync(
        join(process.cwd(), "nextly.config.json"),
        configFile(5, "p2x")
      );
      clearConfigCache();
      const real = CollectionRegistryService.prototype.syncCodeFirstCollections;
      let syncs = 0;
      const sync = vi
        .spyOn(CollectionRegistryService.prototype, "syncCodeFirstCollections")
        .mockImplementation(function (
          this: CollectionRegistryService,
          ...args: Parameters<typeof real>
        ) {
          syncs += 1;
          return syncs === 1
            ? real.apply(this, args)
            : Promise.reject(new Error("the reload's sync failed"));
        });
      try {
        await recordStart(adapterFor);
      } finally {
        sync.mockRestore();
      }

      expect(syncs).toBeGreaterThan(1);
      expect(await recordedP2x()).toEqual(before);
    }, 300_000);

    it("seeds an entity an HMR save adds while a start holds the seeding", async () => {
      const adapterFor = await startedApp(5);
      vi.stubEnv("NODE_ENV", "development");
      const { config } = await loadConfig();
      const adapter = await adapterFor();
      const nextly = await getNextly({ config: config as never, adapter });
      await startSettled();

      writeFileSync(join(process.cwd(), "nextly.config.json"), configFile(6));
      const ensured: string[] = [];
      const one = vi.spyOn(PermissionService.prototype, "ensurePermission");
      const many = vi.spyOn(PermissionService.prototype, "ensurePermissions");
      // Another start, still to seed, holds the gate while the save reloads:
      // its seeding may already have read the registry, so the save seeds the
      // entity it adds itself.
      const release = holdBootSeeding();
      try {
        await reloadNextlyConfig();
        for (const [, resource] of one.mock.calls) ensured.push(resource);
        for (const [declared] of many.mock.calls) {
          for (const { resource } of declared) ensured.push(resource);
        }
      } finally {
        release();
        one.mockRestore();
        many.mockRestore();
        await nextly.shutdown();
      }

      expect(ensured).toContain("p5x");
    }, 300_000);
  }
);
