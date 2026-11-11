/**
 * A collection's schema change applied to this database: one apply of the schema pipeline over
 * the whole desired schema, then the collection's translations table brought in step.
 *
 * Both ways a collection's schema changes take this one path: the schema dialog's apply, with the
 * admin's answers, and the Schema Builder's save, with the answers the save makes for itself. So
 * "what does this database still need for this change" has one implementation. The pipeline diffs
 * the live database against the change, which is what lets a change the database refused part-way
 * be finished by applying it again: what landed is already there, and only the rest is planned.
 *
 * In the order the change needs: the translated field's rename answered, the settings of a field
 * leaving translation deferred, the preconditions of a field leaving translation asked before
 * anything is altered, the push, then the companion reconcile, which pushes the deferred settings
 * once the shared columns hold the default language's values.
 *
 * @module domains/schema/services/collection-schema-apply
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import {
  isLeavingSettingsRefusal,
  leavingSettingsStep,
} from "../../../dispatcher/helpers/builder-schema-push";
import { buildFullDesiredSchema } from "../../../dispatcher/helpers/desired-schema";
import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getLoggerFromDI,
  getMigrationJournalFromDI,
} from "../../../dispatcher/helpers/di";
import { NextlyError } from "../../../errors";
import { getProductionNotifier } from "../../../runtime/notifications/index";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { consoleLogger } from "../../../shared/types";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { appLocalization } from "../../i18n/configured-locales";
import {
  archiveFieldsLeavingTranslation,
  fieldsWithLeavingSettingsDeferred,
} from "../../i18n/migration/archive-preflight";
import { resolveCompanionRename } from "../../i18n/migration/companion-rename";
import {
  companionUniqueIndexName,
  uniqueTranslatedColumns,
} from "../../i18n/migration/companion-unique-indexes";
import { withoutLeavingConstraints } from "../../i18n/migration/field-leaves-translation-rules";
import { applyCompanionTransition } from "../../i18n/migration/held-leaving-drops";
import { buildCompanionTransitionStatements } from "../../i18n/migration/reconcile-companion";
import {
  translationLayoutChange,
  type TranslationLayoutChange,
} from "../../i18n/per-language-storage";
import {
  companionHasStatusColumn,
  liveCompanionShape,
} from "../../i18n/runtime/companion-io";
import { assertLanguageStatesAgreeWithEntry } from "../../i18n/runtime/language-states-agree";
import { runStatement } from "../pipeline/_internal/run-statement";
import {
  createApplyDesiredSchema,
  movedOnto,
  type ApplyResult,
} from "../pipeline/apply";
import { RealClassifier } from "../pipeline/classifier/classifier";
import { refuseCompanionRenameSwitch } from "../pipeline/companion-shape-switches";
import { extractDatabaseNameFromUrl } from "../pipeline/database-url";
import { desiredCollectionTable } from "../pipeline/desired-collection-table";
import {
  type NameHolder,
  readIndexColumns,
  readIndexUniqueness,
  readNameHoldersElsewhere,
  readUniqueColumns,
} from "../pipeline/live-table-facts";
import { RealPreCleanupExecutor } from "../pipeline/pre-cleanup/executor";
import {
  BrowserPromptDispatcher,
  type BrowserRenameResolution,
  type LegacyResolutionsBundle,
} from "../pipeline/prompt-dispatcher/browser";
import { PushSchemaPipeline } from "../pipeline/pushschema-pipeline";
import type { PromptDispatcher } from "../pipeline/pushschema-pipeline-interfaces";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../pipeline/pushschema-pipeline-stubs";
import { builtByFor } from "../pipeline/registered-collections";
import { RegexRenameDetector } from "../pipeline/rename-detector";
import type { Resolution } from "../pipeline/resolution/types";
import { recoverInterruptedSqliteRebuilds } from "../pipeline/sqlite-rebuild-recovery";
import type { DesiredCollection, DesiredSchema } from "../pipeline/types";

import { DrizzleStatementExecutor } from "./drizzle-statement-executor";
import { toSnakeCase } from "./field-column-descriptor";
import { withSchemaChangeExcluded } from "./schema-change-exclusion";

/**
 * The fields the registry records for a collection before a Schema Builder change, as it records
 * them, so a relationship the change adds over a column an earlier apply already added still gets
 * its foreign key, and one that apply renamed does not. The preview and the apply both hand the
 * pipeline this one list, so they plan the same keys.
 */
export function recordedFieldsOf(collection: {
  fields?: unknown;
}): DesiredCollection["fields"] {
  return Array.isArray(collection.fields)
    ? (collection.fields as DesiredCollection["fields"])
    : [];
}

/**
 * The prompt dispatcher, watched for what another table's drift does to the apply.
 *
 * The apply diffs the whole database, so a table the change does not touch can stop it: a column
 * no definition has would be dropped, unconfirmed, and a pair of columns no change renamed is a
 * question nobody answered. The dispatcher refuses to proceed either way. This records which other
 * tables stopped it, so the refusal names them rather than reading as the change's own.
 */
class DriftWatchingDispatcher implements PromptDispatcher {
  drifted: string[] = [];

  constructor(
    private readonly inner: PromptDispatcher,
    private readonly tableName: string,
    private readonly confirmed: ReadonlySet<string>
  ) {}

