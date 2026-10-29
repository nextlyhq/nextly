// F11 PR 3: orchestrator for `nextly migrate:create`.
//
// Pure orchestration — no I/O beyond the snapshot-io and file-write
// helpers. Composes:
//
//   1. Load latest snapshot from migrations/meta/ (or EMPTY_SNAPSHOT).
//   2. Build desired snapshot from nextly.config.ts (collections,
//      singles, components, optional user_ext).
//   3. diffSnapshots(prev, cur) → Operation[].
//   4. RegexRenameDetector.detect(ops) → RenameCandidate[].
//   5. Prompt operator via clack (or auto-accept/decline non-interactively).
//   6. Apply rename decisions to operations:
//      - Accept: replace matching (drop_column, add_column) pair with
//        a rename_column op.
//      - Decline: leave as drop + add.
//   7. Generate per-statement SQL via sql-templates/.
//   8. Write paired migrations/<ts>_<slug>.sql + migrations/meta/<ts>_<slug>.snapshot.json.
//
// Returns null when no operations remain (after rename collapsing) and no
// entity's settings changed: a settings change alone is written as a
// migration with no table statements, beside its snapshot.
// CLI exits with code 2 in that case ("no changes detected" — distinct
// from exit 1 for actual errors so CI scripts can tell apart).

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { isFieldLocalized } from "../../i18n/classify-fields";
import {
  type CompanionHistory,
  companionHistoryKey,
  readCompanionHistory,
} from "../../i18n/migration/companion-history";
import { uniqueTranslatedColumns } from "../../i18n/migration/companion-unique-indexes";
import {
  companionSpecShell,
  deriveCompanionSpec,
} from "../../i18n/migration/derive-companion-spec";
import { planFieldJoinsTranslationMigration } from "../../i18n/migration/field-joins-translation";
import {
  type LeavingTranslationRefusal,
  refusalsForFieldsJoiningTranslation,
  refusalsForFieldsLeavingTranslation,
} from "../../i18n/migration/field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "../../i18n/migration/field-to-column-spec";
import {
  planCompanionMigration,
  type CompanionMigrationPlan,
} from "../../i18n/migration/plan-companion-migration";
import {
  type FieldLeavesFile,
  type FieldLeavesMigrationPlan,
  planFieldLeavesTranslationMigration,
} from "../../i18n/migration/plan-field-leaves-migration";
import {
  planTranslatedUniqueMigration,
  type TranslatedUniquePlan,
} from "../../i18n/migration/plan-translated-unique-migration";
import type { I18nTransitionKind } from "../../i18n/migration/transition-state";
import type {
  CompanionMigrationSpec,
  LocalizedColumnSpec,
} from "../../i18n/migration/types";
import { writeCompanionMigrationFile } from "../../i18n/migration/write-migration-file";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
  type DeclaredIndex,
} from "../pipeline/diff/build-from-fields";
import { diffSnapshots } from "../pipeline/diff/diff";
import type {
  ColumnSpec,
  IndexSpec,
  NextlySchemaSnapshot,
  Operation,
  RenameColumnOp,
  TableSpec,
} from "../pipeline/diff/types";
import { withForeignKeysLiftedForTypeChanges } from "../pipeline/foreign-key-lift";
import { operationsToJudge } from "../pipeline/moved-to-companion";
import type { RenameCandidate } from "../pipeline/pushschema-pipeline-interfaces";
import { conversionForRename } from "../pipeline/rename-conversion";
import { RegexRenameDetector } from "../pipeline/rename-detector";
import { generateStatements } from "../pipeline/sql-templates/index";
import { sqliteTableRebuildStatements } from "../pipeline/sql-templates/sqlite-rebuild";

import {
  appStreamSnapshots,
  NO_APP_STREAM_TABLES,
  type AppStreamTables,
} from "./app-stream";
import { withCyclicForeignKeysSplit } from "./cyclic-foreign-keys";
import { buildInverseOperations } from "./down-generator";
import {
  describeSettingsChange,
  settingsChangesFor,
  settingsRecordOf,
  type EntitySettingsChange,
  type RecordedEntitySettings,
} from "./entity-settings";
import {
  formatMigrationFile,
  formatSnapshotRecordFile,
  formatTimestamp,
  slugify,
} from "./format-file";
import { promptRenames, type RenameDecision } from "./prompt-renames";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  writeSnapshot,
} from "./snapshot-io";

/**
 * A field as its entity declares it.
 *
 * Carried whole, never projected. The column descriptor, the index rules and
 * the localization classifier read keys beyond the ones named here — `virtual`
 * and `options` (a virtual group, a short or long text, a float number, a
 * many-to-many), `dbType`/`precision`/`scale`, `validation` — and dev push
 * hands them the declared field. A projection built here had to be extended
 * every time one of those readers learned a new key, and each key it missed
 * became a column `migrate:create` wrote and dev push did not, which
 * `migrate:check` then could not see because it read the same projection.
 */
export interface MinimalConfigField {
  name: string;
  type: string;
  required?: boolean;
  hasMany?: boolean;
  relationTo?: string | string[];
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
  virtual?: boolean;
  options?: unknown;
  [key: string]: unknown;
}

/**
 * Minimal collection / single / component shape we read from
 * `nextly.config.ts`. The full ConfigCollection has many more
 * attributes; we only need slug + tableName + fields + status for
 * diffing.
 */
export interface MinimalConfigEntity {
  slug: string;
  tableName: string;
  fields: MinimalConfigField[];
  /**
   * Compound indexes declared in the entity's config.
   *
   * Carried here because this mapper feeds BOTH `migrate:create` and
   * `migrate:check`. Dropping it from one would make the generator write an
   * index the checker then reports as drift, on every run.
   */
  indexes?: readonly DeclaredIndex[];
  /**
   * Whether the entity has Nextly's built-in Draft/Published lifecycle
   * enabled (`defineCollection({ status: true })` /
   * `defineSingle({ status: true })`). When true, the desired snapshot
   * includes the system `status` column so migrate:create emits the
   * column on first sync, and migrate:check correctly detects drift
   * when this flag flips. Components don't carry status — leave unset.
   */
  status?: boolean;
  /**
   * Whether content-localization is enabled for this collection, single, OR component
   * (`defineCollection({ localized: true })` / `defineSingle` / `defineFieldGroup`). When
   * true, fields resolved as translatable are omitted from the main-table desired snapshot
   * and relocated to the migration-owned companion `_locales` table (i18n Option B).
   */
  localized?: boolean;
  /**
   * The entity's declaration, as the snapshot records its settings: from the
   * code-first config (`toMinimalEntities`) or the Builder's manifest. Every
   * entity `migrate:create` hands in carries it, so each snapshot records every
   * entity's settings; one without it contributes no record, and a run in
   * which none carries one writes a snapshot that says nothing about settings.
   */
  settings?: RecordedEntitySettings;
}

export interface GenerateArgs {
  /** Slug-cased migration name (CLI's --name=<value>). */
  name: string;
  dialect: SupportedDialect;
  /** Absolute path to the `migrations/` directory. */
  migrationsDir: string;
  /** From `nextly.config.ts`. */
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  /**
   * UI-built metadata-row upserts (spec §4.12.7), keyed by data-table name.
   * Each is appended to the generated SQL when an operation touches its table
   * or the entity's settings changed: the row is how a Builder entity's
   * settings reach a deployed registry.
   */
  metadataUpserts?: { tableName: string; sql: string }[];
  /**
   * The same upserts built from the PREVIOUS snapshot's record of each Builder
   * entity, so a migration that writes a row for its settings alone can write
   * it back on the way down.
   */
  previousMetadataUpserts?: { tableName: string; sql: string }[];
  /**
   * Default locale for localized collections (from `config.localization.defaultLocale`).
   * Used as the `_locale` value when seeding existing rows into the companion table on
   * an enable transition. Defaults to `"en"` when omitted.
   */
  defaultLocale?: string;
  /**
   * Where to say what this run could not check, for the operator to act on. A warning never stops
   * the run; a refusal throws.
   */
  onWarning?: (message: string) => void;
  /**
   * The extension schema the APP's stream owns: the tables it declares through
   * `db.schema.extend`, and the elements it contributes to tables another owner
   * declares.
   *
   * Without it the generator only ever saw collections, singles and
   * components, so a table an app declared through the documented extend hook
   * was created by development bootstrap and silently absent from every
   * migration — the one difference migrations exist to prevent. A PLUGIN's own
   * tables are not here: those ride the plugin's module, which
   * `migrate:create --plugin` writes.
   */
  appStream?: AppStreamTables;
  /** Skip interactive prompts (non-TTY / CI). */
  nonInteractive?: boolean;
  /** Only meaningful with nonInteractive=true. Default = decline. */
  autoAcceptRenames?: boolean;
  /**
   * `--record-snapshot`: write a migration that changes nothing, whose snapshot records which fields are
   * translated, for a config with nothing to migrate. Refuses a config that has something; returns
   * null when the latest snapshot already records them.
   */
  recordSnapshot?: boolean;
  /**
   * Override the timestamp for tests. Production callers omit and get
   * `new Date()`.
   */
  now?: Date;
}

export interface GenerateResult {
  sqlPath: string;
  snapshotPath: string;
  /** Operation count AFTER rename collapsing. */
  operationCount: number;
  /** Number of rename candidates the operator confirmed. */
  renamesAccepted: number;
  /**
   * Each entity whose settings changed since the previous snapshot, whether or
   * not this migration changes its table. Empty when only tables changed.
   */
  settingsChanges: EntitySettingsChange[];
}

/** The table an operation acts on (for correlating metadata upserts). */
function operationTableName(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return op.table.name;
    case "rename_table":
      return op.toName;
    default:
      return op.tableName;
  }
}

