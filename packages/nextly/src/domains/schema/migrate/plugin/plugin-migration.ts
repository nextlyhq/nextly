/**
 * What a plugin ships instead of loose `.sql` files.
 *
 * A generated TypeScript MODULE, because a module import is always in a
 * Next.js server bundle and loose files inside `node_modules` are not. A
 * plugin whose migrations cannot be found at runtime is a plugin whose tables
 * never reach production, and the failure arrives as a query against a missing
 * table rather than as anything about migrations.
 *
 * ## The checksum, and why there are two of them
 *
 * The module carries a checksum over its whole content — name, schema
 * version, SQL and the snapshot sides the apply reads — which catches a
 * module edited after generation, the author's mistake. The LEDGER separately
 * stores the sha256 of what actually ran, which catches a module changed after it was
 * applied — everyone else's problem, because the database no longer matches
 * the file that claims to describe it.
 *
 * Neither check subsumes the other: the first fires on an unapplied module and
 * the second on an applied one, and an edit between generation and application
 * is only visible to the first.
 *
 * @module domains/schema/migrate/plugin/plugin-migration
 * @since 1.0.0
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { normalizeContributions } from "../../pipeline/diff/contributions";
import type { ContributedElements, TableSpec } from "../../pipeline/diff/types";
import { splitSqlStatements } from "../split-sql";

/** The statements one dialect runs, in order. */
export interface DialectStatements {
  up: string[];
  down: string[];
}

export interface PluginMigrationSnapshot {
  tables: TableSpec[];
}

export interface PluginMigration {
  /** Ordered by name, so the timestamp prefix decides the sequence. */
  name: string;
  /** The plugin's declared schema version after this migration. */
  schemaVersion: number;
  /**
   * sha256 over the canonical form of everything else in the module — its
   * name, schema version, SQL and every snapshot side. See
   * `canonicalMigrationForm`.
   */
  checksum: string;
  /**
   * `false` runs this module's UP and DOWN outside a transaction, statement
   * by statement, so it can hold a statement a transaction refuses, such as
   * PostgreSQL's `CREATE INDEX CONCURRENTLY`. A statement that fails then
   * leaves the ones before it applied. Absent or `true`, the module runs in
   * one transaction. Part of the checksum only when `false`, so a module
   * without it hashes as it always has.
   *
   * @experimental
   */
  transaction?: boolean;
  dialects: Record<SupportedDialect, DialectStatements>;
  /** The owner's tables AFTER this migration, per dialect. */
  snapshot: Record<SupportedDialect, PluginMigrationSnapshot>;
  /** The owner's tables BEFORE it — the previous module's snapshot, or empty. */
  before: Record<SupportedDialect, PluginMigrationSnapshot>;
  /**
   * Tables this owner does NOT own, carrying elements it contributed.
   *
   * A plugin may add a column to a declared dependency's table, and that
   * column has to travel in this plugin's module: the plugin ships its own
   * migrations precisely so installing it does not require the app to
   * regenerate, and a column left out of them never reaches an existing
   * installation.
   *
   * Kept OUT of `snapshot` deliberately. `snapshot` is what the apply path
   * records ownership from, and a dependency's table listed there would let
   * this plugin overwrite its owner — the table belongs to the dependency; only
   * the element is this plugin's. These two sides feed the diff and the
   * reconcile, never the owner rows.
   */
  contributed?: Record<SupportedDialect, PluginMigrationSnapshot>;
  /** The same foreign tables BEFORE this module, for the same diff. */
  contributedBefore?: Record<SupportedDialect, PluginMigrationSnapshot>;
  /**
   * Which elements of the `contributed` tables are this plugin's, per dialect
   * and by table.
   *
   * The next module's generator needs exactly this, and the stored tables
   * cannot answer it: once a table has been stored with the contribution on
   * both sides, the contribution is indistinguishable from the owner's own
   * columns. Per dialect because a schema hook can add an element on one
   * dialect only. A module without it — generated before it was recorded —
   * is read by replaying the modules' own before/after sides instead.
   */
  contributions?: ContributionsByDialect;
}

/** A plugin's contributed element names, per dialect and by table. */
export type ContributionsByDialect = Partial<
  Record<SupportedDialect, Record<string, ContributedElements>>
>;

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** Everything a module carries except the checksum sealed over it. */
export type MigrationContent = Omit<PluginMigration, "checksum">;

