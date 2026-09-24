/**
 * Migrate Create Command (F11 PR 3 rewrite)
 *
 * Implements `nextly migrate:create` per the F11 spec §6.1.
 *
 * The command reads `nextly.config.ts`, loads the latest snapshot from
 * `migrations/meta/`, computes the diff via the F4 Option E diff engine,
 * prompts the operator about possible renames via clack, generates the
 * SQL via the shared `pipeline/sql-templates/` module, and writes a
 * paired `migrations/<ts>_<slug>.sql` + `migrations/meta/<ts>_<slug>.snapshot.json`.
 *
 * Does NOT connect to a database — the diff is between the config and
 * the latest snapshot, both file-based.
 *
 * Exit codes (per spec):
 *   0 - File written.
 *   1 - Error (bad config, snapshot unreadable, prompt cancelled).
 *   2 - No changes detected (config matches latest snapshot).
 *
 * @module cli/commands/migrate-create
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Generate migration from pending schema changes
 * nextly migrate:create --name=add_excerpt
 *
 * # Generate without prompts (CI). Renames default to "decline" (DROP+ADD).
 * nextly migrate:create --name=add_excerpt --non-interactive
 *
 * # Same, but accept all renames automatically. ADVANCED — only when you've
 * # already verified the diff is rename-only.
 * nextly migrate:create --name=add_excerpt --non-interactive --accept-renames
 *
 * # Create blank migration for custom SQL
 * nextly migrate:create --name=custom_seed --blank
 * ```
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT import
 * it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). The deployed
 * Next.js app must not perform schema migrations at boot. Enforced by
 * ESLint (`no-restricted-imports`); see
 * docs/guides/production-migrations.mdx.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { Command } from "commander";

import { buildExtensionSchema } from "../../domains/schema/extension/build-extension-schema";
import type { SchemaContribution } from "../../domains/schema/extension/run-hooks";
import {
  orderedMigrations,
  type PluginMigration,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import { toMinimalEntities } from "../../domains/schema/migrate-create/config-entities";
import {
  formatBlankFile,
  formatTimestamp,
  slugify,
} from "../../domains/schema/migrate-create/format-file";
import { generateMigration } from "../../domains/schema/migrate-create/generate";
import { generatePluginMigration } from "../../domains/schema/migrate-create/generate-plugin";
import { PromptCancelledError } from "../../domains/schema/migrate-create/prompt-renames";
import type { TableSpec } from "../../domains/schema/pipeline/diff/types";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import {
  applyDeferredExtendsToManifest,
  mergeUiEntities,
} from "../../domains/schema/ui-schema/merge";
import {
  buildCollectionMetadataUpsert,
  buildComponentMetadataUpsert,
  buildSingleMetadataUpsert,
} from "../../domains/schema/ui-schema/metadata-sql";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { pluginAdminSlug } from "../../plugins/plugin-slug";
import { CORE_TABLE_NAMES } from "../../schemas/index";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
import { createContext, type CommandContext } from "../program";
import {
  getDialectDisplayName,
  validateDatabaseEnv,
  type SupportedDialect,
} from "../utils/adapter";
import { bundleAndRequire } from "../utils/config-bundler";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";
import { formatDuration } from "../utils/logger";

// ============================================================================
// Types
// ============================================================================

export interface MigrateCreateCommandOptions {
  /**
   * Migration name (required for non-blank). Slug-cased; the timestamp
   * prefix is added automatically.
   * @example "add_excerpt"
   */
  name?: string;

  /**
   * Create an empty migration file for custom SQL.
   * @default false
   */
  blank?: boolean;

  /**
   * Skip interactive prompts. Used in CI / non-TTY environments. With
   * this flag set and `--accept-renames` not set, all rename candidates
   * are declined (DROP + ADD with possible data loss).
   * @default detected from process.stdout.isTTY
   */
  nonInteractive?: boolean;

  /**
   * Only meaningful with `--non-interactive`. Auto-accept all rename
   * candidates. ADVANCED — verify the diff first via `migrate:create`
   * in interactive mode before flipping this on for CI.
   * @default false
   */
  acceptRenames?: boolean;

  /**
   * Generate a PLUGIN's migration module instead of the app's `.sql` file.
   * Path to the plugin's entry file (e.g. `./src/index.ts`); the module and
   * its `index.ts` barrel are written beside it under `src/migrations/`.
   */
  plugin?: string;
}