/**
 * Run the migrate:create orchestration. Returns null if no operations
 * remain (config matches latest snapshot — exit code 2 in the CLI).
 */
export async function generateMigration(
  args: GenerateArgs
): Promise<GenerateResult | null> {
  const metaDir = resolve(args.migrationsDir, "meta");
  // Single clock for the whole run so the main file and its companions share a
  // deterministic base timestamp (companions get a strictly-later one below).
  const now = args.now ?? new Date();

  // 1. Load previous state.
  const previous = await loadLatestSnapshot(metaDir);

  // 2. Build desired snapshot from config. Localized collections omit their
  //    translatable columns here (they live in the companion `_locales` table).
  //    The app stream's extension tables are folded into BOTH sides, since a
  //    table the app contributes to is compared over its owner's current
  //    declaration rather than over the copy the last snapshot froze.
  const stream = appStreamSnapshots({
    previous: previous?.data.snapshot ?? EMPTY_SNAPSHOT,
    previousContributions: previous?.data.contributions ?? {},
    desired: buildDesiredSnapshotFromConfig(
      args.collections,
      args.singles,
      args.components,
      args.dialect
    ),
    tables: args.appStream ?? NO_APP_STREAM_TABLES,
  });
  const previousSnapshot = stream.previous;
  const desiredSnapshot = stream.desired;

  // 2a. Plan companion `_locales` migrations for localized collections, singles, AND
  //     components (i18n Option B: companions are migration-owned, emitted as
  //     snapshot-less .sql). All three derive their companion the same way — from the
  //     entity's table name — so a single planner call over the merged list covers them.
  // Tagged rather than concatenated: the kind is half of the transition marker's key, so an entry
  // that lost track of which list it came from could not name the record it belongs to.
  // What the companion files left: each companion's columns, and which companions exist.
  const companionHistory = await readCompanionHistory(args.migrationsDir);
  const entities = [
    ...args.collections.map(e => tagged(e, "collection")),
    ...args.singles.map(e => tagged(e, "single")),
    ...args.components.map(e => tagged(e, "fieldGroup")),
  ];
  // A recording run refuses any change below, this one included, as a change to migrate.
  if (args.recordSnapshot !== true) {
    refuseUnrecordedTranslationChanges(
      entities,
      previousSnapshot,
      companionHistory,
      args.dialect,
      args.name
    );
  }
  const companionPlans = planCompanionMigrations(
    entities,
    previousSnapshot,
    args.dialect,
    args.defaultLocale ?? "en",
    companionHistory
  );

  // 3. Diff.
  let operations = diffSnapshots(previousSnapshot, desiredSnapshot);

  // 3a. On an ENABLE transition the diff wants to DROP the localized columns
  //     from the main table — but the companion migration already relocates them
  //     (create + seed + drop). Strip those drops so we don't drop twice.
  operations = stripRelocatedDrops(operations, companionPlans);

  // 3b. Fields that stop being translated while their entity stays translated. The diff above gives
  //     the main table their columns; these files move the values around that migration.
  const fieldLeavesPlans = planFieldsLeavingTranslation(
    entities,
    previousSnapshot,
    args.dialect,
    args.defaultLocale ?? "en",
    companionHistory,
    args.onWarning ?? (() => {}),
    desiredSnapshot
  );

  // 3c. Shared fields that become translated while their entity stays translated. The diff above
  //     drops their main columns; these files move the values to the companion before it does.
  const fieldJoinsPlans = planFieldsJoiningTranslation(
    entities,
    previousSnapshot,
    args.dialect,
    args.defaultLocale ?? "en",
    companionHistory
  );

  // 3d. Translated fields that become or stop being unique within each language. Their companion
  //     indexes are dropped before the main file and created after every other file.
  const uniquePlans = planTranslatedUniqueMigrations(
    entities,
    previousSnapshot,
    args.dialect,
    args.defaultLocale ?? "en"
  );

  const hasCompanions =
    companionPlans.length > 0 ||
    fieldLeavesPlans.length > 0 ||
    fieldJoinsPlans.length > 0 ||
    uniquePlans.length > 0;

  // 3e. Settings: what the declarations say beyond their columns. A change to
  //     one alone changes no table, so without this the run returned "no
  //     changes" and the setting never reached a deployed database. Compared
  //     with the previous snapshot's record; a previous snapshot that predates
  //     the record says nothing about settings, so each entity is named as
  //     recorded for the first time (`settingsChanges`).
  const settingsRecord = settingsRecordOf(args);
  const changedSettings = settingsChangesFor(
    args,
    previous === null ? null : previous.data.entities
  );
  const hasSettingsChanges = changedSettings.length > 0;

  if (args.recordSnapshot === true) {
    refuseChangesToRecord([
      ...operations.map(operationTableName),
      ...[
        ...companionPlans,
        ...fieldLeavesPlans.map(({ plan }) => plan.shared),
        ...fieldJoinsPlans.map(({ plan }) => plan),
        ...uniquePlans,
      ].map(({ spec }) => spec.mainTable),
    ]);
    // A settings change alone is written below as the settings-only migration it is, and its
    // snapshot records the translated fields as every snapshot does.
    if (!hasSettingsChanges) {
      return recordSnapshot(args, {
        previous: previous?.data.snapshot ?? EMPTY_SNAPSHOT,
        written: stream.written,
        contributions: stream.contributions,
        entities: settingsRecord,
        unread: companionHistory.unread,
        metaDir,
        now,
      });
    }
  }
  if (operations.length === 0 && !hasCompanions && !hasSettingsChanges) {
    return null;
  }

  // 4-6. Rename detection + prompt + apply — only meaningful when the main table
  //      itself changed. A localization-only run has no main-table ops to rename.
  let decisions: RenameDecision[] = [];
  if (operations.length > 0) {
    const detector = new RegexRenameDetector();
    // A joining field's main column goes to the companion, not to another main column, so its
    // drop is no rename source.
    const candidates = detector.detect(
      operationsToJudge(
        operations,
        fieldJoinsPlans.flatMap(({ plan }) =>
          plan.spec.columns.map(column => ({
            tableName: plan.spec.mainTable,
            columnName: column.name,
          }))
        )
      ),
      args.dialect
    );
    decisions = await promptRenames(candidates, {
      nonInteractive: args.nonInteractive,
      autoAccept: args.autoAcceptRenames,
    });
    operations = applyRenameDecisions(
      operations,
      decisions,
      args.dialect,
      previousSnapshot
    );
  }
  if (operations.length === 0 && !hasCompanions && !hasSettingsChanges) {
    return null;
  }

  // 6a. A Required or Unique field leaving translation gets its main column without the setting:
  //     created with it, every row would hold NULL or one placeholder before the `shared` file
  //     copies the default language's values in. That file applies the settings after the copy.
  const heldSettings = fieldLeavesPlans.map(({ held }) => held);
  operations = withSettingsHeldBack(operations, heldSettings);

  // 7. Generate UP SQL per op, a foreign-key cycle's keys split out of the
  // table operations that cannot carry them (see `withCyclicForeignKeysSplit`),
  // and — on MySQL — every existing key a type change covers lifted around it,
  // as dev push lifts them. The DOWN below inverts these ops, so it lifts the
  // same keys around the reverse change.
  operations = withCyclicForeignKeysSplit(
    withForeignKeysLiftedForTypeChanges(
      operations,
      previousSnapshot.tables,
      args.dialect
    ),
    args.dialect,
    previousSnapshot.tables
  );
  // Rendered as a list, not one statement per operation: on SQLite a check
  // or foreign-key change is a rebuild of its table to the schema the list
  // leads to — the desired side for the UP, the previous side for the DOWN.
  const sqlStatements = generateStatements(
    operations,
    args.dialect,
    // A table rebuilt here is rebuilt to the shape this file leaves it in: the settings held back.
    tablesWithSettingsHeldBack(desiredSnapshot.tables, heldSettings)
  );

  // 7a. Generate DOWN SQL by inverting the RESOLVED ops (renames preserved).
  // Inverting the resolved ops — not re-diffing — keeps a forward rename as a
  // reverse rename rather than a data-losing drop+add. Object-removing ops
  // recover their original spec from previousSnapshot.
  const inverseOps = withCyclicForeignKeysSplit(
    restoredNullable(
      buildInverseOperations(operations, previousSnapshot),
      fieldJoinsPlans
    ),
    args.dialect,
    desiredSnapshot.tables
  );
  const downSqlStatements = generateStatements(
    inverseOps,
    args.dialect,
    previousSnapshot.tables
  );

  // 7b. Append UI metadata-row upserts for any UI-built table this migration
  //     touches (§4.12.7), and for any whose entity's settings changed: the row
  //     is where a Builder entity's settings live, so it travels with them.
  const touched = new Set(operations.map(operationTableName));
  const rows = registryRowsFor(
    touched,
    tablesOfSettingsChanges(changedSettings, args),
    args
  );
  sqlStatements.push(...rows.up);
  downSqlStatements.push(...rows.down);

  /*
   * 8. Compose file content + write both files.
   *
   * 🔴 The entity headers name what this migration CHANGES, not everything the
   * config describes. The header is the only per-file record of which entities
   * a migration carries, and `migrate` reads it to decide whether a registry
   * row is still waiting on something — a header listing the whole manifest
   * makes every migration look like it touches every entity, which answers that
   * question the same way for all of them and so answers it for none.
   *
   * Matched on the EXACT table name. A prefix match looks like it would also
   * catch companion tables, and catches unrelated entities instead: a
   * collection whose table is `dc_posts_archive` shares the `dc_posts_` prefix
   * with `dc_posts`, so editing the archive would name `posts` as well and hold
   * a dashboard it has nothing to do with. Over-naming fails in the expensive
   * direction here — a withheld row is an empty dashboard with nothing on
   * screen to explain it.
   *
   * A localization transition is not covered by THIS header and does not need
   * to be: those are emitted as their own companion `.sql` files, which carry
   * their own header naming the entity by kind.
   *
   * 🔴 An entity REMOVED from the config cannot be named, because the filter
   * runs over the config as it is now and the entity is no longer in it — so a
   * migration that drops its table declares scope and omits the entity whose
   * table it drops. Naming it needs the previous entity manifest, which no
   * caller passes; the previous SNAPSHOT holds tables, not slugs, so the
   * mapping is not recoverable here. The consequence is under-naming, which
   * leaves such a row promoted as it was before rather than withheld — the
   * cheap direction, and the reason this is recorded rather than guessed at.
   */
  const namesTouched = (entity: MinimalConfigEntity): boolean =>
    touched.has(entity.tableName);

  const collectionSlugs = args.collections
    .filter(namesTouched)
    .map(c => c.slug)
    .sort();
  const singleSlugs = args.singles
    .filter(namesTouched)
    .map(c => c.slug)
    .sort();
  const componentSlugs = args.components
    .filter(namesTouched)
    .map(c => c.slug)
    .sort();
  const sqlContent = formatMigrationFile({
    name: args.name,
    dialect: args.dialect,
    sqlStatements,
    downSqlStatements,
    collections: collectionSlugs,
    singles: singleSlugs,
    components: componentSlugs,
    hasUserExt: false, // F11 PR 3 doesn't model user_ext in migrate:create yet (out of scope).
    settingsChanges: changedSettings.map(describeSettingsChange),
    changesNoTable: operations.length === 0,
    now,
  });

  const baseName = `${formatTimestamp(now)}_${slugify(args.name)}`;
  await mkdir(args.migrationsDir, { recursive: true });
  const sqlPath = resolve(args.migrationsDir, `${baseName}.sql`);
  await writeFile(sqlPath, sqlContent, "utf-8");

  const snapshotPath = await writeSnapshot(
    metaDir,
    baseName,
    stream.written,
    sqlContent,
    stream.contributions,
    settingsRecord
  );

  // 9. Emit the snapshot-less companion `.sql` files around the main migration, ordered by kind:
  //    - ENABLE / create-only: the companion's FK references the main table, so it must run
  //      strictly AFTER the main file — give each a timestamp a few ms later.
  //    - DISABLE: the companion migration RE-ADDS the formerly-localized columns to the main
  //      table, so any main-migration DDL that references a restored column (e.g. an index on a
  //      now-shared field) must run AFTER it — give each a timestamp a few ms BEFORE the main
  //      file so `nextly migrate` restores the column before the main migration indexes it.
  const disablePlans = companionPlans.filter(p => p.plan.kind === "disable");
  const forwardPlans = companionPlans.filter(p => p.plan.kind !== "disable");
  // `plan.spec` rather than the entry's: an ENABLE narrows `columnsOnMain` to what the previous
  // main table really held, and the header has to describe the statements that were emitted.
  //    - A field leaving translation: its ARCHIVE file runs before the main file, so an archive that
  //      refuses the values stops the run before the main table changes; its SHARED file runs after
  //      it, once the main table has the column to copy into.
  //    - A translated field's per-language unique index that goes: first of all, before any
  //      file drops or renames a column it keys on.
  const beforeMain = [
    ...uniquePlans.flatMap(({ spec, plan, entity }) =>
      plan.drops === null
        ? []
        : [{ spec, kind: "unique" as const, entity, ...plan.drops }]
    ),
    ...disablePlans.map(({ plan, entity }) => ({
      spec: plan.spec,
      kind: "disable" as const,
      entity,
      upSql: plan.upSql,
      downSql: plan.downSql,
    })),
    ...fieldLeavesPlans.map(({ plan, entity }) => ({
      spec: plan.archive.spec,
      kind: "archive" as const,
      entity,
      upSql: plan.archive.upSql,
      downSql: plan.archive.downSql,
    })),
    //    - A field becoming translated: its JOINS file runs before the main file, which drops the
    //      field's main column, so the value is on the companion first.
    ...fieldJoinsPlans.map(({ plan, entity }) => ({
      spec: plan.spec,
      kind: "joins" as const,
      entity,
      upSql: plan.upSql,
      downSql: plan.downSql,
    })),
  ];
  beforeMain.forEach(({ spec, ...file }, i) => {
    writeCompanionMigrationFile(args.migrationsDir, spec, {
      ...file,
      now: new Date(now.getTime() - (beforeMain.length - i)),
    });
  });
  forwardPlans.forEach(({ plan, entity }, i) => {
    writeCompanionMigrationFile(args.migrationsDir, plan.spec, {
      // `none` plans are filtered out by the planner, so the kind is always writable here.
      kind: plan.kind === "none" ? "create-only" : plan.kind,
      entity,
      upSql: plan.upSql,
      downSql: plan.downSql,
      now: new Date(now.getTime() + i + 1),
    });
  });
  fieldLeavesPlans.forEach(({ plan, entity }, i) => {
    writeCompanionMigrationFile(args.migrationsDir, plan.shared.spec, {
      kind: "shared",
      entity,
      upSql: plan.shared.upSql,
      downSql: plan.shared.downSql,
      now: new Date(now.getTime() + forwardPlans.length + i + 1),
    });
  });
  //    - A translated field's per-language unique index that is new: last, once every column it
  //      keys on exists.
  const createsAfter = forwardPlans.length + fieldLeavesPlans.length;
  uniquePlans
    .flatMap(({ spec, plan, entity }) =>
      plan.creates === null
        ? []
        : [
            {
              // Its header names the fields it indexes, for `nextly migrate`'s pre-check.
              spec: { ...spec, unique: plan.creates.unique },
              entity,
              upSql: plan.creates.upSql,
              downSql: plan.creates.downSql,
            },
          ]
    )
    .forEach(({ spec, ...file }, i) => {
      writeCompanionMigrationFile(args.migrationsDir, spec, {
        ...file,
        kind: "unique",
        now: new Date(now.getTime() + createsAfter + i + 1),
      });
    });

  return {
    sqlPath,
    snapshotPath,
    operationCount: operations.length,
    renamesAccepted: decisions.filter(d => d.accepted).length,
    settingsChanges: changedSettings,
  };
}