  async dispatch(
    args: Parameters<PromptDispatcher["dispatch"]>[0]
  ): ReturnType<PromptDispatcher["dispatch"]> {
    const result = await this.inner.dispatch(args);
    if (result.proceed) return result;
    this.drifted = [
      ...args.events.flatMap(event =>
        event.kind === "destructive_drop" &&
        event.tableName !== this.tableName &&
        !this.confirmed.has(event.id)
          ? [
              `${event.tableName} has a column "${event.columnName}" its definition does not`,
            ]
          : []
      ),
      ...args.candidates.flatMap(candidate =>
        candidate.tableName !== this.tableName
          ? [
              `${candidate.tableName} has a column "${candidate.fromColumn}" where its definition has "${candidate.toColumn}"`,
            ]
          : []
      ),
    ];
    return result;
  }
}

/**
 * The answers a change arrives with, and for a caller that decides every pair of columns itself
 * (the Builder save), `drop_and_add` for each pair on the collection's own table it left
 * unanswered. Such a save has never renamed a column it did not detect as a rename, and the
 * pipeline also offers pairs the save never sees, such as a removed column against a lifecycle
 * column the save adds. Another table's pairs stay unanswered, so its drift stops the apply.
 */
class AnsweringDispatcher implements PromptDispatcher {
  constructor(
    private readonly renameResolutions: BrowserRenameResolution[],
    private readonly eventResolutions: Resolution[],
    private readonly legacyResolutions: LegacyResolutionsBundle | undefined,
    private readonly ownTable: string | undefined,
    private readonly slug: string
  ) {}

  async dispatch(
    args: Parameters<PromptDispatcher["dispatch"]>[0]
  ): ReturnType<PromptDispatcher["dispatch"]> {
    const key = (r: {
      tableName: string;
      fromColumn: string;
      toColumn: string;
    }) => `${r.tableName}::${r.fromColumn}::${r.toColumn}`;
    const answered = new Set(this.renameResolutions.map(key));
    const renamedFrom = new Set(
      this.renameResolutions
        .filter(r => r.choice === "rename")
        .map(r => `${r.tableName}::${r.fromColumn}`)
    );
    // The columns this change removes, by the drops it confirms: only those are
    // its to trade for a column it adds. A column it never made (one added
    // outside the Builder) is left unanswered, so the apply refuses rather than
    // dropping its data.
    const removing = new Set(
      Object.entries(this.legacyResolutions?.byFieldName ?? {})
        .filter(([, answer]) => answer.action === "confirm_drop")
        .map(([name]) => toSnakeCase(name))
    );
    const rest: BrowserRenameResolution[] =
      this.ownTable === undefined
        ? []
        : args.candidates
            .filter(
              c =>
                c.tableName === this.ownTable &&
                removing.has(c.fromColumn) &&
                !answered.has(key(c)) &&
                !renamedFrom.has(`${c.tableName}::${c.fromColumn}`)
            )
            .map(c => ({
              tableName: c.tableName,
              fromColumn: c.fromColumn,
              toColumn: c.toColumn,
              choice: "drop_and_add" as const,
            }));
    const resolutions = [...this.renameResolutions, ...rest];
    const result = await new BrowserPromptDispatcher(
      resolutions,
      this.eventResolutions,
      this.legacyResolutions
    ).dispatch(args);
    if (!result.proceed && this.ownTable !== undefined) {
      refuseLeftoverColumns(
        this.slug,
        this.ownTable,
        args,
        result,
        resolutions
      );
    }
    return result;
  }
}

/**
 * Refuse a save that would drop a column of its own table that no field describes and the save
 * never removed, such as one an install from before removed fields dropped their columns kept,
 * with its data. The push offers it as a drop, or as the old side of a rename, and nothing the
 * save decides answers it, so the push would stop as cancelled; this says which column and how
 * to go on instead, before anything is dropped. Another table's drift is left to the push's own
 * refusal.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each such column (`COLUMN_NOT_DESCRIBED`)
 */
function refuseLeftoverColumns(
  slug: string,
  ownTable: string,
  args: Parameters<PromptDispatcher["dispatch"]>[0],
  result: Awaited<ReturnType<PromptDispatcher["dispatch"]>>,
  resolutions: readonly BrowserRenameResolution[]
): void {
  // Acknowledged as the browser dispatcher acknowledges a drop: exactly one confirm_drop.
  const confirmations = new Map<string, number>();
  for (const r of result.resolutions) {
    if (r.kind === "confirm_drop") {
      confirmations.set(r.eventId, (confirmations.get(r.eventId) ?? 0) + 1);
    }
  }
  const answered = new Set(
    resolutions.map(r => `${r.tableName}::${r.fromColumn}::${r.toColumn}`)
  );
  const renamedFrom = new Set(
    result.confirmedRenames.map(c => `${c.tableName}::${c.fromColumn}`)
  );
  const leftover = new Set<string>();
  for (const event of args.events) {
    if (
      event.kind === "destructive_drop" &&
      event.tableName === ownTable &&
      confirmations.get(event.id) !== 1
    ) {
      leftover.add(event.columnName);
    }
  }
  for (const c of args.candidates) {
    if (
      c.tableName === ownTable &&
      !answered.has(`${c.tableName}::${c.fromColumn}::${c.toColumn}`) &&
      !renamedFrom.has(`${c.tableName}::${c.fromColumn}`)
    ) {
      leftover.add(c.fromColumn);
    }
  }
  if (leftover.size === 0) return;
  throw NextlyError.validation({
    errors: [...leftover].map(column => ({
      path: `columns.${column}`,
      code: "COLUMN_NOT_DESCRIBED",
      message:
        `The collection "${slug}" holds a column "${column}" that no field describes, and ` +
        `saving would remove it with its data. Drop the column by hand, or add a field that ` +
        `describes it, then save again.`,
    })),
    logContext: { slug, tableName: ownTable, columns: [...leftover] },
  });
}