interface ResolvedMigrateCreateOptions extends MigrateCreateCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

export async function runMigrateCreate(
  nameArg: string | undefined,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  if (options.plugin) {
    await runMigrateCreatePlugin(nameArg ?? options.name, options, context);
    return;
  }

  const startTime = Date.now();

  logger.header("Migrate Create");

  // F11 PR 3: dialect comes from DATABASE_URL (no DB connection needed —
  // we just need to know which SQL flavor to emit). validateDatabaseEnv
  // handles the parsing without opening a connection.
  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) {
      logger.error(error);
    }
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables. " +
        "(migrate:create does not connect to the DB but needs the dialect to emit the right SQL.)"
    );
    process.exit(1);
  }
  const dialect = dbValidation.dialect!;

  // Resolve the migration name. --name flag takes precedence over the
  // positional argument. Required for non-blank invocations.
  const name = options.name ?? nameArg;
  if (!options.blank && !name) {
    logger.error(
      "--name is required for non-blank migrations. " +
        "Use --blank to create an empty migration without a name, or pass --name=<slug>."
    );
    process.exit(1);
  }

  // Load config.
  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    logger.error(`Failed to load config: ${describeError(error)}`);
    process.exit(1);
  }

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  // --blank: write a stub file and exit. No diff, no prompts.
  if (options.blank) {
    await runBlankPath(
      name ?? "custom_migration",
      dialect,
      migrationsDir,
      context,
      startTime
    );
    return;
  }

  // F11 PR 3: detect non-interactive mode from the explicit flag OR from
  // a non-TTY stdout. CI environments typically have isTTY=false; the
  // safer default in that case is to decline renames (treat as DROP+ADD)
  // unless --accept-renames is explicit.
  const nonInteractive =
    options.nonInteractive === true || !process.stdout.isTTY;

  // F11 PR 3 review fix #8: surface a warning when --accept-renames was
  // passed but interactive mode is in effect. The flag is only consulted
  // by the prompt-renames helper when nonInteractive=true; silently
  // ignoring it would mislead the operator into thinking they had a
  // safety net they don't actually have.
  if (options.acceptRenames === true && !nonInteractive) {
    logger.warn(
      "--accept-renames has no effect in interactive mode. " +
        "Pass --non-interactive to use it (typically only for CI)."
    );
  }

  // Convert config entries to the minimal shape the orchestrator needs. Each
  // kind resolves its table name through the same helper the runtime uses, so
  // generated names match the live database (collections, singles, and
  // components each normalize differently).
  const codeCollections = toMinimalEntities(
    configResult.config.collections,
    e => resolveCollectionTableName(e.slug, e.dbName)
  );
  const codeSingles = toMinimalEntities(configResult.config.singles ?? [], e =>
    resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
  );
  const codeComponents = toMinimalEntities(
    configResult.config.fieldGroups ?? [],
    e => resolveComponentTableName(e.slug)
  );

  // Load + merge UI-built entities (code-first wins on slug collision).
  let manifest;
  try {
    manifest = await loadUiSchema({
      projectRoot: cwd,
      uiSchemaFile: configResult.config.db.uiSchemaFile,
    });
  } catch (error) {
    logger.error(`Failed to load UI schema: ${describeError(error)}`);
    process.exit(1);
  }

  // Materialize plugin extends that target Builder-made entities (P8): append
  // the deferred extend fields onto the matching ui-schema entity so they land
  // in BOTH the table diff (below) and the dynamic_collections.fields metadata.
  manifest = applyDeferredExtendsToManifest(
    manifest,
    configResult.deferredExtends ?? []
  );

  const merged = mergeUiEntities({
    codeCollections,
    codeSingles,
    codeComponents,
    manifest,
  });
  for (const slug of merged.droppedUiSlugs) {
    logger.warn(
      `ui-schema.json entry '${slug}' is shadowed by a code-first collection of the same slug; the code definition wins.`
    );
  }
  const { collections, singles, components } = merged;

  // Checked on the FULL field objects, not the minimal projection below: that
  // keeps only what DDL needs (name, type, required) and drops the very options
  // a plugin type's rules read, so validating it would accept an invalid option
  // because it looks absent, or reject a valid field whose option it cannot see.
  //
  // A migration is the one artifact that outlives the process that wrote it, so
  // a declaration its own field type rejects would become a deployment that
  // materializes the schema and then cannot boot on it.
  //
  // A Builder entity shadowed by a code-first one of the same slug contributes
  // nothing to this migration, so it is skipped rather than failed on — a
  // cleanup that changes no DDL is not worth blocking on.
  // Shadowing is per KIND: the manifest allows the same slug on a collection, a
  // single and a field group, and the merge resolves each kind separately. A
  // single set of dropped slugs would filter out an unshadowed single named
  // `home` because a collection of that name was shadowed, and it would then
  // reach the migration unchecked.
  const survivingOf = <T extends { slug: string }>(
    list: readonly T[],
    codeFirst: ReadonlyArray<{ slug: string }>
  ): T[] => {
    const shadowed = new Set(codeFirst.map(e => e.slug));
    return list.filter(e => !shadowed.has(e.slug));
  };

  assertPluginFieldDeclarations({
    collections: configResult.config.collections,
    singles: configResult.config.singles,
    fieldGroups: configResult.config.fieldGroups,
  });
  assertPluginFieldDeclarations({
    collections: survivingOf(
      manifest.collections,
      configResult.config.collections
    ),
    singles: survivingOf(manifest.singles, configResult.config.singles ?? []),
    fieldGroups: survivingOf(
      manifest.components,
      configResult.config.fieldGroups ?? []
    ),
  });

  // §4.12.7: per-dialect metadata-row upserts for UI-built entities that
  // survived the merge (code-first wins → shadowed UI slugs are skipped).
  const dropped = new Set(merged.droppedUiSlugs);
  const tn = (
    slug: string,
    prefix: "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix
  ) => `${prefix}${slug.replace(/-/g, "_")}`;
  const metadataUpserts: { tableName: string; sql: string }[] = [];
  for (const c of manifest.collections) {
    if (dropped.has(c.slug)) continue;
    metadataUpserts.push({
      tableName: tn(c.slug, "dc_"),
      sql: buildCollectionMetadataUpsert(c, dialect),
    });
  }
  for (const s of manifest.singles) {
    if (dropped.has(s.slug)) continue;
    metadataUpserts.push({
      tableName: tn(s.slug, "single_"),
      sql: buildSingleMetadataUpsert(s, dialect),
    });
  }
  for (const cp of manifest.components) {
    if (dropped.has(cp.slug)) continue;
    metadataUpserts.push({
      tableName: tn(cp.slug, STORAGE_FORMAT.tablePrefix),
      sql: buildComponentMetadataUpsert(cp, dialect),
    });
  }

  if (
    collections.length === 0 &&
    singles.length === 0 &&
    components.length === 0
  ) {
    logger.warn("No collections, singles, or components defined in config.");
    logger.info("Use --blank to create an empty migration for custom SQL.");
    return;
  }

  logger.newline();
  logger.info("Comparing config to latest snapshot...");

  let result;
  try {
    result = await generateMigration({
      name: name!,
      dialect,
      migrationsDir,
      defaultLocale: configResult.config.localization?.defaultLocale,
      collections,
      singles,
      components,
      metadataUpserts,
      nonInteractive,
      autoAcceptRenames: options.acceptRenames === true,
    });
  } catch (error) {
    // F11 PR 3 review fix #3: distinguish "operator cancelled prompt"
    // from real errors so we don't print a noisy "Failed to generate
    // migration: Cancelled by user." stack-style message.
    if (error instanceof PromptCancelledError) {
      // The prompt-renames helper already printed clack's `cancel()`
      // message before throwing. Just exit.
      process.exit(1);
    }
    logger.error(`Failed to generate migration: ${describeError(error)}`);
    process.exit(1);
  }

  if (result === null) {
    logger.newline();
    logger.info(
      "No changes detected. Your config matches the latest snapshot."
    );
    // Per spec: exit code 2 distinguishes "happy no-op" from "actual
    // error" so CI scripts can react differently.
    process.exit(2);
  }

  const duration = Date.now() - startTime;
  logger.newline();
  logger.success(`Created migration → ${result.sqlPath}`);
  logger.success(`Snapshot → ${result.snapshotPath}`);
  logger.keyValue("Operations", result.operationCount);
  if (result.renamesAccepted > 0) {
    logger.keyValue("Renames accepted", result.renamesAccepted);
  }
  logger.newline();
  logger.divider();
  logger.success(`Migration created in ${formatDuration(duration)}`);
  logger.newline();
  logger.info("Next steps:");
  logger.item("Review the generated .sql file", 1);
  logger.item("Commit it to git alongside your nextly.config.ts changes", 1);
  logger.item("Run `nextly migrate` to apply it", 1);
}

