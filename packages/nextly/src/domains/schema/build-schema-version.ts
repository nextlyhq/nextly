/**
 * The build's schema version: the newest app migration the build ships.
 *
 * `withNextly` names it while Next.js loads `next.config`, from the app's
 * migrations folder, and hands it to the app's build as
 * `NEXTLY_BUILD_SCHEMA_VERSION` through Next.js's `env`. Next.js inlines that
 * into the app's own `instrumentation.ts`, which passes it to `createRegister`
 * (`recordBuildSchemaVersion`), so a production start can compare it with the
 * version the database stores (`schema-version.ts`) without reading the
 * migrations folder at run time, wherever the server runs. This module imports nothing but the file
 * system and two dependency-free helpers, because it runs inside the config
 * load of every build and every `next start`.
 *
 * @module domains/schema/build-schema-version
 */
import { readdirSync } from "node:fs";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { MigrationFolder } from "../../cli/utils/migration-discovery";

import { groupMigrationFiles } from "./migrate/migration-groups";
import { compareMigrationBaseNames } from "./migrate/migration-order";
import { hasOldBuilderName } from "./migrate/old-builder-name";

/** The environment variable that carries the build's schema version. */
export const BUILD_SCHEMA_VERSION_ENV = "NEXTLY_BUILD_SCHEMA_VERSION";

/**
 * The newest of `names` in the order migrations run (`compareMigrationBaseNames`),
 * or undefined for none. Migration names start with a UTC timestamp
 * (`YYYYMMDD_HHMMSS_mmm_<name>`), so the newest is the last to run.
 */
export function newestMigrationName(
  names: Iterable<string>
): string | undefined {
  let newest: string | undefined;
  for (const name of names) {
    if (newest === undefined || compareMigrationBaseNames(name, newest) > 0) {
      newest = name;
    }
  }
  return newest;
}

/** The runner's reading of the folder, as far as this needs it. */
export type RunnersFolderReading = (
  dir: string,
  dialect: SupportedDialect
) => Pick<MigrationFolder, "groups">;

/**
 * The newest app migration in `dir` that `nextly migrate` runs on `dialect`,
 * by base name: the folder as the runner groups it (`groupMigrationFiles`),
 * so a dialect's variant counts as its base. Only a file named as an earlier
 * Schema Builder named its files (`hasOldBuilderName`) can be one the runner
 * sets aside, so where the folder holds one, the runner's own reading decides
 * (`readMigrationFolderSync`, which `loadRunnersReading` loads only then: it
 * brings the core schema with it, too heavy for every load of `next.config`).
 * Undefined for a folder with no migration, or one that cannot be read: the
 * comparison this feeds only ever logs, so a folder it cannot read leaves it
 * with nothing to compare rather than failing the build.
 */
export function newestMigrationIn(
  dir: string,
  dialect: SupportedDialect,
  loadRunnersReading: () => RunnersFolderReading
): string | undefined {
  try {
    const files = readdirSync(dir).filter(file => file.endsWith(".sql"));
    const groups = files.some(hasOldBuilderName)
      ? loadRunnersReading()(dir, dialect).groups
      : groupMigrationFiles(files);
    return newestMigrationName(groups.keys());
  } catch {
    return undefined;
  }
}

/**
 * Where the version `createRegister` was given is kept: on `globalThis`, so a
 * copy of this module loaded through another chunk reads the same value.
 */
const RECORDED = Symbol.for("nextly/build-schema-version");

/** A version as a value: a non-empty string, anything else none. */
function versionOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Records the build's schema version the app's `instrumentation.ts` handed
 * `createRegister`: the value Next.js inlined there for
 * `process.env.NEXTLY_BUILD_SCHEMA_VERSION`. Nextly cannot read that itself:
 * Next.js inlines values only into code it bundles, and Nextly is a
 * server-external package. Anything but a non-empty string records none.
 */
export function recordBuildSchemaVersion(value: unknown): void {
  (globalThis as Record<symbol, string | undefined>)[RECORDED] =
    versionOf(value);
}

/**
 * The build's schema version as the server was given it: the one recorded
 * from `createRegister`, else `NEXTLY_BUILD_SCHEMA_VERSION` in the process's
 * environment (which `withNextly` sets while `next start` loads the config,
 * for an app whose `instrumentation.ts` passes none), else undefined: no
 * migrations folder, or a build `withNextly` did not wrap.
 */
export function buildSchemaVersion(): string | undefined {
  return (
    versionOf((globalThis as Record<symbol, unknown>)[RECORDED]) ??
    versionOf(process.env.NEXTLY_BUILD_SCHEMA_VERSION)
  );
}
