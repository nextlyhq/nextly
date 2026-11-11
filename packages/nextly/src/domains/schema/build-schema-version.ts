/**
 * The build's schema version: the newest app migration the build ships.
 *
 * `withNextly` names it while Next.js loads `next.config`, from the app's
 * migrations folder, and hands it to the server as
 * `NEXTLY_BUILD_SCHEMA_VERSION`, so a production start can compare it with
 * the version the database stores (`schema-version.ts`) without reading the
 * migrations folder at run time. This module imports nothing but the file
 * system and two dependency-free helpers, because it runs inside the config
 * load of every build and every `next start`.
 *
 * @module domains/schema/build-schema-version
 */
import { readdirSync } from "node:fs";

import { dialectVariantOf } from "./migrate/dialect-variant";
import { compareMigrationBaseNames } from "./migrate/migration-order";

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

/**
 * The newest app migration in `dir`, by base name: a dialect's variant
 * (`<base>.mysql.sql`) counts as its base, as the runner groups it. Undefined
 * for a folder with no migration, or one that cannot be read: the comparison
 * this feeds only ever logs, so a folder it cannot read leaves it with
 * nothing to compare rather than failing the build.
 */
export function newestMigrationIn(dir: string): string | undefined {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return undefined;
  }
  return newestMigrationName(
    files
      .filter(file => file.endsWith(".sql"))
      .map(file => dialectVariantOf(file)?.baseName ?? file.slice(0, -4))
  );
}

/**
 * The build's schema version as the server was given it, or undefined where
 * it was given none (no migrations folder, or a build `withNextly` did not
 * wrap). Read through the literal property, which is what a bundler replaces
 * where it inlines the value.
 */
export function buildSchemaVersion(): string | undefined {
  const value = process.env.NEXTLY_BUILD_SCHEMA_VERSION;
  return value === undefined || value === "" ? undefined : value;
}