// ============================================================================
// --blank path
// ============================================================================

async function runBlankPath(
  name: string,
  dialect: SupportedDialect,
  migrationsDir: string,
  context: CommandContext,
  startTime: number
): Promise<void> {
  const { logger } = context;

  const now = new Date();
  const baseName = `${formatTimestamp(now)}_${slugify(name)}`;
  const sqlPath = resolve(migrationsDir, `${baseName}.sql`);

  await mkdir(migrationsDir, { recursive: true });
  // F11 PR 3 review fix #7: pass the slug-only name (not the timestamp-
  // prefixed baseName) so the file's `-- Migration:` header matches the
  // non-blank path's convention (e.g. "-- Migration: custom_seed", not
  // "-- Migration: 20260429_154500_123_custom_seed").
  const content = formatBlankFile(slugify(name), dialect, now);
  await writeFile(sqlPath, content, "utf-8");

  // F11 PR 3: blank migrations don't get a paired snapshot file. The
  // operator-authored SQL has no schema diff to capture; the next
  // `migrate:create` will diff against whatever the latest non-blank
  // snapshot is. (If they later want migrate:check to verify a hash for
  // their hand-written file, they can manually edit the snapshot — but
  // that's an advanced workflow and out of v1 scope.)

  const duration = Date.now() - startTime;
  logger.newline();
  logger.success(`Created blank migration → ${sqlPath}`);
  logger.newline();
  logger.divider();
  logger.success(`Blank migration created in ${formatDuration(duration)}`);
  logger.newline();
  logger.info("Edit the migration file to add your custom SQL.");
}

