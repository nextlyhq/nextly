/**
 * A development start whose migrate step a test watches: its folder the test's, its database settings
 * taken as valid (the test's database is reached through the instance, not the environment), and each
 * run of the migrate step counted before it runs the folder's files. A save the process holds in this
 * same process has its lock passed through, as only its process ending would release it, and the
 * start's code-first reload is answered as finished.
 *
 * Installed by a test file over each module a start passes through. This module imports types only, so
 * a mock's factory meets no module it is mocking:
 * `vi.mock("../../pipeline/locks", async original =>
 *   (await import("./helpers/watched-start")).passingLocks(await original()))`.
 */
import { relative } from "node:path";

import type * as Locks from "../../../pipeline/locks";
import type * as AdapterEnv from "../../../../../cli/utils/adapter";
import type * as ConfigLoader from "../../../../../cli/utils/config-loader";
import type * as Migrate from "../../../../../cli/commands/migrate";
import type * as ReloadConfig from "../../../../../init/reload-config";

/** What the start being watched is told, and how often its migrate step ran. */
export const watched = {
  on: false,
  runs: 0,
  folder: undefined as string | undefined,
};

/** Watched no more, and counted from nothing. */
export function unwatchStart(): void {
  watched.on = false;
  watched.runs = 0;
  watched.folder = undefined;
}

export function passingLocks(actual: typeof Locks): typeof Locks {
  return {
    ...actual,
    withMigrateLock: (async (
      ...args: Parameters<typeof actual.withMigrateLock>
    ) => {
      if (!watched.on) return actual.withMigrateLock(...args);
      return { ran: true, value: await args[2]() };
    }) as typeof actual.withMigrateLock,
  };
}

export function readingFolder(
  actual: typeof ConfigLoader
): typeof ConfigLoader {
  return {
    ...actual,
    loadConfig: (async (...args: Parameters<typeof actual.loadConfig>) => {
      const loaded = await actual.loadConfig(...args);
      if (watched.folder === undefined) return loaded;
      return {
        ...loaded,
        config: {
          ...loaded.config,
          db: {
            ...loaded.config.db,
            migrationsDir: relative(process.cwd(), watched.folder),
          },
        },
      };
    }) as typeof actual.loadConfig,
  };
}

export function validEnvironment(actual: typeof AdapterEnv): typeof AdapterEnv {
  return {
    ...actual,
    validateDatabaseEnv: (() =>
      watched.on
        ? { valid: true, errors: [] }
        : actual.validateDatabaseEnv()) as typeof actual.validateDatabaseEnv,
  };
}

export function countingMigrate(actual: typeof Migrate): typeof Migrate {
  return {
    ...actual,
    migrateCore: (async (...args: Parameters<typeof actual.migrateCore>) => {
      if (!watched.on) return actual.migrateCore(...args);
      watched.runs += 1;
      const [deps] = args as unknown as [
        {
          adapter: unknown;
          db: unknown;
          dialect: Parameters<typeof actual.runFileMigrations>[0]["dialect"];
          migrationsDir: string;
        },
      ];
      await actual.runFileMigrations({
        adapter: deps.adapter as never,
        db: deps.db,
        dialect: deps.dialect,
        migrationsDir: deps.migrationsDir,
        logger: (await import("../../../../../cli/utils/logger")).createLogger({
          quiet: true,
        }),
      });
      return {
        applied: 1,
        pluginModulesApplied: 0,
        metadata: { collectionsRegistered: 0, singlesRegistered: 0 },
      } as never;
    }) as typeof actual.migrateCore,
  };
}

export function finishedReload(
  actual: typeof ReloadConfig
): typeof ReloadConfig {
  return {
    ...actual,
    reloadNextlyConfig: (async (
      ...args: Parameters<typeof actual.reloadNextlyConfig>
    ) =>
      watched.on
        ? "finished"
        : actual.reloadNextlyConfig(
            ...args
          )) as typeof actual.reloadNextlyConfig,
  };
}