/** One collection's schema change, as either of its callers states it. */
export interface CollectionSchemaChange {
  slug: string;
  /** The registry record as it stands before the change. */
  collection: { tableName: string; fields?: unknown };
  /** The fields the change leaves the collection with. */
  fields: FieldDefinition[];
  wasLocalized: boolean;
  isLocalized: boolean;
  /** Draft/Published as the change leaves it. */
  status: boolean;
  /** Draft/Published as it stood, which the companion's disable restore reads. */
  wasStatus: boolean;
  /** The answers to the pipeline's questions: renames, typed events, and per-field ones. */
  renameResolutions: BrowserRenameResolution[];
  eventResolutions: Resolution[];
  legacyResolutions?: LegacyResolutionsBundle;
  /**
   * Whether every pair on the collection's own table not answered above, from a column the change
   * confirms dropping, is a drop and an add: the Builder save's rule, which detects its own
   * renames. The dialog asks the admin.
   */
  dropAndAddUnansweredRenames?: boolean;
  /**
   * The Required fields the change adds over rows, each with the value the rows already there are
   * filled with. Pushed optional, filled, then pushed Required: a fill answered to the push itself
   * would run before the column it fills exists.
   */
  fills?: ReadonlyArray<{ field: string; value: unknown; required: boolean }>;
}

/**
 * Apply one collection's schema change to this database, or refuse it.
 *
 * Under the schema lock, whoever calls, so no two applies, and no migration, ever run beside each
 * other: the SQLite recovery below finishes or undoes a rebuild it believes interrupted, which is
 * only safe while nothing else can be in the middle of one. The lock is re-entrant, so a caller
 * already holding it (the Builder save, which also holds it across its file and registry writes)
 * runs inside its own claim; the schema dialog takes it here. A change while another holds it is
 * refused at once, with nothing written.
 *
 * @throws {NextlyError} `NEXTLY_MIGRATION_APPLY_FAILED` with the pipeline's own words when the
 *   push is refused, the refusal of a leaving field's settings as it is, and `INTERNAL_ERROR` when
 *   the push landed and the companion could not be brought in step
 */
export async function applyCollectionSchemaChange(
  change: CollectionSchemaChange
): Promise<Extract<ApplyResult, { success: true }>> {
  return withSchemaChangeExcluded(
    {
      adapter: getAdapterFromDI(),
      logger: getLoggerFromDI() ?? consoleLogger,
      label: `apply schema changes to collection "${change.slug}"`,
      // This path runs the push pipeline, so it issues DDL and may create the lock table.
      issuesDdl: true,
    },
    () => applyHoldingSchemaLock(change)
  );
}

/**
 * Refuse a change that makes a main-table column unique, by its Unique mark or by a relationship
 * becoming one-to-one, while the column's entries already repeat a value.
 *
 * The database refuses the unique index part-way through the apply, and MySQL keeps every schema
 * statement that ran before it. So the question is asked first, by the precondition the service's
 * save asks (`refusalsForCollectionSave`, uniqueness only), and the two roads refuse alike. A
 * translated field's column is its companion's, whose per-language uniqueness is judged where the
 * companion's unique indexes are made.
 */
async function refuseUniqueOverRepeats(args: {
  adapter: DrizzleAdapter;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  wasLocalized: boolean;
  isLocalized: boolean;
  /** The renames the admin accepted: a renamed field's values are checked under its old column. */
  renames: readonly {
    tableName: string;
    fromColumn: string;
    toColumn: string;
    choice: string;
  }[];
  /** The one value an added Required field gives every existing entry. */
  fills: readonly { field: string; value: unknown }[];
}): Promise<void> {
  const { adapter, tableName } = args;
  // A table still to be made holds no entries, so nothing can repeat yet.
  if (!(await adapter.tableExists(tableName))) return;
  const [
    { refusalsForCollectionSave },
    { introspectLiveSnapshot },
    { readUniqueColumns },
  ] = await Promise.all([
    import("../../dynamic-collections/services/save-preconditions"),
    import("../pipeline/diff/introspect-live"),
    import("../pipeline/live-table-facts"),
  ]);
  const onMain = (fields: FieldDefinition[], localized: boolean) => {
    const translated = new Set(resolveLocalizedFieldNames(fields, localized));
    return fields.filter(field => !translated.has(field.name));
  };
  const live = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [tableName]
  );
  const oldFields = onMain(args.oldFields, args.wasLocalized);
  const newFields = onMain(args.newFields, args.isLocalized);
  const byColumn = (fields: FieldDefinition[], column: string) =>
    fields.find(field => toSnakeCase(field.name) === column);
  const refusals = await refusalsForCollectionSave({
    adapter,
    dialect: adapter.dialect,
    tableName,
    oldFields,
    newFields,
    // Each rename the admin accepted on this table, as the fields it pairs.
    renames: args.renames.flatMap(rename => {
      if (rename.tableName !== tableName || rename.choice !== "rename") {
        return [];
      }
      const from = byColumn(oldFields, rename.fromColumn);
      const to = byColumn(newFields, rename.toColumn);
      return from && to ? [{ from, to }] : [];
    }),
    // A column this apply adds takes NULL in every existing entry, which never repeats, unless
    // the change fills it with one value, which every entry then shares.
    addedColumnBackfill: field => {
      const fill = args.fills.find(each => each.field === field.name);
      return fill === undefined || fill.value === null
        ? null
        : JSON.stringify(fill.value);
    },
    presentColumns: new Set(
      live.tables[0]?.columns.map(column => column.name) ?? []
    ),
    // Unique as the live table holds it, not as the previous definition says.
    liveUniqueColumns: new Set(
      (
        await readUniqueColumns(
          adapter.getDrizzle(),
          adapter.dialect,
          tableName
        )
      ).keys()
    ),
    only: "uniqueness",
  });
  if (refusals.length > 0) {
    throw NextlyError.validation({
      errors: refusals.map(refusal => refusal.error),
      logContext: {
        tableName,
        fields: refusals.map(refusal => refusal.error.path),
        details: refusals.flatMap(refusal =>
          refusal.logContext ? [refusal.logContext] : []
        ),
      },
    });
  }
}