// ============================================================================
// Command Registration
// ============================================================================

// ============================================================================
// Plugin migrations (`--plugin <entry>`)
// ============================================================================

/**
 * A plugin's modules are bundled next to the code they migrate, so the same
 * externals list that keeps a config load off the CLI's dependency tree keeps
 * a plugin load off it too.
 */
const PLUGIN_BUNDLE_EXTERNALS = [
  "nextly",
  "@nextlyhq/*",
  "drizzle-orm",
  "drizzle-orm/*",
  "next",
  "next/*",
  "react",
  "react-dom",
  "node:*",
];

const PLUGIN_DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * Compile this plugin's schema with its declared dependencies present.
 *
 * `migrate:create --plugin` emits a module that ships INSIDE the plugin, so it
 * must describe the same schema in every app that installs it. That is why the
 * app's entity tables are not in the draft, and why the emitted module is
 * filtered to the tables this plugin owns.
 *
 * Declared dependencies are the one thing that rule does not exclude. A
 * `dependsOn` entry pins a version, so a dependency's tables are as fixed a
 * fact for this plugin as its own — which is why `addColumns` permits a plugin
 * to contribute to "a declared dependency's tables", and why boot accepts such
 * a hook. Compiling the plugin alone made that hook die on `Table "x" does not
 * exist`, so a plugin using a documented feature could run in development and
 * never generate a production migration.
 *
 * The dependencies are here so the hook RESOLVES, not so their tables ship:
 * the caller keeps only this plugin's own tables. The contributed column
 * travels the same road every cross-owner element travels in this codebase —
 * the app's migration stream, with a per-element owner row naming the
 * contributor.
 */
async function buildPluginDraft(args: {
  dialect: SupportedDialect;
  pluginName: string;
  pluginPrefixes: ReadonlyMap<string, string>;
  tables: SchemaContribution["tables"];
  extend: SchemaContribution["extend"];
  dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  dependencyPlugins: readonly PluginDefinition[];
}) {
  try {
    return await buildExtensionSchema({
      dialect: args.dialect,
      coreTableNames: CORE_TABLE_NAMES,
      entities: [],
      pluginPrefixes: args.pluginPrefixes,
      dependencies: args.dependencies,
      plugins: [
        ...args.dependencyPlugins.map(dependency => ({
          owner: { kind: "plugin" as const, id: dependency.name },
          tables: dependency.contributes?.schema?.tables ?? [],
          extend: dependency.contributes?.schema?.extend ?? [],
        })),
        {
          owner: { kind: "plugin" as const, id: args.pluginName },
          tables: args.tables,
          extend: args.extend,
        },
      ],
    });
  } catch (error) {
    const missing = missingExtendTarget(error);
    if (missing === undefined) throw error;
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        `Plugin "${args.pluginName}" has a schema.extend hook that extends "${missing}", ` +
        `which is not in the schema this command compiles. A plugin's migration module ships ` +
        `inside the plugin, so it is compiled from the plugin and its DECLARED DEPENDENCIES ` +
        `alone — never from the app's entity tables, which differ per installation. ` +
        `If "${missing}" belongs to a dependency, add that dependency to dependsOn and make sure ` +
        `it is present in the config this command loads. If it is an entity table, contribute the ` +
        `columns from the app instead: the app's migration stream owns elements on tables it does ` +
        `not declare.`,
      statusCode: 400,
    });
  }
}

