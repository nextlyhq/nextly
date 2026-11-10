/**
 * Migration Discovery Utilities
 *
 * Shared utilities for discovering and grouping migration files,
 * including dialect-specific variant selection (e.g., .mysql.sql, .sqlite.sql).
 *
 * This ensures consistent behavior across migrate, migrate:status, and build commands.
 *
 * @module cli/utils/migration-discovery
 */

import { access, readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { checksumOf } from "../../domains/schema/migrate/applied-checksums";
import { dialectVariantOf } from "../../domains/schema/migrate/dialect-variant";
import {
  classifyMigrationFile,
  hasOldBuilderName,
  type OldBuilderSignaturePart,
} from "../../domains/schema/migrate/old-builder-files";

/**
 * A migration file variant with its dialect (if any)
 */
export interface MigrationVariant {
  /** The file name (e.g., "0001_000000_blog_schema.mysql.sql") */
  file: string;
  /** The dialect this file targets (mysql, sqlite, postgresql), or undefined for base files */
  dialect: SupportedDialect | undefined;
}

/**
 * Result of migration discovery - grouped variants for each logical migration
 */
export interface MigrationGroup {
  /** Base migration name (without dialect suffix) */
  baseName: string;
  /** All variants of this migration (base + dialect-specific) */
  variants: MigrationVariant[];
}

/**
 * The names the configuration and the Builder's manifest declare, which an
 * old Builder file's statements are judged against: its custom junction
 * tables, and the entity tables an index name may be read as
 * (`MigrationFileFacts`). A run resolves them from the declared schema
 * (`declaredNamesOf`).
 */
export interface DeclaredNames {
  /** Each collection's custom junction names, by its slug. */
  junctions?: ReadonlyMap<string, ReadonlySet<string>>;
  tables?: ReadonlySet<string>;
  /**
   * The checksum each current old Schema Builder mark records, by file name,
   * from the ledger (`withOldBuilderMarks`). A file whose bytes are as marked
   * keeps the identity its mark recorded, whatever the names above say now.
   * Omitted by a reader that has no database (`migrate:check`, `build`), which
   * judges every file afresh.
   */
  marks?: ReadonlyMap<string, string>;
}

/** A file an earlier Schema Builder wrote, which every reader treats as absent. */
export interface OldBuilderFile {
  /** The file name, `.sql` included, as a ledger row names it. */
  file: string;
  /** The entity its name gives. */
  entity: string;
  /** Its checksum (`checksumOf`), as a mark records it. */
  checksum: string;
}

/**
 * A file with an earlier Schema Builder's name that lacks another part of
 * its signature, so it is read as any migration with no snapshot.
 */
export interface PartialBuilderFile {
  file: string;
  lacks: readonly OldBuilderSignaturePart[];
  checksum: string;
}

/** The migrations folder as every reader reads it (`readMigrationFolder`). */
export interface MigrationFolder {
  /** The migrations, old Builder files taken out. */
  groups: Map<string, MigrationGroup>;
  oldBuilderFiles: OldBuilderFile[];
  partialBuilderFiles: PartialBuilderFile[];
}

/**
 * The migrations folder as every reader of it reads it: the migrations,
 * grouped by base name, with each old Schema Builder file
 * (`classifyMigrationFile`) taken out and listed apart, and each file
 * carrying only part of that signature listed with what it lacks. The one
 * reading, so no reader can apply, list, count or compare a file another
 * reader ignores. Classifying reads statements, hence the dialect.
 */
export async function readMigrationFolder(
  migrationsDir: string,
  dialect: SupportedDialect,
  /**
   * The junction and entity tables the configuration and the Builder's
   * manifest declare (`DeclaredNames`). Omitted, none is: a file touching a
   * custom junction is partial, and an index name another table could explain
   * is not traced. A reader that runs or rolls back files passes what its run
   * resolves.
   */
  declared?: DeclaredNames
): Promise<MigrationFolder> {
  const folder: MigrationFolder = {
    groups: new Map(),
    oldBuilderFiles: [],
    partialBuilderFiles: [],
  };
  let files: string[];
  try {
    files = await readdir(migrationsDir);
  } catch (error) {
    // A folder that is not there holds no migrations. One that cannot be
    // listed may hold any, so the failure travels: read as empty, every mark
    // would name a deleted file and a changed marked file would go unseen.
    if ((error as { code?: string }).code === "ENOENT") return folder;
    throw error;
  }
  const kept: string[] = [];
  // The base files a dialect variant stands beside, by their file name.
  const varied = new Set(
    files.flatMap(file => {
      const variant = dialectVariantOf(file);
      return variant === undefined ? [] : [`${variant.baseName}.sql`];
    })
  );
  for (const file of files.filter(f => f.endsWith(".sql"))) {
    if (!hasOldBuilderName(file)) {
      kept.push(file);
      continue;
    }
    const content = await readFile(resolve(migrationsDir, file), "utf-8");
    const snapshot = resolve(
      migrationsDir,
      "meta",
      `${basename(file, ".sql")}.snapshot.json`
    );
    const checksum = checksumOf(content);
    const kind = classifyMigrationFile({
      name: file,
      content,
      hasSnapshot: await exists(snapshot),
      hasDialectVariant: varied.has(file),
      markedAsIs: declared?.marks?.get(file) === checksum,
      dialect,
      ...(declared?.junctions === undefined
        ? {}
        : { declaredJunctions: declared.junctions }),
      ...(declared?.tables === undefined
        ? {}
        : { declaredTables: declared.tables }),
    });
    if (kind.kind === "old-builder") {
      folder.oldBuilderFiles.push({ file, entity: kind.entity, checksum });
      continue;
    }
    if (kind.kind === "partial") {
      folder.partialBuilderFiles.push({ file, lacks: kind.lacks, checksum });
    }
    kept.push(file);
  }
  folder.groups = groupMigrationFiles(kept);
  return folder;
}

/**
 * The informational line naming an ignored old Builder file, in the words
 * every reader that names one uses. Information, never a warning: the file
 * changes nothing a command does.
 */
export function oldBuilderFileLine(file: OldBuilderFile): string {
  return `${file.file}: ignored: written by an earlier Schema Builder`;
}

/** What each part of the signature a file lacks says about it. */
const LACKS: Record<OldBuilderSignaturePart, string> = {
  snapshot: "has a snapshot beside it",
  variant: "is a dialect variant or has one beside it",
  header: "holds a line `migrate:create` writes",
  scope:
    "has a statement on a table that is not its own entity's, or one that cannot be read",
};

/**
 * The line naming a file that has an earlier Schema Builder's name but not
 * the rest of its signature, so it is checked as any migration: the parts it
 * lacks say why it is not ignored.
 */
export function partialBuilderFileLine(file: PartialBuilderFile): string {
  return `${file.file} has the name of an earlier Schema Builder's file but is checked as a migration: it ${partialBuilderFileLacks(file)}.`;
}

/** What a partial file lacks of the signature, as a clause: "has a snapshot beside it". */
export function partialBuilderFileLacks(file: PartialBuilderFile): string {
  return file.lacks.map(part => LACKS[part]).join("; it ");
}

/**
 * Whether a path exists. Only "not found" reads as absent: any other failure
 * (a permission, an I/O error) travels, since a snapshot read as missing
 * when it is there would set its file aside as an old Builder file.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * The migrations in the folder, grouped with their dialect variants, old
 * Schema Builder files left out (`readMigrationFolder`).
 *
 * Groups files by base name (without dialect suffix) so that:
 * - 0001_000000_blog_schema.sql
 * - 0001_000000_blog_schema.mysql.sql
 * - 0001_000000_blog_schema.sqlite.sql
 *
 * Are treated as ONE logical migration named "0001_000000_blog_schema".
 *
 * @param migrationsDir - Path to the migrations directory
 * @returns Map of base migration names to their variants
 */
export async function discoverMigrationGroups(
  migrationsDir: string,
  /**
   * The dialect the files run on, which classifying reads. Every reader in
   * this package passes it. Omitted, as the published `nextly/cli/utils`
   * contract allows, every `.sql` file is listed as it always was, old
   * Schema Builder files included.
   */
  dialect?: SupportedDialect,
  declared?: DeclaredNames
): Promise<Map<string, MigrationGroup>> {
  if (dialect === undefined) {
    let files: string[];
    try {
      files = await readdir(migrationsDir);
    } catch {
      return new Map();
    }
    return groupMigrationFiles(files.filter(f => f.endsWith(".sql")));
  }
  return (await readMigrationFolder(migrationsDir, dialect, declared)).groups;
}

/**
 * Each migration in the folder in run order, with the path of the file
 * `dialect` runs (`selectVariant`), or undefined where its group has none:
 * the one walk over the folder every reader of migration files reads.
 */
export async function migrationFilesInRunOrder(
  migrationsDir: string,
  dialect: SupportedDialect,
  declared?: DeclaredNames
): Promise<{ baseName: string; filePath: string | undefined }[]> {
  const groups = await discoverMigrationGroups(
    migrationsDir,
    dialect,
    declared
  );
  return getSortedBaseNames(groups).map(baseName => {
    const file = selectVariant(groups.get(baseName)?.variants ?? [], dialect);
    return {
      baseName,
      filePath: file === undefined ? undefined : resolve(migrationsDir, file),
    };
  });
}

/**
 * Each migration's file `dialect` runs, in run order, with its text: a
 * migration with no such file, or one that cannot be read, is left out. For
 * a reader that only lists or compares the files and has nothing to say
 * about one it cannot read.
 */
export async function readableMigrationFiles(
  migrationsDir: string,
  dialect: SupportedDialect,
  declared?: DeclaredNames
): Promise<{ baseName: string; filePath: string; content: string }[]> {
  const files: { baseName: string; filePath: string; content: string }[] = [];
  for (const { baseName, filePath } of await migrationFilesInRunOrder(
    migrationsDir,
    dialect,
    declared
  )) {
    if (filePath === undefined) continue;
    try {
      files.push({
        baseName,
        filePath,
        content: await readFile(filePath, "utf-8"),
      });
    } catch {
      // Unreadable: left out, as the readers this serves always have.
    }
  }
  return files;
}

/** `files` grouped by base name, each group with its dialect variants. */
function groupMigrationFiles(
  files: readonly string[]
): Map<string, MigrationGroup> {
  const sqlFiles = [...files].sort((a, b) => a.localeCompare(b));

  const migrationGroups = new Map<string, MigrationGroup>();

  for (const file of sqlFiles) {
    // A dialect suffix (`.mysql.sql`) names a variant of its base's group;
    // read once, as the old-Builder reading reads it.
    const variant = dialectVariantOf(file);
    const baseName = variant?.baseName ?? basename(file, ".sql");
    const dialect = variant?.dialect;

    // Get or create the group for this base name
    let group = migrationGroups.get(baseName);
    if (!group) {
      group = { baseName, variants: [] };
      migrationGroups.set(baseName, group);
    }

    // Add this variant to the group
    group.variants.push({ file, dialect });
  }

  return migrationGroups;
}

/**
 * Select the best migration variant for a given dialect.
 *
 * Priority order:
 * 1. Dialect-specific file (e.g., .mysql.sql for mysql dialect)
 * 2. Base file (no dialect suffix)
 * 3. First available variant (fallback)
 *
 * @param variants - Available migration variants
 * @param dialect - Target database dialect (optional)
 * @returns The selected file name, or undefined if no variants available
 */
export function selectVariant(
  variants: MigrationVariant[],
  dialect?: SupportedDialect
): string | undefined {
  if (variants.length === 0) {
    return undefined;
  }

  if (dialect) {
    // Look for dialect-specific variant first
    const dialectVariant = variants.find(v => v.dialect === dialect);
    if (dialectVariant) {
      return dialectVariant.file;
    }
    // Fall back to base file (if exists), otherwise first available
    const baseVariant = variants.find(v => v.dialect === undefined);
    return baseVariant?.file || variants[0]?.file;
  }

  // No dialect specified, prefer base file
  const baseVariant = variants.find(v => v.dialect === undefined);
  return baseVariant?.file || variants[0]?.file;
}

/**
 * Get the sorted list of base migration names from grouped migrations.
 *
 * @param groups - Migration groups from discoverMigrationGroups
 * @returns Sorted array of base migration names
 */
export function getSortedBaseNames(
  groups: Map<string, MigrationGroup>
): string[] {
  return Array.from(groups.keys()).sort(compareMigrationBaseNames);
}

/**
 * The order two app migrations run in, by base name (the filename without
 * `.sql`): code-unit order, so the timestamp prefix decides. The comparator
 * `getSortedBaseNames` sorts by, exported so anything that has to agree with
 * the run order asks this rather than sorting by a rule of its own.
 */
export function compareMigrationBaseNames(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * What to tell an operator about a Builder-written file with no snapshot: it
 * is not applied as written, and the file to commit instead is the one
 * `migrate:create` writes for the same change, which carries the snapshot
 * `nextly migrate` checks the database against.
 */
export function builderMigrationRemedy(filename: string): string {
  return (
    `${filename} was written by the Schema Builder and has no snapshot beside it ` +
    `(meta/${filename.replace(/\.sql$/, "")}.snapshot.json), so nothing ` +
    `says what the database should look like once it has run. Replace it with the ` +
    `migration \`nextly migrate:create\` writes for that change: delete ${filename}, ` +
    `run \`nextly migrate:create --name=<name>\`, and commit the .sql file and its snapshot; ` +
    `or delete it, if the change is already in a migration or not wanted.`
  );
}