/** The registry and the adapter, which a schema change cannot run without. */
function requireSchemaChangeDeps(slug: string) {
  const registry = getCollectionRegistryFromDI();
  if (!registry) {
    throw NextlyError.internal({
      logContext: { reason: "collection-registry-not-initialized", slug },
    });
  }
  const adapter = getAdapterFromDI();
  if (!adapter) {
    throw NextlyError.internal({
      logContext: { reason: "adapter-not-initialized", slug },
    });
  }
  return { registry, adapter };
}

type SchemaChangeDeps = ReturnType<typeof requireSchemaChangeDeps>;
type ApplyDesired = ReturnType<typeof createApplyDesiredSchema>;

/**
 * The pipeline's apply for this change, answering from the change itself, and the dispatcher that
 * watched what another table's drift did to it.
 */
function changeApply(change: CollectionSchemaChange, deps: SchemaChangeDeps) {
  const { slug } = change;
  const { tableName } = change.collection;
  const { adapter, registry } = deps;
  // `dialect` is an abstract readonly property on DrizzleAdapter, not a method.
  const dialect = adapter.dialect;
  const db = adapter.getDrizzle();
  const databaseName =
    dialect === "mysql"
      ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
      : undefined;
  const defaultLocale = appLocalization()?.defaultLocale ?? "en";
  // The answers arrive with the change, so nothing is asked mid-apply: the dialog collected them
  // from the admin, and the save makes them itself.
  const promptDispatcher = new DriftWatchingDispatcher(
    new AnsweringDispatcher(
      change.renameResolutions,
      change.eventResolutions,
      change.legacyResolutions,
      change.dropAndAddUnansweredRenames === true ? tableName : undefined,
      change.slug
    ),
    tableName,
    new Set(
      change.eventResolutions
        .filter(resolution => resolution.kind === "confirm_drop")
        .map(resolution => resolution.eventId)
    )
  );
  const apply = createApplyDesiredSchema({
    applyPipeline: (desiredArg, sourceArg, channelArg) => {
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: new RealClassifier(),
        promptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        // The real journal from DI, with a noop fallback for callers that bypass DI.
        migrationJournal: getMigrationJournalFromDI() ?? noopMigrationJournal,
        notifier: getProductionNotifier(),
      });
      return pipeline.apply({
        desired: desiredArg,
        db,
        dialect,
        source: sourceArg,
        promptChannel: channelArg,
        databaseName,
        // Tagged with the collection, so the notifications name what changed.
        uiTargetSlug: slug,
        uiTargetKind: "collection" as const,
        // A field becoming translated keeps its value as this language's; the apply moves it
        // after its prompts and refusals, before it drops the main column.
        defaultLocale,
      });
    },
    // Neither caller asks the pipeline for its optimistic check: the dialog checks the version
    // before calling, and the save runs under the schema lock.
    readSchemaVersionForSlug: () => Promise.resolve(null),
    readNewSchemaVersionsForSlugs: async (slugs: string[]) => {
      const out: Record<string, number> = {};
      for (const each of slugs) {
        const version = (await registry.getCollectionBySlug(each))
          ?.schemaVersion;
        if (typeof version === "number") out[each] = version;
      }
      return out;
    },
  });
  return { apply, promptDispatcher, defaultLocale };
}

/**
 * The refusal of an apply the pipeline did not complete: another table's drift named, with the
 * way on, or else the push's own words, under the code its status already was.
 */
function refusedApply(
  slug: string,
  drifted: readonly string[],
  message: string
): NextlyError {
  // Another table stopped it: named, with what differs and the way on, so the change is not
  // taken for the one refused.
  if (drifted.length > 0) {
    return new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage:
        `This change was not applied, because another table differs from what was recorded ` +
        `for it: ${drifted.join("; ")}. Bring that table in step first, by applying its own ` +
        `change in its editor or running \`nextly db:sync\`, then save this change again.`,
      logContext: { collection: slug, drifted },
    });
  }
  // What a refused apply tells the admin is the only account of it they get.
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage: message,
  });
}

/** `desired` with this collection's fields replaced, as a new schema the pipeline has not seen. */
function withFields(
  desired: DesiredSchema,
  slug: string,
  fields: readonly FieldDefinition[]
): DesiredSchema {
  return {
    ...desired,
    collections: {
      ...desired.collections,
      [slug]: {
        ...desired.collections[slug],
        fields: fields as DesiredCollection["fields"],
      },
    },
  };
}

/**
 * A SQLite table rebuild an earlier apply was stopped in the middle of, finished or undone before
 * anything reads the live schema: the push would otherwise meet the rebuild's copy as a table of
 * its own. What it did is logged, for whoever later wonders where a table went.
 */