/** The table a draft refusal says could not be extended, if that is what it says. */
function missingExtendTarget(error: unknown): string | undefined {
  if (!(error instanceof NextlyError)) return undefined;
  const errors = (
    error.publicData as { errors?: { message?: string }[] } | undefined
  )?.errors;
  for (const entry of errors ?? []) {
    const match =
      /^Table "(.+)" does not exist, so it cannot be extended\.$/.exec(
        entry.message ?? ""
      );
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Generate one plugin's migration module: compile the plugin's declared
 * tables per dialect, diff against the previous module's snapshot, and write
 * the module plus the rewritten `index.ts` barrel beside the entry.
 */
async function runMigrateCreatePlugin(
  name: string | undefined,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const cwd = options.cwd ?? process.cwd();
  const entryPath = resolve(cwd, options.plugin!);
  const migrationsDir = resolve(dirname(entryPath), "migrations");

  const { mod } = await bundleAndRequire({
    filepath: entryPath,
    cwd: dirname(entryPath),
    external: PLUGIN_BUNDLE_EXTERNALS,
  });
  const definition = (mod.default ?? mod) as Partial<PluginDefinition>;

  if (!definition.name) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: `The plugin entry ${relative(cwd, entryPath)} exports no definition with a name, so its migrations cannot be attributed.`,
      statusCode: 400,
    });
  }
  if (typeof definition.schemaVersion !== "number") {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: `Plugin "${definition.name}" declares no schemaVersion. A plugin needs one before migrations can be generated for it.`,
      statusCode: 400,
    });
  }

  const tables = definition.contributes?.schema?.tables ?? [];
  // The HOOKS as well as the declarative tables. `schema.addTable()` inside
  // `schema.extend` is a documented way to declare one — boot compiles and
  // pushes whatever it produces — and passing only `tables` here generated an
  // empty module for such a plugin. The table then existed through dev push
  // and was missing after a production migration, which is the one difference
  // migrations exist to prevent.
  //
  // A hook reaching for an ENTITY table finds none: this command compiles the
  // plugin alone, deliberately, because a plugin's migration must not depend
  // on which app installs it. Such a hook is refused by name here rather than
  // silently producing a module without it.
  const extend = definition.contributes?.schema?.extend ?? [];
  const prefix =
    definition.contributes?.schema?.prefix ??
    pluginAdminSlug(definition.name).replace(/-/g, "_");

  // Modules the plugin already ships; absent on first generation.
  let existing: PluginMigration[] = [];
  try {
    const loaded = await bundleAndRequire({
      filepath: resolve(migrationsDir, "index.ts"),
      cwd: migrationsDir,
      external: PLUGIN_BUNDLE_EXTERNALS,
    });
    const shipped = (loaded.mod as { migrations?: PluginMigration[] })
      .migrations;
    existing = orderedMigrations(shipped ?? []);
  } catch {
    // First generation: no barrel to read yet.
  }

  // Declared dependencies, compiled ALONGSIDE this plugin.
  //
  // `extendTable` on a dependency's table is a supported contribution —
  // `addColumns` permits "a plugin on a declared dependency's tables" — and
  // boot allows it because every plugin is compiled together there. This
  // command compiled the plugin alone, so the target was simply absent and the
  // hook died on `Table "x" does not exist`: valid in development, impossible
  // to generate a migration for.
  //
  // The dependency's tables go into the DRAFT so the hook resolves, and never
  // into the emitted module — the `owned` filter below keeps this module to
  // the tables this plugin's stream owns. The contributed COLUMN reaches
  // production the way every cross-owner element does in this codebase: on the
  // app's migration stream, with a per-element owner row naming the
  // contributor (see `recordElementOwners` in migrate.ts). A plugin module
  // carrying a column on a table it does not own would be a second answer to
  // a question that already has one.
  const dependencyNames = new Set([
    ...Object.keys(definition.dependsOn ?? {}),
    ...Object.keys(definition.optionalDependsOn ?? {}),
  ]);
  // The app's config, read ONLY to find the dependency definitions this plugin
  // declares. Its collections and entity tables are deliberately not compiled
  // — a plugin's module must not vary with the app that generates it. A repo
  // with no config loads defaults, which simply yields no dependencies, and
  // the refusal below then names what is missing.
  const dependencyPlugins: PluginDefinition[] =
    dependencyNames.size === 0
      ? []
      : (
          (await loadConfig({ configPath: options.config, cwd })).config
            .plugins ?? []
        ).filter(candidate => dependencyNames.has(candidate.name));
  const dependencies = new Map<string, ReadonlySet<string>>([
    [definition.name, dependencyNames],
  ]);
  const pluginPrefixes = new Map<string, string>([[definition.name, prefix]]);
  for (const dependency of dependencyPlugins) {
    pluginPrefixes.set(
      dependency.name,
      dependency.contributes?.schema?.prefix ??
        pluginAdminSlug(dependency.name).replace(/-/g, "_")
    );
  }

  const tablesByDialect = {} as Record<SupportedDialect, TableSpec[]>;
  for (const dialect of PLUGIN_DIALECTS) {
    const built = await buildPluginDraft({
      dialect,
      pluginName: definition.name,
      pluginPrefixes,
      tables,
      extend,
      dependencies,
      // Dependencies FIRST: `runExtensionHooks` takes the list already
      // topologically sorted, and a hook cannot extend a table the draft has
      // not been told about yet.
      dependencyPlugins,
    });
    // Only this plugin's own tables: a plugin migration carries exactly the
    // tables its stream owns, never an app's or another plugin's.
    const owned = new Set(
      built.tables
        .filter(
          table =>
            table.owner.kind === "plugin" && table.owner.id === definition.name
        )
        .map(table => table.name)
    );
    tablesByDialect[dialect] = built.specs.filter(spec => owned.has(spec.name));
  }

  const result = await generatePluginMigration({
    pluginName: definition.name,
    schemaVersion: definition.schemaVersion,
    name: name ?? "migration",
    migrationsDir,
    tablesByDialect,
    existing,
  });

  if (!result) {
    logger.info(
      `No schema changes detected for plugin "${definition.name}" — nothing to generate.`
    );
    process.exit(2);
  }

  logger.success(`Created ${relative(cwd, result.modulePath)}`);
  for (const dialect of PLUGIN_DIALECTS) {
    logger.info(
      `  ${getDialectDisplayName(dialect)}: ${result.operationCounts[dialect]} operation(s)`
    );
  }
  logger.info(`Rewrote ${relative(cwd, result.indexPath)}`);
}