/**
 * The canonical form a checksum is taken over.
 *
 * Keys are emitted in a fixed order rather than whatever `JSON.stringify`
 * happens to produce, so a module regenerated on a different day hashes the
 * same when its content is the same. A checksum that moves without the content
 * moving would refuse a module nobody touched.
 *
 * Every field the runner acts on is part of the form, unconditionally:
 *
 * - `name` is the module's ledger key (`plugin:<plugin>/<name>`) and decides
 *   its order. Renamed after sealing, an applied module would no longer be
 *   found in the ledger and would be judged afresh, and a pending one could
 *   move ahead of a module it depends on.
 * - `schemaVersion` is recorded on the owner rows and read by the version
 *   gate, so an edited one claims a schema the SQL never produced.
 * - `transaction: false` decides whether a failure can leave the module
 *   partly applied.
 * - The snapshot sides are handed to the reconcile, which adopts a live
 *   schema that already matches the target and records it as applied WITHOUT
 *   running the SQL — so an unverified snapshot is as dangerous as
 *   unverified SQL.
 *
 * There is one form and no narrower alternative: a module whose checksum
 * omits any of these fails verification like any other edited module.
 */
export function canonicalMigrationForm(content: MigrationContent): string {
  const identity = [content.name, content.schemaVersion];
  const base = DIALECTS.map(dialect => [
    dialect,
    content.dialects[dialect]?.up ?? [],
    content.dialects[dialect]?.down ?? [],
  ]);
  const sides = DIALECTS.map(dialect => [
    dialect,
    content.snapshot[dialect]?.tables ?? [],
    content.before[dialect]?.tables ?? [],
    content.contributed?.[dialect]?.tables ?? [],
    content.contributedBefore?.[dialect]?.tables ?? [],
  ]);
  // Appended only when present, so a module without contributions hashes
  // exactly as a module generated before they were recorded — and one with
  // them cannot have them edited without its checksum noticing, since they
  // decide what the next module emits.
  const form: unknown[] =
    content.contributions === undefined
      ? [identity, base, sides]
      : [
          identity,
          base,
          sides,
          DIALECTS.map(dialect => [
            dialect,
            Object.entries(
              normalizeContributions(content.contributions?.[dialect] ?? {})
            ),
          ]),
        ];
  // Appended only for `transaction: false`, for the same reason: a module
  // that runs in a transaction, marked so or not, hashes as before. A string,
  // so it cannot be read as the contributions' array in the same position.
  if (content.transaction === false) form.push("no-transaction");
  return JSON.stringify(form);
}

/**
 * The checksum a module carries, sealed over its whole content.
 *
 * Takes the module itself rather than a hand-picked subset of its fields, so
 * the generator, a hand-written module and the runner's verification all hash
 * the same thing and none can leave a field out. A `checksum` already on the
 * object is ignored: the canonical form reads only the fields it names.
 */
export function migrationChecksum(content: MigrationContent): string {
  return createHash("sha256")
    .update(canonicalMigrationForm(content))
    .digest("hex");
}

/**
 * The statements one direction of a module runs on one dialect, one per
 * driver call.
 *
 * An entry of `dialects[dialect].up`/`.down` is one OPERATION's rendering, and
 * `generateSQL` does not promise that is one statement: a foreign-key action
 * change is a drop and an add in one entry. A MySQL connection runs with
 * `multipleStatements` off and refuses such a pair whole, so every entry is
 * put through `splitSqlStatements`, the splitter an app migration file goes
 * through. Each entry is split on its own: joined first, an entry ending in a
 * `-- comment` would swallow the separator after it and merge with the next.
 * Split as the module runs, so a `transaction: false` module keeps a
 * transaction bracket for the refusal to name.
 *
 * Every guard over a module reads this list, and every path that runs one —
 * the apply and `migrate:down --plugin` — runs it.
 */
export function pluginModuleStatements(
  migration: Pick<PluginMigration, "dialects" | "transaction">,
  dialect: SupportedDialect,
  direction: keyof DialectStatements
): string[] {
  const mode = { transaction: migration.transaction !== false };
  return (migration.dialects[dialect]?.[direction] ?? []).flatMap(entry =>
    splitSqlStatements(entry, dialect, mode)
  );
}

/**
 * `pluginModuleStatements` as one SQL text, for the callers that take text
 * and split it again (the reconcile's executor, the rollback planner). Each
 * statement is followed by a newline before its `;`, so a statement ending
 * in a line comment cannot swallow the separator; splitting this text gives
 * back exactly `pluginModuleStatements`.
 */
export function moduleSql(
  migration: Pick<PluginMigration, "dialects" | "transaction">,
  dialect: SupportedDialect,
  direction: keyof DialectStatements
): string {
  return pluginModuleStatements(migration, dialect, direction)
    .map(statement => `${statement}\n;`)
    .join("\n");
}

/** The ledger filename a plugin's migration is recorded under. */
export function qualifiedFilename(
  pluginName: string,
  migrationName: string
): string {
  // Qualified, so the ledger's existing "one applied row per filename" rule
  // keeps working unchanged: two plugins may both ship `001_init` and those
  // are different migrations.
  return `plugin:${pluginName}/${migrationName}`;
}