async function recoverSqliteRebuilds(
  adapter: SchemaChangeDeps["adapter"],
  desired: DesiredSchema,
  slug: string
): Promise<void> {
  if (adapter.dialect !== "sqlite") return;
  const recovered = await recoverInterruptedSqliteRebuilds(
    adapter.getDrizzle(),
    expectedCollectionColumns(desired, adapter.dialect)
  );
  const logger = getLoggerFromDI() ?? consoleLogger;
  for (const line of recovered) {
    logger.warn(`Before applying the change to "${slug}": ${line}.`, {
      collection: slug,
    });
  }
}

/**
 * The fields the change adds over rows, filled: the first push added each column, optional, so
 * it holds NULL; it is filled with its bound value, a Required field's or a stated default's, and
 * where one is Required, `push` applies the fields as the change states them.
 */
async function fillAddedFields(args: {
  adapter: SchemaChangeDeps["adapter"];
  tableName: string;
  fills: readonly { field: string; value: unknown; required: boolean }[];
  push: () => Promise<ApplyResult>;
}): Promise<ApplyResult | undefined> {
  if (args.fills.length === 0) return undefined;
  const { adapter, tableName } = args;
  const db = adapter.getDrizzle();
  for (const { field, value } of args.fills) {
    const column = sql.identifier(toSnakeCase(field));
    await runStatement(
      db,
      adapter.dialect,
      sql`UPDATE ${sql.identifier(tableName)} SET ${column} = ${value} WHERE ${column} IS NULL`
    );
  }
  // Made Required once filled, where one of them is; an optional one is done.
  return args.fills.some(fill => fill.required) ? args.push() : undefined;
}

/** `fields` with the named ones optional, for a push that adds them before they are filled. */
function withFillsOptional(
  fields: readonly FieldDefinition[],
  fills: readonly { field: string; required: boolean }[]
): FieldDefinition[] {
  const filled = new Set(
    fills.filter(fill => fill.required).map(fill => fill.field)
  );
  return fields.map(field =>
    filled.has(field.name) ? { ...field, required: false } : field
  );
}

/**
 * On turning translation off, `fields` with the formerly translated ones' Required and Unique
 * held back, or undefined when nothing is held: their columns reach the main table empty and are
 * filled by the companion's restore, so a setting applied with the column would refuse it.
 */
function translatedSettingsDeferred(
  oldFields: readonly FieldDefinition[],
  fields: readonly FieldDefinition[],
  wasLocalized: boolean,
  isLocalized: boolean
): FieldDefinition[] | undefined {
  if (!wasLocalized || isLocalized) return undefined;
  const translated = new Set(resolveLocalizedFieldNames([...oldFields], true));
  const deferred = withoutLeavingConstraints(fields, translated);
  return deferred.some((field, index) => field !== fields[index])
    ? deferred
    : undefined;
}

/**
 * Where the change's collection kept, and keeps, its translatable values and how each language
 * publishes (`translationLayoutChange`): the one derivation every step of the apply reads.
 */
function layoutOf(change: CollectionSchemaChange): TranslationLayoutChange {
  return translationLayoutChange({
    wasLocalized: change.wasLocalized,
    isLocalized: change.isLocalized,
    wasStatus: change.wasStatus,
    hasStatus: change.status,
  });
}

/**
 * Whether the change's collection kept, and keeps, its translatable values per language: the
 * storage answer to its translation flags before and after.
 */
function storedPerLanguage(change: CollectionSchemaChange): {
  wasLocalized: boolean;
  isLocalized: boolean;
} {
  const layout = layoutOf(change);
  return { wasLocalized: layout.wasStored, isLocalized: layout.isStored };
}