export function registerMigrateCreateCommand(program: Command): void {
  program
    .command("migrate:create")
    .description(
      "Create a new migration file from schema changes or for custom SQL"
    )
    .argument("[name]", "Migration name (slug-cased, e.g., add_excerpt)")
    .option("--name <name>", "Migration name (alternate to positional arg)")
    .option("--blank", "Create an empty migration file for custom SQL", false)
    .option(
      "--non-interactive",
      "Skip interactive prompts (auto-detected from non-TTY)",
      false
    )
    .option(
      "--accept-renames",
      "ADVANCED: auto-accept all rename candidates in non-interactive mode",
      false
    )
    .option(
      "--plugin <entry>",
      "Generate the PLUGIN's migration module (path to its entry, e.g. ./src/index.ts)"
    )
    .action(
      async (
        positionalName: string | undefined,
        cmdOptions: MigrateCreateCommandOptions,
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals();
        const context = createContext(globalOpts);

        const resolvedOptions: ResolvedMigrateCreateOptions = {
          ...cmdOptions,
          config: globalOpts.config,
          verbose: globalOpts.verbose,
          quiet: globalOpts.quiet,
          cwd: globalOpts.cwd,
        };

        try {
          await runMigrateCreate(positionalName, resolvedOptions, context);
        } catch (error) {
          context.logger.error(describeError(error));
          process.exit(1);
        }
      }
    );
}