/**
 * `--record-snapshot` records the config as it is, so it refuses a config with a table change to
 * migrate: a snapshot that took in a change no migration made would hide it from every later run.
 */
function refuseChangesToRecord(tables: readonly string[]): void {
  if (tables.length === 0) return;
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      "--record-snapshot records the config as it is, and the config has changes the latest snapshot doesn't. Nothing was written. " +
      "Undo them, run `nextly migrate:create --record-snapshot`, then make them again and run `nextly migrate:create --name <name>`.",
  });
}

/**
 * `--record-snapshot`: a migration that changes nothing, whose snapshot is the config as it is, recording
 * which fields are translated. The way past `refuseUnrecordedTranslationChanges`: run with the
 * change undone, so the snapshot records the fields as they were.
 *
 * Only for a config with nothing to migrate (`refuseChangesToRecord`). Null when there is nothing
 * to record: the latest snapshot already records the translated fields as the config has them,
 * and no companion file this build cannot read comes after the last record.
 */
async function recordSnapshot(
  args: GenerateArgs,
  run: {
    previous: NextlySchemaSnapshot;
    written: NextlySchemaSnapshot;
    contributions: Parameters<typeof writeSnapshot>[4];
    entities: Parameters<typeof writeSnapshot>[5];
    unread: boolean;
    metaDir: string;
    now: Date;
  }
): Promise<GenerateResult | null> {
  const recorded = (snapshot: NextlySchemaSnapshot) =>
    JSON.stringify(
      snapshot.tables
        .filter(t => t.localized === true)
        .map(t => ({
          name: t.name,
          columns: [...(t.localizedColumns ?? [])].sort(),
          unique: [...(t.uniqueLocalizedColumns ?? [])]
            .map(u => (typeof u === "string" ? u : `${u.column}:${u.kind}`))
            .sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  if (!run.unread && recorded(run.previous) === recorded(run.written)) {
    return null;
  }

  const sqlContent = formatSnapshotRecordFile(args.name, args.dialect, run.now);
  const baseName = `${formatTimestamp(run.now)}_${slugify(args.name)}`;
  await mkdir(args.migrationsDir, { recursive: true });
  const sqlPath = resolve(args.migrationsDir, `${baseName}.sql`);
  await writeFile(sqlPath, sqlContent, "utf-8");
  const snapshotPath = await writeSnapshot(
    run.metaDir,
    baseName,
    run.written,
    sqlContent,
    run.contributions,
    run.entities
  );
  return {
    sqlPath,
    snapshotPath,
    operationCount: 0,
    renamesAccepted: 0,
    settingsChanges: [],
  };
}

/**
 * The Builder registry-row upserts a migration carries: UP writes the row of
 * each table it touches and of each entity whose settings changed. A row that
 * travels only because its settings changed goes back with the rollback, so
 * DOWN writes it as the previous snapshot recorded it; a row the previous
 * snapshot has no record of has nothing to go back to.
 */
function registryRowsFor(
  touched: ReadonlySet<string>,
  settingsTables: ReadonlySet<string>,
  args: Pick<GenerateArgs, "metadataUpserts" | "previousMetadataUpserts">
): { up: string[]; down: string[] } {
  return {
    up: (args.metadataUpserts ?? [])
      .filter(m => touched.has(m.tableName) || settingsTables.has(m.tableName))
      .map(m => m.sql),
    down: (args.previousMetadataUpserts ?? [])
      .filter(m => settingsTables.has(m.tableName) && !touched.has(m.tableName))
      .map(m => m.sql),
  };
}

/** The tables of the entities whose settings changed, by kind and slug. */
function tablesOfSettingsChanges(
  changes: readonly EntitySettingsChange[],
  entities: Pick<GenerateArgs, "collections" | "singles" | "components">
): Set<string> {
  const lists = {
    collection: entities.collections,
    single: entities.singles,
    fieldGroup: entities.components,
  };
  const tables = new Set<string>();
  for (const change of changes) {
    const entity = lists[change.kind].find(e => e.slug === change.slug);
    if (entity) tables.add(entity.tableName);
  }
  return tables;
}

/**
 * Build the companion spec for a DISABLE from the columns the PREVIOUS snapshot
 * recorded, rather than from the current config's classification.
 *
 * The snapshot's `localizedColumns` is the only trustworthy statement of what the `_locales`
 * table physically holds at this point, so the restore/archive SQL is generated against exactly
 * those columns. Each recorded column still needs a DDL type, which is read from the field that
 * owns it — the fields themselves survive a disable (only the flag changes), so this resolves
 * for the realistic cases. A recorded column whose field was deleted in the same edit has no
 * type to restore and is skipped: its translations stay archived rather than emitting SQL for a
 * column that has nowhere to land.
 */
function buildDisableSpec(
  entity: MinimalConfigEntity,
  kind: I18nTransitionKind,
  prevMain: TableSpec,
  dialect: SupportedDialect,
  defaultLocale: string
): CompanionMigrationSpec | null {
  const recorded = prevMain.localizedColumns;
  if (!recorded || recorded.length === 0) return null;

  const columns: LocalizedColumnSpec[] = [];
  for (const f of entity.fields) {
    const col = fieldToLocalizedColumnSpec(f, dialect, "codeFirst");
    if (col && recorded.includes(col.name)) columns.push(col);
  }
  if (columns.length === 0) return null;

  return {
    dialect,
    collection: entity.slug,
    kind,
    mainTable: prevMain.name,
    companionTable: `${prevMain.name}_locales`,
    defaultLocale,
    parentIdType: dialect === "mysql" ? "VARCHAR(36)" : "TEXT",
    columns,
    status: entity.status === true,
  };
}

/** A localized collection's derived companion spec paired with its planned migration. */
interface CompanionPlanEntry {
  spec: CompanionMigrationSpec;
  plan: CompanionMigrationPlan;
  /**
   * Which kind of entity the companion belongs to. Carried per entry rather than derived later
   * because the three kinds are planned from one merged list, and the transition marker written
   * for this companion is keyed by kind as well as slug.
   */
  entity: I18nTransitionKind;
}

/**
 * Plan the companion `_locales` migration for every localized entity (collection, single, OR
 * component), comparing the previous committed snapshot's main table against the new localized
 * spec. All three share the same shape — a main table with an `id` PK — so the companion
 * (`<table>_locales`, FK → main.id) is derived identically from the entity's table name.
 *
 * The transition is derived purely from the previous snapshot (companions are NOT stored in
 * snapshots — they are migration-owned):
 *   - previous main table absent           → fresh entity  → create-only companion.
 *   - previous main table HELD the columns → enabling now  → create + seed + drop.
 *   - previous main table lacked them      → already localized → none (companion exists).
 */
/**
 * Each translated entity's `unique` files (`planTranslatedUniqueMigration`): its per-language
 * unique indexes as the previous snapshot recorded them, brought to the ones its config now asks
 * for. An entity that is not translated now has no companion left to index.
 */
function planTranslatedUniqueMigrations(
  entities: TaggedConfigEntity[],
  previousSnapshot: NextlySchemaSnapshot,
  dialect: SupportedDialect,
  defaultLocale: string
): {
  entity: I18nTransitionKind;
  spec: CompanionMigrationSpec;
  plan: TranslatedUniquePlan;
}[] {
  return entities.flatMap(({ entity: c, kind }) => {
    if (c.localized !== true) return [];
    const derive = {
      builtBy: "codeFirst" as const,
      slug: c.slug,
      kind,
      dbName: c.tableName,
      fields: c.fields,
      dialect,
      defaultLocale,
      collectionLocalized: true,
      status: c.status === true,
    };
    // With no field translated now, the companion is still addressed when the previous snapshot
    // recorded per-language unique indexes on it: the last such field to leave translation takes
    // its index with it, ahead of the file that drops its column.
    const shell = companionSpecShell(derive);
    const previous = previousSnapshot.tables.find(
      t => t.name === shell.mainTable
    );
    const spec =
      deriveCompanionSpec(derive) ??
      (previous?.localized === true &&
      (previous.uniqueLocalizedColumns ?? []).length > 0
        ? shell
        : null);
    if (!spec) return [];
    const plan = planTranslatedUniqueMigration({
      spec,
      fields: c.fields,
      previous,
    });
    return plan === null ? [] : [{ entity: kind, spec, plan }];
  });
}

/** Pair an entity with the kind of list it came from, which its companion's marker is keyed by. */
function tagged(
  entity: MinimalConfigEntity,
  kind: I18nTransitionKind
): TaggedConfigEntity {
  return { entity, kind };
}

interface TaggedConfigEntity {
  entity: MinimalConfigEntity;
  kind: I18nTransitionKind;
}

function planCompanionMigrations(
  entities: TaggedConfigEntity[],
  previousSnapshot: NextlySchemaSnapshot,
  dialect: SupportedDialect,
  defaultLocale: string,
  history: CompanionHistory
): CompanionPlanEntry[] {
  const entries: CompanionPlanEntry[] = [];
  for (const { entity: c, kind: entityKind } of entities) {
    // Derive the companion spec with `collectionLocalized: true` regardless of the
    // entity's CURRENT flag. For a localized entity this describes the companion to create;
    // for one being DISABLED it is the starting point that the previous snapshot's recorded
    // column list then corrects (see below). Returns null when no field is translatable.
    const spec = deriveCompanionSpec({
      builtBy: "codeFirst" as const,
      slug: c.slug,
      kind: entityKind,
      dbName: c.tableName,
      fields: c.fields,
      dialect,
      defaultLocale,
      collectionLocalized: true,
      status: c.status === true, // i18n M6: companion gets a per-locale `_status` column
    });

    // the DISABLE transition (localized `true → false`).
    // Detection is gated on the previous snapshot's explicit `localized: true` marker rather
    // than inferred from column shape: a shape-only heuristic cannot tell "this collection
    // was localized" apart from "someone added fields to a non-localized collection", and
    // false-positively archiving + dropping a table is far worse than not automating a rare
    // disable. A pre-marker snapshot records no marker, so it reads as unknown and no
    // transition is emitted — that self-heals as soon as one migrate:create runs while the
    // entity is still localized.
    if (c.localized !== true) {
      const prevMain = previousSnapshot.tables.find(
        t => t.name === (spec?.mainTable ?? c.tableName)
      );
      if (prevMain?.localized !== true) continue;
      // The snapshot's recorded column list is the AUTHORITATIVE description of what the
      // companion actually holds; the current config is not, because the same edit that
      // flipped the switch may also have added or unflagged fields. Restoring exactly the
      // recorded columns keeps the transition correct in both directions:
      //   - a field whose `localized: true` was removed alongside the switch is still brought
      //     home (it is in the recorded list even though it no longer classifies);
      //   - a translatable field ADDED in the same edit is left to the normal diff, instead of
      //     being restored from a companion that never had that column (which emitted SQL that
      //     failed on apply).
      const disableSpec = buildDisableSpec(
        c,
        entityKind,
        prevMain,
        dialect,
        defaultLocale
      );
      if (!disableSpec) continue;
      const plan = planCompanionMigration({
        spec: disableSpec,
        prevMainColumnNames: [],
        companionExisted: false,
        localized: false,
        previouslyLocalized: true,
      });
      if (plan.kind !== "none")
        entries.push({ spec: disableSpec, plan, entity: entityKind });
      continue;
    }

    if (!spec) continue;

    const prevTable = previousSnapshot.tables.find(
      t => t.name === spec.mainTable
    );
    const prevMainColumnNames = prevTable
      ? prevTable.columns.map(col => col.name)
      : [];
    // If the table existed but the localized columns are already gone, a prior
    // migration created the companion → nothing to do (companionExisted). A field joining
    // translation still has its main column, but its move is the `joins` file's, so it does not
    // make this an enable.
    const joining = new Set(
      fieldsJoiningTranslationIn(
        { entity: c, kind: entityKind },
        previousSnapshot,
        history,
        dialect
      ).map(j => j.column.name)
    );
    const hadLocalizedColumns = spec.columns.some(
      col => prevMainColumnNames.includes(col.name) && !joining.has(col.name)
    );
    const companionExisted = prevTable !== undefined && !hadLocalizedColumns;

    const plan = planCompanionMigration({
      spec,
      prevMainColumnNames,
      companionExisted,
    });
    if (plan.kind !== "none") entries.push({ spec, plan, entity: entityKind });
  }
  return entries;
}

/** One entity's fields that stop being translated, and the two files that move their values. */
interface FieldLeavesEntry {
  plan: FieldLeavesMigrationPlan;
  entity: I18nTransitionKind;
  /** The settings the main migration leaves off, which the `shared` file applies. */
  held: HeldSettings;
}

/**
 * Plan the files for fields that stop being translated while their entity stays translated: those
 * translated before this change (`previousTranslation`) which the config now declares shared.
 *
 * A field that cannot leave translation in one migration (`refusalsForFieldsLeavingTranslation`)
 * refuses the whole run, naming the steps that work.
 */
function planFieldsLeavingTranslation(
  entities: TaggedConfigEntity[],
  previousSnapshot: NextlySchemaSnapshot,
  dialect: SupportedDialect,
  defaultLocale: string,
  history: CompanionHistory,
  warn: (message: string) => void,
  desiredSnapshot: NextlySchemaSnapshot
): FieldLeavesEntry[] {
  const entries: FieldLeavesEntry[] = [];
  for (const entry of entities) {
    const { entity: c, kind } = entry;
    warnOfRenamesIntoShared(entry, previousSnapshot, history, dialect, warn);
    const leaving = fieldsLeavingTranslationIn(
      entry,
      previousSnapshot,
      history,
      dialect
    );
    if (leaving.length === 0) continue;

    // The companion's columns as the migration files left them: the only record of the shape a
    // translated field's values sit in, which the snapshot does not keep.
    const previousColumns = history.columns.get(
      companionHistoryKey(kind, c.slug)
    );
    warnOfUnknownShapes(c.slug, leaving, previousColumns, warn);
    const desiredMain = desiredSnapshot.tables.find(
      t => t.name === c.tableName
    );
    assertFieldsMayLeaveTranslation(c, leaving, previousColumns, dialect);
    const held = heldSettingsOf(
      c.tableName,
      leaving.map(l => l.column.name),
      desiredMain
    );

    entries.push({
      entity: kind,
      held,
      plan: planFieldLeavesTranslationMigration(
        {
          dialect,
          collection: c.slug,
          kind,
          mainTable: c.tableName,
          companionTable: `${c.tableName}_locales`,
          defaultLocale,
          parentIdType: dialect === "mysql" ? "VARCHAR(36)" : "TEXT",
          columns: leaving.map(l => l.column),
          // A rollback recreates default-language rows with the main row's publishing state, when
          // both have one: Draft/Published on before this change, so the companion has `_status`,
          // and still on after it, so the main table still has `status` when the rollback runs.
          status:
            c.status === true &&
            previousSnapshot.tables
              .find(t => t.name === c.tableName)
              ?.columns.some(col => col.name === "status") === true,
        },
        desiredMain
          ? settingsAfterCopy(
              held,
              desiredMain,
              dialect,
              desiredSnapshot.tables
            )
          : undefined
      ),
    });
  }
  return entries;
}

/**
 * The main-table settings fields leaving translation take on after their values are copied, as
 * the desired main table has them: the columns it makes required, and its unique indexes over a
 * leaving column.
 */
interface HeldSettings {
  tableName: string;
  required: ReadonlySet<string>;
  uniqueIndexes: readonly IndexSpec[];
}

function heldSettingsOf(
  tableName: string,
  columns: readonly string[],
  desiredMain: TableSpec | undefined
): HeldSettings {
  const leaving = new Set(columns);
  return {
    tableName,
    required: new Set(
      (desiredMain?.columns ?? [])
        .filter(column => leaving.has(column.name) && !column.nullable)
        .map(column => column.name)
    ),
    uniqueIndexes: (desiredMain?.indexes ?? []).filter(
      index => index.unique && index.columns.some(name => leaving.has(name))
    ),
  };
}

/** The main migration's operations with each held setting left off. */
function withSettingsHeldBack(
  operations: Operation[],
  held: readonly HeldSettings[]
): Operation[] {
  const byTable = new Map(held.map(h => [h.tableName, h]));
  return operations.flatMap((op): Operation[] => {
    const h = byTable.get(operationTableName(op));
    if (op.type === "add_column" && h?.required.has(op.column.name)) {
      return [{ ...op, column: { ...op.column, nullable: true } }];
    }
    if (
      op.type === "add_index" &&
      h?.uniqueIndexes.some(index => index.name === op.index.name)
    ) {
      return [];
    }
    return [op];
  });
}

/** The desired tables as the main migration leaves them: each held setting left off. */
function tablesWithSettingsHeldBack(
  tables: readonly TableSpec[],
  held: readonly HeldSettings[]
): TableSpec[] {
  const byTable = new Map(held.map(h => [h.tableName, h]));
  return tables.map(table => {
    const h = byTable.get(table.name);
    if (!h) return table;
    const heldIndexes = new Set(h.uniqueIndexes.map(index => index.name));
    return {
      ...table,
      columns: table.columns.map(column =>
        h.required.has(column.name) ? { ...column, nullable: true } : column
      ),
      ...(table.indexes
        ? { indexes: table.indexes.filter(i => !heldIndexes.has(i.name)) }
        : {}),
    };
  });
}

/**
 * The `shared` file's statements for the held settings: UP applies them after the copy, rendered
 * as the main migration renders a column change (a rebuild to the desired table on SQLite, which
 * recreates its indexes too; `SET NOT NULL` on PostgreSQL; the column restated on MySQL, which has
 * no statement for nullability alone), and DOWN drops the unique indexes first, since SQLite drops
 * no column an index covers and the main migration's DOWN drops the column.
 */
function settingsAfterCopy(
  held: HeldSettings,
  desiredMain: TableSpec,
  dialect: SupportedDialect,
  desiredTables: readonly TableSpec[]
): { up: string[]; down: string[] } {
  const tableName = held.tableName;
  const down = generateStatements(
    held.uniqueIndexes.map(index => ({
      type: "drop_index" as const,
      tableName,
      index,
    })),
    dialect,
    [...desiredTables]
  );
  if (dialect === "sqlite" && held.required.size > 0) {
    return { up: sqliteTableRebuildStatements(desiredMain), down };
  }
  const required = desiredMain.columns
    .filter(column => held.required.has(column.name))
    .map(
      (column): Operation =>
        dialect === "mysql"
          ? {
              type: "change_column_type",
              tableName,
              columnName: column.name,
              fromType: column.type,
              toType: column.type,
              nullable: false,
              ...(column.default !== undefined
                ? { columnDefault: column.default }
                : {}),
              fromNullable: true,
            }
          : {
              type: "change_column_nullable",
              tableName,
              columnName: column.name,
              fromNullable: true,
              toNullable: false,
            }
    );
  const unique = held.uniqueIndexes.map(
    (index): Operation => ({ type: "add_index", tableName, index })
  );
  return {
    up: generateStatements([...required, ...unique], dialect, [
      ...desiredTables,
    ]),
    down,
  };
}

/** A field leaving translation, with the companion column it leaves. */
interface LeavingField {
  field: MinimalConfigField;
  column: LocalizedColumnSpec;
}

/**
 * The fields of a translated entity that were translated before this change
 * (`previousTranslation`) and the config now declares shared. Empty for an entity not translated
 * now, or whose translated fields before this change no record says.
 */
function fieldsLeavingTranslationIn(
  { entity: c, kind }: TaggedConfigEntity,
  previousSnapshot: NextlySchemaSnapshot,
  history: CompanionHistory,
  dialect: SupportedDialect
): LeavingField[] {
  if (c.localized !== true) return [];
  const previous = previousTranslation(c, kind, previousSnapshot, history);
  if (!previous || previous.columns.size === 0) return [];
  return c.fields.flatMap(field => {
    if (isFieldLocalized(field, true)) return [];
    const column = fieldToLocalizedColumnSpec(field, dialect, "codeFirst");
    return column && previous.columns.has(column.name)
      ? [{ field, column }]
      : [];
  });
}

/**
 * An entity's companion before this change: the translated columns it held, and whether the table
 * was there at all (it outlives its last column, which a `shared` file drops).
 */
interface PreviousTranslation {
  columns: ReadonlySet<string>;
  companion: boolean;
}

const NOT_TRANSLATED: PreviousTranslation = {
  columns: new Set(),
  companion: false,
};

/**
 * What an entity's companion held before this change, or `undefined` when no record says.
 *
 * The previous snapshot says first. Since snapshots began recording translated fields (`localized`
 * and `localizedColumns`) they record them for every translated table, so a table without the
 * record, in a snapshot that has it for another, was not translated. A snapshot that has it for no
 * table may predate it; then the companion files say, replayed in order (`readCompanionHistory`),
 * unless one this build cannot read comes after the last snapshot record (`unread`) and this
 * entity's own files do not begin by making its companion (`founded`). Such a file may be this
 * entity's, and the columns it made or dropped are missing from the replay.
 */
function previousTranslation(
  c: MinimalConfigEntity,
  kind: I18nTransitionKind,
  previousSnapshot: NextlySchemaSnapshot,
  history: CompanionHistory
): PreviousTranslation | undefined {
  const key = companionHistoryKey(kind, c.slug);
  const prevMain = previousSnapshot.tables.find(t => t.name === c.tableName);
  if (!prevMain) return NOT_TRANSLATED;
  if (prevMain.localized === true) {
    const columns = new Set(prevMain.localizedColumns ?? []);
    return {
      columns,
      companion: columns.size > 0 || history.present.has(key),
    };
  }
  if (previousSnapshot.tables.some(t => t.localized === true)) {
    return NOT_TRANSLATED;
  }
  if (history.unread && !history.founded.has(key)) return undefined;
  return {
    columns: new Set(history.columns.get(key)?.keys() ?? []),
    companion: history.present.has(key),
  };
}

/**
 * The fields of a translated entity this change may move between translated and shared, when no
 * record says which were translated before it (`previousTranslation` is `undefined`), by what the
 * previous main table holds:
 *
 * - a shared field the main table gains, which is new or leaving translation;
 * - a translated field the main table holds, which is joining translation, unless every
 *   translated field the table holds is: that is the entity becoming translated, or a change no
 *   different from it to read, which the companion files handle as one.
 */
function fieldsThatMayChangeTranslation(
  c: MinimalConfigEntity,
  previousSnapshot: NextlySchemaSnapshot,
  dialect: SupportedDialect
): MinimalConfigField[] {
  const prevMain = previousSnapshot.tables.find(t => t.name === c.tableName);
  if (!prevMain) return [];
  const onMain = new Set(prevMain.columns.map(col => col.name));
  const columned = c.fields.flatMap(field => {
    const column = fieldToLocalizedColumnSpec(field, dialect, "codeFirst");
    return column ? [{ field, onMain: onMain.has(column.name) }] : [];
  });
  const translated = columned.filter(f => isFieldLocalized(f.field, true));
  const mayLeave = columned.filter(
    f => !isFieldLocalized(f.field, true) && !f.onMain
  );
  const translatedOnMain = translated.filter(f => f.onMain);
  const mayJoin =
    translatedOnMain.length < translated.length ? translatedOnMain : [];
  return [...mayLeave, ...mayJoin].map(f => f.field);
}

const KIND_LABELS: Record<I18nTransitionKind, string> = {
  collection: "collection",
  single: "single",
  fieldGroup: "field group",
};

/**
 * Refuses the run, before anything is written, when it may move a field between translated and
 * shared on an entity whose translated fields before it no record says (`previousTranslation`).
 * Guessing either way loses the values: a field read as new keeps its translations in a companion
 * column nothing reads, and one read as the entity becoming translated is copied into a companion
 * that already holds it. Every other change goes through.
 */
function refuseUnrecordedTranslationChanges(
  entities: readonly TaggedConfigEntity[],
  previousSnapshot: NextlySchemaSnapshot,
  history: CompanionHistory,
  dialect: SupportedDialect,
  name: string
): void {
  for (const { entity: c, kind } of entities) {
    if (c.localized !== true) continue;
    if (previousTranslation(c, kind, previousSnapshot, history)) continue;
    const fields = fieldsThatMayChangeTranslation(c, previousSnapshot, dialect);
    if (fields.length === 0) continue;
    const named = fields.map(f => `"${f.name}"`).join(", ");
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage:
        `Can't tell whether ${named} in ${KIND_LABELS[kind]} "${c.slug}" ${fields.length === 1 ? "moves" : "move"} between translated and shared: ` +
        "the latest snapshot was written before snapshots recorded which fields are translated, and a localization migration file from then doesn't say which fields it moved. " +
        "Nothing was written: moving the values on a guess could lose them. " +
        `To record the translated fields, undo this change to ${named}, run \`nextly migrate:create --record-snapshot\`, then make the change again and run \`nextly migrate:create --name ${name}\`.`,
      logContext: {
        entity: c.slug,
        kind,
        fields: fields.map(f => f.name),
      },
    });
  }
}

/** One entity's fields that become translated, and the file that moves their values. */
interface FieldJoinsEntry {
  plan: FieldLeavesFile;
  entity: I18nTransitionKind;
}

/**
 * The fields of a translated entity that were shared columns of its main table before this change,
 * translated now, while its companion was there (`previousTranslation`). The mirror of
 * `fieldsLeavingTranslationIn`. A field added in this change has no main column and is not one of
 * them.
 */
function fieldsJoiningTranslationIn(
  { entity: c, kind }: TaggedConfigEntity,
  previousSnapshot: NextlySchemaSnapshot,
  history: CompanionHistory,
  dialect: SupportedDialect
): LeavingField[] {
  if (c.localized !== true) return [];
  const prevMain = previousSnapshot.tables.find(t => t.name === c.tableName);
  const previous = previousTranslation(c, kind, previousSnapshot, history);
  if (!prevMain || !previous?.companion) return [];
  const onMain = new Set(prevMain.columns.map(col => col.name));
  return c.fields.flatMap(field => {
    if (!isFieldLocalized(field, true)) return [];
    const column = fieldToLocalizedColumnSpec(field, dialect, "codeFirst");
    return column &&
      onMain.has(column.name) &&
      !previous.columns.has(column.name)
      ? [{ field, column }]
      : [];
  });
}

/**
 * Plan the `joins` file for each translated entity whose shared fields become translated
 * (`planFieldJoinsTranslationMigration`).
 */
function planFieldsJoiningTranslation(
  entities: TaggedConfigEntity[],
  previousSnapshot: NextlySchemaSnapshot,
  dialect: SupportedDialect,
  defaultLocale: string,
  history: CompanionHistory
): FieldJoinsEntry[] {
  return entities.flatMap(entry => {
    const { entity: c, kind } = entry;
    const companionPresent = history.present.has(
      companionHistoryKey(kind, c.slug)
    );
    const joining = fieldsJoiningTranslationIn(
      entry,
      previousSnapshot,
      history,
      dialect
    );
    if (joining.length === 0) return [];
    const names = new Set(joining.map(j => j.field.name));
    // The fields as they were: the joining ones shared.
    const oldFields = c.fields.map(f =>
      names.has(f.name) ? { ...f, localized: false } : f
    );
    const prevMain = previousSnapshot.tables.find(t => t.name === c.tableName);
    assertFieldsMayJoinTranslation(
      { entity: { ...c, fields: oldFields }, kind },
      joining,
      prevMain,
      dialect
    );
    return [
      {
        entity: kind,
        plan: planFieldJoinsTranslationMigration({
          spec: {
            dialect,
            collection: c.slug,
            // The DOWN archives the other languages' values, recorded with the entity's kind.
            kind,
            mainTable: c.tableName,
            companionTable: `${c.tableName}_locales`,
            defaultLocale,
            parentIdType: dialect === "mysql" ? "VARCHAR(36)" : "TEXT",
            columns: joining.map(j => j.column),
            // A default-language row created for an entry takes its publishing state, when the
            // main table and the companion both have one before this change.
            status:
              c.status === true &&
              prevMain?.columns.some(col => col.name === "status") === true,
          },
          builtBy: "codeFirst",
          oldFields,
          newFields: c.fields,
          // A companion outlives its last column: a `shared` file drops the column and keeps the
          // table, so the snapshot's empty list of translated columns does not say it is gone.
          companionExists:
            companionPresent || (prevMain?.localizedColumns?.length ?? 0) > 0,
          restoreRequired: requiredAgain(
            c.tableName,
            joining,
            prevMain,
            dialect,
            previousSnapshot
          ),
        }),
      },
    ];
  });
}

/**
 * The statements that make a joining field's main column required again on the way DOWN, as the
 * previous snapshot had it, rendered as the main migration renders a column change: a table
 * rebuild on SQLite, `SET NOT NULL` on PostgreSQL, and on MySQL, which has no statement for
 * nullability alone, the column restated with its type.
 */
function requiredAgain(
  tableName: string,
  joining: readonly LeavingField[],
  prevMain: TableSpec | undefined,
  dialect: SupportedDialect,
  previousSnapshot: NextlySchemaSnapshot
): string[] {
  const ops: Operation[] = joining.flatMap(({ column }) => {
    const before = prevMain?.columns.find(c => c.name === column.name);
    if (!before || before.nullable) return [];
    return [
      dialect === "mysql"
        ? {
            type: "change_column_type" as const,
            tableName,
            columnName: before.name,
            fromType: before.type,
            toType: before.type,
            nullable: false,
            ...(before.default !== undefined
              ? { columnDefault: before.default }
              : {}),
            fromNullable: true,
          }
        : {
            type: "change_column_nullable" as const,
            tableName,
            columnName: before.name,
            fromNullable: true,
            toNullable: false,
          },
    ];
  });
  if (ops.length === 0) return [];
  // SQLite has no statement for nullability: the table is rebuilt to its definition as the
  // previous snapshot has it, its rows copied across, and a row with no value refuses the copy.
  if (dialect === "sqlite" && prevMain) {
    return sqliteTableRebuildStatements(prevMain, ops);
  }
  return generateStatements(ops, dialect, previousSnapshot.tables);
}

/**
 * The main migration's DOWN with each joining field's column re-added nullable: on the way down
 * it runs before the `joins` file's DOWN copies the default language's values back, so a
 * required column added there would refuse every existing row. The `joins` DOWN makes it
 * required again once the values are in (`requiredAgain`).
 */
function restoredNullable(
  inverse: Operation[],
  joins: readonly FieldJoinsEntry[]
): Operation[] {
  const joining = new Set(
    joins.flatMap(({ plan }) =>
      plan.spec.columns.map(c => `${plan.spec.mainTable}::${c.name}`)
    )
  );
  return inverse.map(op =>
    op.type === "add_column" &&
    joining.has(`${op.tableName}::${op.column.name}`) &&
    !op.column.nullable
      ? { ...op, column: { ...op.column, nullable: true } }
      : op
  );
}

/**
 * Says when a translated field leaves the config in the same change that adds a shared one, which
 * is how a rename into a shared field reads to a migration that sees names only. Its translations
 * are not moved: the new field is new to it, and the old one's values stay where they are.
 */
function warnOfRenamesIntoShared(
  { entity: c, kind }: TaggedConfigEntity,
  previousSnapshot: NextlySchemaSnapshot,
  history: CompanionHistory,
  dialect: SupportedDialect,
  warn: (message: string) => void
): void {
  if (c.localized !== true) return;
  const prevMain = previousSnapshot.tables.find(t => t.name === c.tableName);
  const previous = previousTranslation(c, kind, previousSnapshot, history);
  if (!prevMain || !previous) return;
  const recorded = [...previous.columns];
  const columnOf = (field: MinimalConfigField) =>
    fieldToLocalizedColumnSpec(field, dialect, "codeFirst")?.name;
  const current = new Set(c.fields.map(columnOf));
  const gone = recorded.filter(name => !current.has(name));
  const onMain = new Set(prevMain.columns.map(col => col.name));
  const added = c.fields.filter(field => {
    const name = columnOf(field);
    return (
      !isFieldLocalized(field, true) &&
      name !== undefined &&
      !onMain.has(name) &&
      !recorded.includes(name)
    );
  });
  if (gone.length === 0 || added.length === 0) return;
  warn(
    `In "${c.slug}", translated ${gone.map(n => `"${n}"`).join(", ")} ${gone.length === 1 ? "is" : "are"} ` +
      `gone and shared ${added.map(f => `"${f.name}"`).join(", ")} ${added.length === 1 ? "is" : "are"} new. ` +
      `If one is a rename, this migration does not carry its translations over: keep the ` +
      `field's name while it stops being translated, and rename it in a later migration.`
  );
}

/** Says which leaving fields no migration file describes, so their storage is not checked. */
function warnOfUnknownShapes(
  slug: string,
  leaving: readonly LeavingField[],
  previousColumns: ReadonlyMap<string, LocalizedColumnSpec> | undefined,
  warn: (message: string) => void
): void {
  const unknown = leaving.filter(l => !previousColumns?.has(l.column.name));
  if (unknown.length === 0) return;
  const one = unknown.length === 1;
  warn(
    `No migration file describes how ${unknown.map(l => `"${l.field.name}"`).join(", ")} ` +
      `${one ? "is" : "are"} stored in "${slug}"'s translations, so this migration cannot ` +
      `check that ${one ? "its" : "their"} type stays the same as ${one ? "it stops" : "they stop"} ` +
      `being translated. If one also changed type, change the type and make it shared in ` +
      `separate migrations.`
  );
}

/**
 * Refuses the run when a leaving field cannot leave translation in one migration
 * (`refusalsForFieldsLeavingTranslation`), naming the steps that work, before any file is written.
 */
function assertFieldsMayLeaveTranslation(
  c: MinimalConfigEntity,
  leaving: readonly LeavingField[],
  previousColumns: ReadonlyMap<string, LocalizedColumnSpec> | undefined,
  dialect: SupportedDialect
): void {
  const refusals = refusalsForFieldsLeavingTranslation({
    leaving: new Set(leaving.map(l => l.field.name)),
    newFields: c.fields,
    ...(previousColumns ? { previousColumns } : {}),
    dialect,
    builtBy: "codeFirst",
    surface: "code",
  });
  refuseMigration(c, refusals);
}

/**
 * Refuses the run, before any file is written, with each refused field and the steps that work.
 * Nothing when `refusals` is empty.
 */
function refuseMigration(
  c: MinimalConfigEntity,
  refusals: LeavingTranslationRefusal[]
): void {
  if (refusals.length === 0) return;
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage: refusals.map(r => r.message).join(" "),
    publicData: { errors: refusals },
    logContext: { entity: c.slug, fields: refusals.map(r => r.path) },
  });
}