/** `applyCollectionSchemaChange`'s work, run while this context holds the schema lock. */
async function applyHoldingSchemaLock(
  change: CollectionSchemaChange
): Promise<Extract<ApplyResult, { success: true }>> {
  const { slug, collection, fields } = change;
  // Where its translatable values were and are stored, which every step below decides from: per
  // language when it is translated, or always under per-language storage, where turning
  // translation on or off moves nothing.
  const { wasLocalized, isLocalized } = storedPerLanguage(change);
  const { tableName } = collection;
  const deps = requireSchemaChangeDeps(slug);
  const { adapter } = deps;
  const dialect = adapter.dialect;
  // A precondition, so before anything changes: turning translation off drops each language's
  // own publish state, which loses nothing only where it is the entry's.
  if (layoutOf(change).languagesMustAgreeWithEntry) {
    await assertLanguageStatesAgreeWithEntry(adapter, {
      kind: "collection",
      slug,
      tableName,
    });
  }

  // The FULL desired schema (collections, singles and field groups), so drizzle-kit sees every
  // managed table: without the others, tables of other entity types in the live database are
  // absent from the desired snapshot and are offered as rename candidates for this collection.
  const desired = await buildFullDesiredSchema();
  const { apply, promptDispatcher, defaultLocale } = changeApply(change, deps);

  const oldFields = (collection.fields ?? []) as unknown as FieldDefinition[];
  // The answer on a translated field's rename, refused when it does not say, before anything
  // changes.
  const companionRename = await resolveCompanionRename(
    change.renameResolutions,
    {
      tableName,
      oldFields,
      newFields: fields,
      wasLocalized,
      isLocalized,
      dialect,
      builtBy: "collection",
    }
  );
  // A translated relation renamed and switched at once is refused: the companion's rename
  // carries its values as they are.
  refuseCompanionRenameSwitch({
    rename: companionRename,
    oldFields,
    newFields: fields,
    subject: `Collection '${slug}'`,
  });
  // A column made unique over entries that already repeat a value is refused before anything
  // runs, naming the field and how many values repeat.
  await refuseUniqueOverRepeats({
    adapter,
    tableName,
    oldFields,
    newFields: fields,
    wasLocalized,
    isLocalized,
    renames: change.renameResolutions,
    fills: change.fills ?? [],
  });
  // A Required or Unique field leaving translation is pushed without its setting first, and the
  // setting is pushed once the companion transition has copied its values in, before its companion
  // column is dropped.
  //
  // Turning translation off moves every translated field onto the main table at once: their
  // columns are added without the settings too, filled by the companion's restore, and given
  // them by the same second push.
  const settingsDeferred =
    fieldsWithLeavingSettingsDeferred({
      oldFields,
      newFields: fields,
      wasLocalized,
      isLocalized,
      renamed: companionRename,
    }) ??
    translatedSettingsDeferred(oldFields, fields, wasLocalized, isLocalized);
  const settled = settingsDeferred ?? fields;
  const fills = change.fills ?? [];

  // This collection as the change leaves it, over any registry entry for the same slug, with a
  // Required field it adds over rows optional until it is filled.
  desired.collections[slug] = {
    slug,
    tableName,
    fields: withFillsOptional(settled, fills) as DesiredCollection["fields"],
    status: change.status,
    // The translatable columns live in the companion, provisioned below, so the push omits them
    // from the main table.
    localized: isLocalized,
    // Authored in the Schema Builder.
    builderOwned: true,
    recordedFields: recordedFieldsOf(collection),
  };

  await recoverSqliteRebuilds(adapter, desired, slug);
  // An index the change declares whose name another index already holds is refused before
  // anything changes, naming it.
  await refuseIndexNamesTaken(adapter, desired.collections[slug]);

  // A field leaving translation has preconditions of its own, asked before the push alters
  // anything.
  await archiveFieldsLeavingTranslation({
    builtBy: "collection",
    renamed: companionRename,
    tableName,
    defaultLocale,
    adapter,
    entity: slug,
    kind: "collection",
    oldFields,
    newFields: fields,
    wasLocalized,
    isLocalized,
    // The push refuses a main-table column drop its answers did not confirm.
    mainDropsConfirmed: true,
  });

  const result = await apply(desired, "ui", { promptChannel: "auto" });
  if (!result.success) {
    throw refusedApply(slug, promptDispatcher.drifted, result.error.message);
  }
  const filled = await fillAddedFields({
    adapter,
    tableName,
    fills,
    push: () =>
      apply(withFields(desired, slug, settled), "ui", {
        promptChannel: "auto",
      }),
  });
  if (filled !== undefined && !filled.success) {
    throw refusedApply(slug, promptDispatcher.drifted, filled.error.message);
  }

  // The push excludes companion `_locales` tables from its diff: the localization layer owns
  // them. So the companion is reconciled here for any localization change, in this process.
  if (wasLocalized || isLocalized) {
    await reconcileCompanion({
      change,
      adapter,
      desired,
      apply,
      result,
      oldFields,
      companionRename,
      settingsDeferred,
      defaultLocale,
    });
  }
  // The unique index a field that stops being unique still has under a name the push does not
  // declare, as an older table carries, or one an earlier save took on as the field's: dropped,
  // so the column is no longer held unique while the change records it is not.
  await dropUniquenessLeftOn(
    adapter,
    desired.collections[slug],
    oldFields,
    fields
  );
  return result;
}

/**
 * The companion brought in step with the main table the push left, and the leaving fields'
 * settings pushed once their values are shared.
 */
async function reconcileCompanion(args: {
  change: CollectionSchemaChange;
  adapter: SchemaChangeDeps["adapter"];
  desired: DesiredSchema;
  apply: ApplyDesired;
  result: Extract<ApplyResult, { success: true }>;
  oldFields: FieldDefinition[];
  companionRename: Awaited<ReturnType<typeof resolveCompanionRename>>;
  settingsDeferred: ReturnType<typeof fieldsWithLeavingSettingsDeferred>;
  defaultLocale: string;
}): Promise<void> {
  const { change, adapter, desired, apply, oldFields } = args;
  const { slug, fields } = change;
  const { wasLocalized, isLocalized } = storedPerLanguage(change);
  const { tableName } = change.collection;
  try {
    const companionExists = await adapter.tableExists(`${tableName}_locales`);
    const companionHasStatus =
      companionExists && wasLocalized && isLocalized
        ? await companionHasStatusColumn(adapter, `${tableName}_locales`)
        : undefined;
    const plan = buildCompanionTransitionStatements({
      // The companion mirrors the main table, which the Schema Builder's collection creator made.
      builtBy: "collection" as const,
      slug,
      kind: "collection",
      tableName,
      dialect: adapter.dialect,
      defaultLocale: args.defaultLocale,
      // The companion's own `_status`, after and before this apply: under per-language storage
      // only where each language publishes on its own, otherwise the Draft/Published flag. The
      // one before decides whether main carried `status` and the companion `_status`.
      status: layoutOf(change).isPublishedPerLanguage,
      wasLocalized,
      isLocalized,
      wasStatus: layoutOf(change).wasPublishedPerLanguage,
      statusFromEntryInEveryLanguage:
        layoutOf(change).statusFromEntryInEveryLanguage,
      oldFields,
      newFields: fields,
      companionExists,
      companionHasStatus,
      // Added to the companion, with their values, by the apply before its drop.
      joinedBefore: movedOnto(args.result, tableName),
      renamed: args.companionRename ?? undefined,
      holdLeavingDrops: args.settingsDeferred !== undefined,
      // What this database holds now, so a re-apply after a part-applied one finishes it.
      ...(await liveCompanionShape(adapter, {
        tableName,
        oldFields,
        newFields: fields,
        builtBy: "collection",
        companionExists,
      })),
    });
    // The settings the first push left off, once the shared columns hold the default language's
    // values, and only then the leaving fields' companion columns dropped. A new desired schema
    // rather than an edit of the first: the pipeline keeps the last one it applied, by
    // reference, to skip a push that changes nothing.
    await applyCompanionTransition({
      adapter,
      plan,
      settleLeaving: args.settingsDeferred
        ? leavingSettingsStep({
            adapter,
            entity: slug,
            tableName,
            builtBy: "collection",
            oldFields,
            newFields: fields,
            renamed: args.companionRename,
            push: () =>
              apply(withFields(desired, slug, fields), "ui", {
                promptChannel: "auto",
              }),
          })
        : undefined,
      kind: "collection",
      slug,
      tableName,
    });
  } catch (err) {
    // A refused setting names the field, and nothing has been dropped by then, so it is passed
    // on as it is rather than as a companion out of step.
    if (isLeavingSettingsRefusal(err)) throw err;
    // The main-table apply already committed, so this is surfaced loudly rather than leaving
    // the collection half-migrated in silence.
    throw NextlyError.internal({
      cause: err instanceof Error ? err : undefined,
      logContext: {
        op: "companionReconcile",
        collection: slug,
        detail: err instanceof Error ? err.message : String(err),
        note: "main table updated but localized companion out of sync; re-apply to retry",
      },
    });
  }
}