/**
 * Refuse a module whose name cannot be told apart from its plugin's in the
 * ledger.
 *
 * A module is recorded as `plugin:<plugin>/<name>`, and a plugin's own name
 * may hold a slash (`@acme/nextly-plugin-auth`), so the LAST slash is what
 * separates the two (`pluginOfLedgerRow`). A module named `data/backfill`
 * would be filed under the plugin `<plugin>/data`, where `migrate:status`
 * and `migrate:down` for its real plugin never find it. The generator's
 * names never hold one; a module written by hand is refused here, where the
 * manifest is read, before anything runs.
 */
export function assertModuleNames(
  pluginName: string,
  migrations: readonly Pick<PluginMigration, "name">[]
): void {
  const slashed = migrations.find(migration => migration.name.includes("/"));
  if (slashed === undefined) return;
  throw NextlyError.validation({
    errors: [
      {
        path: `plugin.${pluginName}.contributes.schema.migrations`,
        code: "INVALID",
        message: `Plugin "${pluginName}" ships a migration named "${slashed.name}". A migration name cannot contain "/", which separates the plugin from the migration in the ledger.`,
      },
    ],
  });
}

/**
 * Refuse a module whose content no longer matches its checksum.
 *
 * An edited module is refused rather than re-hashed. Re-hashing would accept
 * whatever is on disk, which is precisely the state this exists to detect:
 * the SQL that will run is not the SQL that was reviewed. A module its author
 * means to edit computes its checksum from its own content when it loads
 * (`migrationChecksum`), so it passes here, and the refusal says how.
 */
export function assertModuleIntact(
  pluginName: string,
  migration: PluginMigration
): void {
  const actual = migrationChecksum(migration);
  if (actual === migration.checksum) return;

  throw new NextlyError({
    code: "MIGRATION_CHECKSUM_MISMATCH",
    publicMessage: `A plugin migration has been changed since it was generated. Regenerate it, or restore the original. A module written or edited by hand is sealed with \`migrationChecksum\` from \`@nextlyhq/plugin-sdk/schema\` — \`checksum: migrationChecksum(content)\` over the module without its checksum — which is the form \`nextly migrate:create --plugin <entry> --blank\` and \`--no-transaction\` write.`,
    logContext: {
      plugin: pluginName,
      migration: migration.name,
      expected: migration.checksum,
      actual,
    },
  });
}

/**
 * Refuse an APPLIED module whose SQL differs from what ran.
 *
 * Distinct from the check above, and not covered by it: a module can be
 * internally consistent — regenerated, checksum rewritten — and still differ
 * from the statements that built the live database. The ledger is the only
 * record of what actually ran.
 */
export function assertAppliedUnchanged(
  pluginName: string,
  migration: PluginMigration,
  recordedSha256: string | null
): void {
  if (recordedSha256 === null) return;
  const actual = migrationChecksum(migration);
  if (actual === recordedSha256) return;

  throw new NextlyError({
    code: "MIGRATION_CHECKSUM_MISMATCH",
    publicMessage:
      "A plugin migration that has already been applied no longer matches what was applied. The database does not match the file that claims to describe it.",
    logContext: {
      plugin: pluginName,
      migration: migration.name,
      applied: recordedSha256,
      onDisk: actual,
    },
  });
}

/**
 * The modules a plugin ships, in the order they must run.
 *
 * Sorted by name rather than trusting the array's order: the generated
 * `index.ts` is rewritten by a tool, and a hand-edit that reorders it would
 * otherwise silently change which migration runs first.
 */
export function orderedMigrations(
  migrations: readonly PluginMigration[]
): PluginMigration[] {
  return [...migrations].sort((a, b) => compareModuleNames(a.name, b.name));
}

/**
 * The order two of one plugin's modules run in, by name. The comparator
 * `orderedMigrations` sorts by, exported so anything that has to agree with
 * the run order asks this rather than sorting by a rule of its own.
 */
export function compareModuleNames(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Refuse a plugin whose modules share a name.
 *
 * The name is the module's ledger key (`qualifiedFilename`), so two modules
 * named alike are one migration to the ledger: both run on the first
 * migrate, only one can stay recorded applied, and every later migrate finds
 * the other pending and runs its SQL again. Names that differ only in case
 * are refused too: MySQL compares the ledger's filenames without regard to
 * case by default, so there they collide in the same way, and a plugin is
 * refused alike on every dialect.
 */
export function assertUniqueModuleNames(
  pluginName: string,
  migrations: readonly Pick<PluginMigration, "name">[]
): void {
  const seen = new Map<string, string>();
  for (const migration of migrations) {
    const key = migration.name.toLowerCase();
    const earlier = seen.get(key);
    if (earlier === undefined) {
      seen.set(key, migration.name);
      continue;
    }
    throw NextlyError.invalidInput({
      message: `Plugin "${pluginName}" ships more than one migration named "${migration.name}". Each module's name is its key in the migration ledger, so every name must be unique (ignoring case). Rename one, then reseal it with \`migrationChecksum\`.`,
      logContext: {
        plugin: pluginName,
        migration: migration.name,
        clashesWith: earlier,
      },
    });
  }
}