/**
 * Refuses the run when a shared field becomes translated in the same migration that changes how
 * it is stored (`refusalsForFieldsJoiningTranslation`). The column its value sits in now is the
 * previous snapshot's main-table column. The one it would have, kept shared, is built by the
 * builder that wrote that snapshot, from `asShared` (the entity with its joining fields shared),
 * so the two types compare as each was written.
 */
function assertFieldsMayJoinTranslation(
  asShared: TaggedConfigEntity,
  joining: readonly LeavingField[],
  prevMain: TableSpec | undefined,
  dialect: SupportedDialect
): void {
  const { entity: c, kind } = asShared;
  const sharedMain = buildDesiredSnapshotFromConfig(
    kind === "collection" ? [c] : [],
    kind === "single" ? [c] : [],
    kind === "fieldGroup" ? [c] : [],
    dialect
  ).tables.find(t => t.name === c.tableName);
  const typeIn = (table: TableSpec | undefined, column: string) =>
    table?.columns.find(col => col.name === column)?.type;
  const reshaped = joining
    .filter(({ column }) => {
      const before = typeIn(prevMain, column.name);
      return before !== undefined && before !== typeIn(sharedMain, column.name);
    })
    .map(({ field }) => field.name);
  refuseMigration(
    c,
    refusalsForFieldsJoiningTranslation({ reshaped, surface: "code" })
  );
}