/**
 * Every collection table the desired schema manages, with the columns it is meant to have: what a
 * rebuild of it creates, so the SQLite recovery can tell its copy from another owner's table.
 */
function expectedCollectionColumns(
  desired: { collections: Record<string, DesiredCollection> },
  dialect: Parameters<typeof desiredCollectionTable>[1]
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    Object.values(desired.collections).map(collection => {
      const table = desiredCollectionTable(collection, dialect);
      return [
        table.name,
        new Set(table.columns.map(column => column.name)),
      ] as const;
    })
  );
}

/**
 * Refuse creating a Builder collection whose indexes would take a name held elsewhere
 * (`refuseIndexNamesTaken`). Its table doesn't exist yet, so only names held beyond it can be in
 * the way, and the create's `CREATE ... IF NOT EXISTS` would skip them. A precondition the create
 * asks before its migration runs, against the adapter the create itself runs on (a standalone
 * container's, say), never one looked up elsewhere.
 */
export async function refuseNewCollectionIndexNamesTaken(
  adapter: NonNullable<ReturnType<typeof getAdapterFromDI>>,
  collection: {
    slug: string;
    tableName: string;
    fields: readonly unknown[];
    localized?: boolean;
  }
): Promise<void> {
  await refuseIndexNamesTaken(adapter, {
    slug: collection.slug,
    tableName: collection.tableName,
    fields: [...collection.fields] as DesiredCollection["fields"],
    localized: collection.localized === true,
    // Authored in the Schema Builder.
    builderOwned: true,
  });
}

/**
 * Refuse a change that declares an index under a name another index already holds: one of the
 * table's own, on other columns or with another uniqueness, or, where the dialect shares index
 * names beyond one table, any object elsewhere under that name (`readNameHoldersElsewhere`). The
 * push creates an index only where its name is free, so the field would be recorded unique, or
 * indexed, while the index under that name enforces something else, or nothing on this table. A
 * precondition, read from the live database before anything changes, against the indexes the
 * push itself declares.
 */
async function refuseIndexNamesTaken(
  adapter: NonNullable<ReturnType<typeof getAdapterFromDI>>,
  collection: DesiredCollection
): Promise<void> {
  const { tableName } = collection;
  const db = adapter.getDrizzle();
  // A collection created by this save has no table, and so no indexes of its own yet; names held
  // elsewhere are still checked below, since a new table's indexes take them too.
  const exists = await adapter.tableExists(tableName);
  const [covers, uniqueness] = exists
    ? await Promise.all([
        readIndexColumns(db, adapter.dialect, tableName),
        readIndexUniqueness(db, adapter.dialect, tableName),
      ])
    : [new Map<string, string[]>(), new Map<string, { unique: boolean }>()];
  const declared =
    desiredCollectionTable(collection, adapter.dialect).indexes ?? [];
  // Typed once, so the branch that cannot read the index's columns (`live: null`) and the
  // branch that can (`live: string[]`) yield one element type.
  type Taken = { index: (typeof declared)[number]; live: string[] | null };
  const taken = declared.flatMap((index): Taken[] => {
    if (index.columns.length === 0 || !uniqueness.has(index.name)) return [];
    // An index under the name that does not stand on whole columns (partial, on an expression,
    // a MySQL prefix, or invalid) is not described by its columns, but it still holds the name:
    // the push's CREATE INDEX IF NOT EXISTS would skip it and enforce nothing.
    const live = covers.get(index.name) ?? null;
    if (live === null) return [{ index, live }];
    const sameColumns =
      live.length === index.columns.length &&
      live.every((column, i) => column === index.columns[i]);
    const sameUniqueness =
      (uniqueness.get(index.name)?.unique === true) === index.unique;
    return sameColumns && sameUniqueness ? [] : [{ index, live }];
  });
  // A name this table's indexes don't hold under that exact spelling may still be held elsewhere.
  const unheld = declared.filter(
    index => index.columns.length > 0 && !uniqueness.has(index.name)
  );
  const elsewhere = await readNameHoldersElsewhere(
    db,
    adapter.dialect,
    tableName,
    unheld.map(index => index.name)
  );
  const heldElsewhere = [
    ...unheld.flatMap(index => {
      const holder = elsewhere.get(index.name);
      return holder ? [{ index, holder }] : [];
    }),
    ...(await companionUniqueNamesHeld(adapter, collection)),
  ];
  if (taken.length === 0 && heldElsewhere.length === 0) return;
  throw NextlyError.validation({
    errors: [
      ...heldElsewhere.map(({ index, holder }) => ({
        path: `fields.${index.columns[0]}`,
        code: "INDEX_NAME_TAKEN",
        message:
          `The database already has ${holder.type === "index" ? "an index" : `a ${holder.type}`} ` +
          `"${holder.name}"${holder.table === null ? "" : ` on ${holder.table}`}, holding the name ` +
          `this change's ${index.unique ? "unique " : ""}index on ${index.columns.join(", ")} takes. ` +
          "Remove or rename it first, then save again.",
      })),
      ...taken.map(({ index, live }) => ({
        path: `fields.${index.columns[0]}`,
        code: "INDEX_NAME_TAKEN",
        message:
          `The table already has an index "${index.name}" ` +
          (live === null
            ? "that is partial, on an expression or on part of a column"
            : `on ${live.join(", ")}`) +
          `, under the name this change's ${index.unique ? "unique " : ""}index on ` +
          `${index.columns.join(", ")} takes. Remove that index first, then save again.`,
      })),
    ],
    logContext: {
      tableName,
      indexes: taken.map(({ index, live }) => ({ name: index.name, live })),
      heldElsewhere: heldElsewhere.map(({ index, holder }) => ({
        name: index.name,
        holder,
      })),
    },
  });
}

/**
 * The per-language unique indexes a translated collection's unique translated fields take on its
 * `<table>_locales` companion, whose names are held elsewhere (`readNameHoldersElsewhere`): the
 * companion reconcile creates them with `IF NOT EXISTS` too, so a held name would leave the field
 * recorded unique with nothing enforcing it. Each is described as an index on its column.
 */
async function companionUniqueNamesHeld(
  adapter: NonNullable<ReturnType<typeof getAdapterFromDI>>,
  collection: DesiredCollection
): Promise<
  {
    index: { name: string; columns: string[]; unique: boolean };
    holder: NameHolder;
  }[]
> {
  if (collection.localized !== true) return [];
  const companionTable = `${collection.tableName}_locales`;
  const wanted = uniqueTranslatedColumns({
    // Only a named field has a column; a group's name is optional, and an unnamed one holds none.
    fields: collection.fields.filter(
      (f): f is typeof f & { name: string } => typeof f.name === "string"
    ),
    entityLocalized: true,
    dialect: adapter.dialect,
    builtBy: builtByFor("collection", collection.builderOwned),
  }).map(({ column }) => ({
    name: companionUniqueIndexName(companionTable, column),
    columns: [column],
    unique: true,
  }));
  if (wanted.length === 0) return [];
  const held = await readNameHoldersElsewhere(
    adapter.getDrizzle(),
    adapter.dialect,
    companionTable,
    wanted.map(index => index.name)
  );
  return wanted.flatMap(index => {
    const holder = held.get(index.name);
    return holder ? [{ index, holder }] : [];
  });
}

/**
 * Drop the single-column unique index still covering a column whose field stops being unique.
 * The push drops the index it declared; one under another name, as an older table carries it, or
 * an earlier save took on as the field's, is the column's other uniqueness. A composite index is
 * never touched: it is not the field's.
 */
async function dropUniquenessLeftOn(
  adapter: NonNullable<ReturnType<typeof getAdapterFromDI>>,
  collection: DesiredCollection,
  oldFields: readonly FieldDefinition[],
  newFields: readonly FieldDefinition[]
): Promise<void> {
  const { tableName } = collection;
  const stopped = newFields.filter(
    field =>
      field.unique !== true &&
      oldFields.some(old => old.name === field.name && old.unique === true)
  );
  if (stopped.length === 0) return;
  const db = adapter.getDrizzle();
  const dialect = adapter.dialect;
  // A column the table still keeps unique for its own reasons is left as it is: the system
  // `slug` column is unique whatever a field of that name says.
  const stillUnique = new Set(
    (desiredCollectionTable(collection, dialect).indexes ?? [])
      .filter(index => index.unique && index.columns.length === 1)
      .map(index => index.columns[0])
  );
  const unique = await readUniqueColumns(db, dialect, tableName);
  for (const field of stopped) {
    const column = toSnakeCase(field.name);
    if (stillUnique.has(column)) continue;
    const name = unique.get(column);
    // No name: the primary key, or SQLite's index for an inline UNIQUE, which no statement drops.
    if (name === undefined || name === null) continue;
    if (dialect === "postgresql") {
      await runStatement(
        db,
        dialect,
        sql`ALTER TABLE ${sql.identifier(tableName)} DROP CONSTRAINT IF EXISTS ${sql.identifier(name)}`
      );
      await runStatement(
        db,
        dialect,
        sql`DROP INDEX IF EXISTS ${sql.identifier(name)}`
      );
    } else if (dialect === "mysql") {
      await runStatement(
        db,
        dialect,
        sql`DROP INDEX ${sql.identifier(name)} ON ${sql.identifier(tableName)}`
      );
    } else {
      await runStatement(
        db,
        dialect,
        sql`DROP INDEX IF EXISTS ${sql.identifier(name)}`
      );
    }
  }
}