/**
 * Stamp the snapshot's localization marker on a desired table.
 *
 * Records both that the entity is localized AND which columns its companion holds. The column
 * list is what makes a later DISABLE exact: it states what is really in the `_locales` table at
 * this point in time, so the disable brings back precisely those columns instead of guessing
 * from a config that has since changed.
 *
 * Recorded ONLY when the entity is localized, so a non-localized table's snapshot JSON is
 * byte-identical to what it was before this marker existed (no churn in committed snapshots).
 * The absent/`undefined` case is deliberately indistinguishable from a pre-marker snapshot —
 * both mean "we cannot prove this was localized", and the DISABLE planner only fires on an
 * explicit `true`, so an unknown never triggers a destructive transition.
 */
function withLocalizedMarker(
  table: TableSpec,
  entity: MinimalConfigEntity,
  dialect: SupportedDialect
): TableSpec {
  if (entity.localized !== true) return table;
  // `defaultLocale` does not affect column names, so any value works here.
  const spec = deriveCompanionSpec({
    builtBy: "codeFirst" as const,
    slug: entity.slug,
    dbName: entity.tableName,
    fields: entity.fields,
    dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    status: entity.status === true,
  });
  // Each column is recorded with what it stores, so the migration that later removes or renames
  // one can still key the index its DOWN recreates the way this one keyed it.
  const unique = uniqueTranslatedColumns({
    fields: entity.fields,
    entityLocalized: true,
    dialect,
    builtBy: "codeFirst",
  }).map(c =>
    c.kind === undefined ? c.column : { column: c.column, kind: c.kind }
  );
  return {
    ...table,
    localized: true,
    ...(spec ? { localizedColumns: spec.columns.map(c => c.name) } : {}),
    ...(unique.length > 0 ? { uniqueLocalizedColumns: unique } : {}),
  };
}

/**
 * Remove the main-table `drop_column` operations that a companion ENABLE migration already
 * performs (create + seed + drop). Without this, the localized columns would be dropped twice
 * — once by the main migration's diff, once by the companion — and the second drop fails.
 *
 * The DISABLE transition is the mirror image: its SQL re-adds the columns to the main table
 * itself, so the diff's `add_column` ops for those same columns are stripped too (otherwise
 * the column is added twice and the second ALTER fails).
 */
function stripRelocatedDrops(
  operations: Operation[],
  companionPlans: CompanionPlanEntry[]
): Operation[] {
  const relocated = new Set<string>();
  const restored = new Set<string>();
  for (const { spec, plan } of companionPlans) {
    // create-only has no main-table drops
    if (plan.kind === "enable") {
      for (const col of spec.columns) {
        relocated.add(`${spec.mainTable}::${col.name}`);
      }
    } else if (plan.kind === "disable") {
      // The disable SQL re-adds these columns itself (step 1 of buildLocalizationDownSql).
      for (const col of spec.columns) {
        restored.add(`${spec.mainTable}::${col.name}`);
      }
    }
  }
  if (relocated.size === 0 && restored.size === 0) return operations;
  return operations.filter(op => {
    if (
      op.type === "drop_column" &&
      relocated.has(`${op.tableName}::${op.columnName}`)
    ) {
      return false;
    }
    if (
      op.type === "add_column" &&
      restored.has(`${op.tableName}::${op.column.name}`)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Build a NextlySchemaSnapshot from the config's collections + singles +
 * components. Each entity becomes a TableSpec via the shared
 * buildDesiredTableFromFields helper used by the apply pipeline — keeps
 * the desired-snapshot shape consistent across consumers.
 *
 * F11 PR 4: exported (was internal in PR 3) so `migrate:check` can build
 * the desired snapshot for the drift check without spinning up the full
 * generateMigration orchestrator.
 */
export function buildDesiredSnapshotFromConfig(
  collections: MinimalConfigEntity[],
  singles: MinimalConfigEntity[],
  components: MinimalConfigEntity[],
  dialect: SupportedDialect
): NextlySchemaSnapshot {
  const tables: TableSpec[] = [];
  for (const c of collections) {
    // Why: forward the entity's Draft/Published flag so the snapshot
    // includes the system status column when enabled. Mirrors the same
    // forwarding pushschema-pipeline.ts already does for the diff path.
    // `localized` omits translatable columns (they live in the companion).
    tables.push(
      withLocalizedMarker(
        buildDesiredTableFromFields(c.tableName, c.fields, dialect, {
          builtBy: "codeFirst" as const,
          hasStatus: c.status === true,
          localized: c.localized === true,
          ...(c.indexes !== undefined ? { indexes: c.indexes } : {}),
        }),
        c,
        dialect
      )
    );
  }
  for (const c of singles) {
    // i18n: singles localize identically to collections — the companion is
    // `single_<slug>_locales` (deriveCompanionSpec derives it from the table name).
    // Omit translatable columns from the main table; the companion (planned below)
    // holds them.
    tables.push(
      withLocalizedMarker(
        buildDesiredTableFromFields(c.tableName, c.fields, dialect, {
          builtBy: "codeFirst" as const,
          hasStatus: c.status === true,
          localized: c.localized === true,
          ...(c.indexes !== undefined ? { indexes: c.indexes } : {}),
        }),
        c,
        dialect
      )
    );
  }
  for (const c of components) {
    // Components use the component builder (system columns _parent_id,
    // _parent_table, _parent_field, _order, _component_type — not the
    // collection slug/title), matching what the apply pipeline builds. Using
    // the collection builder here produced a snapshot that diverged from the
    // real component table and broke `migrate:resolve --applied`.
    // i18n: a localized component omits its translatable columns too — they live
    // in the companion `comp_<slug>_locales` (planned below).
    tables.push(
      withLocalizedMarker(
        buildDesiredTableFromComponentFields(c.tableName, c.fields, dialect, {
          builtBy: "codeFirst" as const,
          localized: c.localized === true,
        }),
        c,
        dialect
      )
    );
  }
  return { tables };
}

/**
 * Replace accepted (drop_column, add_column) pairs with a rename_column
 * op. Declined decisions and unmatched ops pass through unchanged.
 *
 * F11 PR 3 review fix #2: dedupe accepted decisions so each drop column
 * and each add column appears in at most one rename. Without this, the
 * rename detector's Cartesian product (N drops × N adds per table) plus
 * the per-candidate prompt loop could produce overlapping accepts —
 * e.g. accepting both (title→name) and (title→label) would emit two
 * RENAME COLUMN ops on the same source column, the second of which
 * fails at apply because `title` no longer exists.
 *
 * Strategy: first-acceptance-wins. Iterate accepted decisions in
 * detector-emit order; skip any whose drop column or add column has
 * already been claimed by a prior accept. The skipped decision's
 * drop+add ops stay in the operation list (treated as a normal drop+add)
 * — that's the safest fallback because the operator can re-run
 * migrate:create after editing the file if they wanted a different
 * pairing.
 */
function applyRenameDecisions(
  ops: Operation[],
  decisions: RenameDecision[],
  dialect: SupportedDialect,
  previousSnapshot?: NextlySchemaSnapshot
): Operation[] {
  const accepted = decisions.filter(d => d.accepted);
  if (accepted.length === 0) return ops;

  // Index accepted candidates with first-acceptance-wins dedup.
  const acceptedDrops = new Set<string>();
  const acceptedAdds = new Set<string>();
  const effectiveAccepts: RenameDecision[] = [];
  for (const d of accepted) {
    const c = d.candidate;
    const dropKey = `${c.tableName}::${c.fromColumn}`;
    const addKey = `${c.tableName}::${c.toColumn}`;
    if (acceptedDrops.has(dropKey) || acceptedAdds.has(addKey)) {
      // Overlapping accept — skip. The drop+add ops stay in the
      // operation list and become a normal DROP+ADD pair.
      continue;
    }
    acceptedDrops.add(dropKey);
    acceptedAdds.add(addKey);
    effectiveAccepts.push(d);
  }

  // Filter out the matching drop_column / add_column pairs. TS narrows
  // `op` from the discriminated union via `op.type === "drop_column"`,
  // so no explicit cast is needed.
  // The collapsed `add_column` is the ONLY statement of what the repaired column must end up being —
  // its nullability and its default. Dropping it without keeping that is what let a generated repair
  // leave the column nullable and defaultless while its own snapshot declared otherwise.
  const consumedTarget = new Map<string, ColumnSpec>();

  const remaining: Operation[] = [];
  for (const op of ops) {
    if (op.type === "drop_column") {
      if (acceptedDrops.has(`${op.tableName}::${op.columnName}`)) {
        continue;
      }
    }
    if (op.type === "add_column") {
      if (acceptedAdds.has(`${op.tableName}::${op.column.name}`)) {
        consumedTarget.set(`${op.tableName}::${op.column.name}`, op.column);
        continue;
      }
    }
    remaining.push(op);
  }

  // Append rename_column ops for each effective acceptance, each followed by the type change it
  // needs.
  //
  // 🔴 The conversion belongs here rather than only in the apply pipeline. A rename moves the column
  // without changing what it is, so a generated migration carrying the rename alone leaves the old
  // type under the new name — the UP writes `text` where the snapshot and the runtime expect JSON,
  // and the DOWN omits the reverse. Emitted as an OPERATION rather than as SQL because everything
  // downstream already understands one: `generateSQL` renders it for the dialect, and
  // `buildInverseOperations` inverts it for the DOWN.
  //
  // `conversionForRename` is the same function the apply pipeline asks, so a repair written to a
  // file and one applied against a live database cannot disagree about what the column becomes.
  const renames: Operation[] = [];
  for (const d of effectiveAccepts) {
    const c = d.candidate;
    const renameOp: RenameColumnOp = {
      type: "rename_column",
      tableName: c.tableName,
      fromColumn: c.fromColumn,
      toColumn: c.toColumn,
      fromType: c.fromType,
      toType: c.toType,
    };
    renames.push(renameOp);

    const target = consumedTarget.get(`${c.tableName}::${c.toColumn}`);
    const sourceColumn = previousSnapshot?.tables
      .find(t => t.name === c.tableName)
      ?.columns.find(col => col.name === c.fromColumn);
    renames.push(
      ...conversionForRename(renameOp, dialect, {
        target: target
          ? { nullable: target.nullable, default: target.default }
          : undefined,
        // Read from the snapshot rather than from the drop, which records only a type. A generated
        // DOWN needs this to put the column back as it was, and nothing else in the operation list
        // carries it.
        source: sourceColumn
          ? { nullable: sourceColumn.nullable, default: sourceColumn.default }
          : undefined,
      })
    );
  }

  // Nothing was collapsed, so the diff's own ordering already holds and the
  // list is returned untouched. Partitioning here regardless would produce the
  // same array only for as long as diffSnapshots keeps emitting add_index
  // last, which makes this function silently depend on that contract.
  if (renames.length === 0) return remaining;

  // An index the renamed column already carries is carried BY the rename: every dialect renames the
  // column inside the index. The diff, seeing the collapsed add's index under the same name with a
  // new column, plans to create it again — which MySQL refuses as a duplicate key and PostgreSQL
  // skips with IF NOT EXISTS — and, for a name Nextly manages, to drop the old one first, which would
  // leave the table with no index at all once the create is gone. When the new index is exactly the
  // previous one with the column renamed, both are dropped from the plan and the rename keeps it.
  const carried = indexesCarriedByRenames(
    effectiveAccepts.map(d => d.candidate),
    previousSnapshot
  );
  const keptByRename = new Set(
    remaining.flatMap(op =>
      op.type === "add_index" &&
      carried.get(`${op.tableName}::${op.index.name}`) === indexShape(op.index)
        ? [`${op.tableName}::${op.index.name}`]
        : []
    )
  );
  // Placed first and filtered after: the kept index's create is what the renames are placed ahead
  // of, so taking it out first would push them past a check that names the new column.
  const placed = placeRenames(remaining, renames);
  return keptByRename.size === 0
    ? placed
    : placed.filter(
        op =>
          !(
            (op.type === "add_index" || op.type === "drop_index") &&
            keptByRename.has(`${op.tableName}::${op.index.name}`)
          )
      );
}

/**
 * The indexes on renamed columns, keyed by table and name, each with its shape as it reads once
 * the renames have run (`indexShape`).
 */
function indexesCarriedByRenames(
  renamed: readonly RenameCandidate[],
  previousSnapshot: NextlySchemaSnapshot | undefined
): Map<string, string> {
  const carried = new Map<string, string>();
  for (const table of previousSnapshot?.tables ?? []) {
    const onTable = renamed.filter(c => c.tableName === table.name);
    if (onTable.length === 0) continue;
    const newName = (column: string): string =>
      onTable.find(c => c.fromColumn === column)?.toColumn ?? column;
    for (const index of table.indexes ?? []) {
      if (!index.columns.some(column => newName(column) !== column)) continue;
      carried.set(
        `${table.name}::${index.name}`,
        indexShape({ ...index, columns: index.columns.map(newName) })
      );
    }
  }
  return carried;
}

/** What an index is, beyond its name: the same text for two indexes that index alike. */
function indexShape(index: IndexSpec): string {
  return JSON.stringify([
    index.columns,
    index.unique,
    index.where ?? null,
    index.expression ?? null,
  ]);
}

/** The operations with the renames placed ahead of the index tail. */
function placeRenames(
  remaining: Operation[],
  renames: Operation[]
): Operation[] {
  // The renames land ahead of the index tail, not at the very end. Collapsing a
  // (drop_column, add_column) pair removes the statement that would have
  // created the new column, so an index declared on it can only be created
  // once the rename has produced that name — otherwise the generated UP reads
  // `CREATE INDEX ... (image); RENAME COLUMN hero_image TO image` and fails on
  // a column that does not exist yet.
  //
  // Inserted before the FIRST add_index rather than filtering add_index out,
  // so the tail keeps the order the diff chose. That tail can end with an index
  // drop the diff deliberately placed after its replacement's creation, and
  // hoisting the renames past it would reorder the two.
  const firstAddIndex = remaining.findIndex(op => op.type === "add_index");
  if (firstAddIndex === -1) return [...remaining, ...renames];

  return [
    ...remaining.slice(0, firstAddIndex),
    ...renames,
    ...remaining.slice(firstAddIndex),
  ];
}

/**
 * Test seam: expose `applyRenameDecisions` for unit tests so we can
 * verify the rename-collapsing logic without spawning the full pipeline.
 */
export function applyRenameDecisionsForTest(
  ops: Operation[],
  decisions: RenameDecision[],
  dialect: SupportedDialect = "postgresql",
  previousSnapshot?: NextlySchemaSnapshot
): Operation[] {
  return applyRenameDecisions(ops, decisions, dialect, previousSnapshot);
}

/**
 * Test seam for the candidate-detection step.
 */
export function buildDesiredSnapshotFromConfigForTest(
  collections: MinimalConfigEntity[],
  singles: MinimalConfigEntity[],
  components: MinimalConfigEntity[],
  dialect: SupportedDialect
): NextlySchemaSnapshot {
  return buildDesiredSnapshotFromConfig(
    collections,
    singles,
    components,
    dialect
  );
}

export type { RenameCandidate };
