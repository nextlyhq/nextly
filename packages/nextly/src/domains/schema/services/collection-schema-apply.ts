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
import { sql } from "drizzle-orm";

import {
  isLeavingSettingsRefusal,
  leavingSettingsStep,
} from "../../../dispatcher/helpers/builder-schema-push";
import { buildFullDesiredSchema } from "../../../dispatcher/helpers/desired-schema";
import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getMigrationJournalFromDI,
} from "../../../dispatcher/helpers/di";
import { NextlyError } from "../../../errors";
import { getProductionNotifier } from "../../../runtime/notifications/index";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { appLocalization } from "../../i18n/configured-locales";
import {
  archiveFieldsLeavingTranslation,
  fieldsWithLeavingSettingsDeferred,
} from "../../i18n/migration/archive-preflight";
import { resolveCompanionRename } from "../../i18n/migration/companion-rename";
import { applyCompanionTransition } from "../../i18n/migration/held-leaving-drops";
import { buildCompanionTransitionStatements } from "../../i18n/migration/reconcile-companion";
import {
  companionHasStatusColumn,
  liveCompanionShape,
} from "../../i18n/runtime/companion-io";
import { runStatement } from "../pipeline/_internal/run-statement";
import {
  createApplyDesiredSchema,
  movedOnto,
  type ApplyResult,
} from "../pipeline/apply";
import { RealClassifier } from "../pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../pipeline/database-url";
import { desiredCollectionTable } from "../pipeline/desired-collection-table";
import {
  readIndexColumns,
  readIndexUniqueness,
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
import { RegexRenameDetector } from "../pipeline/rename-detector";
import type { Resolution } from "../pipeline/resolution/types";
import { recoverInterruptedSqliteRebuilds } from "../pipeline/sqlite-rebuild-recovery";
import type { DesiredCollection } from "../pipeline/types";

import { DrizzleStatementExecutor } from "./drizzle-statement-executor";
import { toSnakeCase } from "./field-column-descriptor";

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
    private readonly ownTable: string | undefined
  ) {}

  dispatch(
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
    const rest: BrowserRenameResolution[] =
      this.ownTable === undefined
        ? []
        : args.candidates
            .filter(
              c =>
                c.tableName === this.ownTable &&
                !answered.has(key(c)) &&
                !renamedFrom.has(`${c.tableName}::${c.fromColumn}`)
            )
            .map(c => ({
              tableName: c.tableName,
              fromColumn: c.fromColumn,
              toColumn: c.toColumn,
              choice: "drop_and_add" as const,
            }));
    return new BrowserPromptDispatcher(
      [...this.renameResolutions, ...rest],
      this.eventResolutions,
      this.legacyResolutions
    ).dispatch(args);
  }
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
   * Whether every pair of columns on the collection's own table not answered above is a drop and
   * an add: the Builder save's rule, which detects its own renames. The dialog asks the admin.
   */
  dropAndAddUnansweredRenames?: boolean;
}

/**
 * Apply one collection's schema change to this database, or refuse it.
 *
 * @throws {NextlyError} `NEXTLY_MIGRATION_APPLY_FAILED` with the pipeline's own words when the
 *   push is refused, the refusal of a leaving field's settings as it is, and `INTERNAL_ERROR` when
 *   the push landed and the companion could not be brought in step
 */
export async function applyCollectionSchemaChange(
  change: CollectionSchemaChange
): Promise<Extract<ApplyResult, { success: true }>> {
  const { slug, collection, fields, wasLocalized, isLocalized } = change;
  const { tableName } = collection;
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

  // The FULL desired schema (collections, singles and field groups), so drizzle-kit sees every
  // managed table: without the others, tables of other entity types in the live database are
  // absent from the desired snapshot and are offered as rename candidates for this collection.
  const desired = await buildFullDesiredSchema();

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
      change.dropAndAddUnansweredRenames === true ? tableName : undefined
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
  // A Required or Unique field leaving translation is pushed without its setting first, and the
  // setting is pushed once the companion transition has copied its values in, before its companion
  // column is dropped.
  const settingsDeferred = fieldsWithLeavingSettingsDeferred({
    oldFields,
    newFields: fields,
    wasLocalized,
    isLocalized,
    renamed: companionRename,
  });

  // This collection as the change leaves it, over any registry entry for the same slug.
  desired.collections[slug] = {
    slug,
    tableName,
    fields: (settingsDeferred ?? fields) as DesiredCollection["fields"],
    status: change.status,
    // The translatable columns live in the companion, provisioned below, so the push omits them
    // from the main table.
    localized: isLocalized,
    // Authored in the Schema Builder.
    builderOwned: true,
    recordedFields: recordedFieldsOf(collection),
  };

  // A SQLite table rebuild an earlier apply was stopped in the middle of is finished or undone
  // first, before anything reads the live schema: the push would otherwise meet the rebuild's copy
  // as a table of its own.
  if (dialect === "sqlite") {
    await recoverInterruptedSqliteRebuilds(db, managedTablesOf(desired));
  }
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
    // Another table stopped it: named, with what differs and the way on, so the change is not
    // taken for the one refused.
    if (promptDispatcher.drifted.length > 0) {
      throw new NextlyError({
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        publicMessage:
          `This change was not applied, because another table differs from what was recorded ` +
          `for it: ${promptDispatcher.drifted.join("; ")}. Bring that table in step first, by ` +
          `applying its own change in its editor or running \`nextly db:sync\`, then save ` +
          `this change again.`,
        logContext: { collection: slug, drifted: promptDispatcher.drifted },
      });
    }
    // The push's own words, under the code its status already was: what a refused apply tells
    // the admin is the only account of it they get.
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: result.error.message,
    });
  }

  // The push excludes companion `_locales` tables from its diff: the localization layer owns
  // them. So the companion is reconciled here for any localization change, in this process.
  if (wasLocalized || isLocalized) {
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
        dialect,
        defaultLocale,
        status: change.status,
        wasLocalized,
        isLocalized,
        // The status before the change, which decides whether main carried `status` and the
        // companion `_status` before this apply.
        wasStatus: change.wasStatus,
        oldFields,
        newFields: fields,
        companionExists,
        companionHasStatus,
        // Added to the companion, with their values, by the apply before its drop.
        joinedBefore: movedOnto(result, tableName),
        renamed: companionRename ?? undefined,
        holdLeavingDrops: settingsDeferred !== undefined,
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
        settleLeaving: settingsDeferred
          ? leavingSettingsStep({
              adapter,
              entity: slug,
              tableName,
              builtBy: "collection",
              oldFields,
              newFields: fields,
              renamed: companionRename,
              push: () =>
                apply(
                  {
                    ...desired,
                    collections: {
                      ...desired.collections,
                      [slug]: {
                        ...desired.collections[slug],
                        fields: fields as DesiredCollection["fields"],
                      },
                    },
                  },
                  "ui",
                  { promptChannel: "auto" }
                ),
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
  // The unique index a field that stops being unique still has under a name the push does not
  // declare, as an older table carries, or one an earlier save took on as the field's: dropped,
  // so the column is no longer held unique while the change records it is not.
  await dropUniquenessLeftOn(adapter, tableName, oldFields, fields);
  return result;
}

/** Every table the desired schema manages, by name. */
function managedTablesOf(desired: {
  collections: Record<string, { tableName: string }>;
  singles: Record<string, { tableName: string }>;
  components: Record<string, { tableName: string }>;
}): ReadonlySet<string> {
  return new Set(
    [
      ...Object.values(desired.collections),
      ...Object.values(desired.singles),
      ...Object.values(desired.components),
    ].map(entry => entry.tableName)
  );
}

/**
 * Refuse a change that declares an index under a name another index of the table already holds,
 * on other columns or with another uniqueness: the push creates an index only where its name is
 * free, so the field would be recorded unique, or indexed, while the index under that name
 * enforces something else. A precondition, read from the live table before anything changes,
 * against the indexes the push itself declares.
 */
async function refuseIndexNamesTaken(
  adapter: NonNullable<ReturnType<typeof getAdapterFromDI>>,
  collection: DesiredCollection
): Promise<void> {
  const { tableName } = collection;
  if (!(await adapter.tableExists(tableName))) return;
  const db = adapter.getDrizzle();
  const [covers, uniqueness] = await Promise.all([
    readIndexColumns(db, adapter.dialect, tableName),
    readIndexUniqueness(db, adapter.dialect, tableName),
  ]);
  const declared =
    desiredCollectionTable(collection, adapter.dialect).indexes ?? [];
  const taken = declared.flatMap(index => {
    const live = covers.get(index.name);
    if (live === undefined || index.columns.length === 0) return [];
    const sameColumns =
      live.length === index.columns.length &&
      live.every((column, i) => column === index.columns[i]);
    const sameUniqueness =
      (uniqueness.get(index.name)?.unique === true) === index.unique;
    return sameColumns && sameUniqueness ? [] : [{ index, live }];
  });
  if (taken.length === 0) return;
  throw NextlyError.validation({
    errors: taken.map(({ index, live }) => ({
      path: `fields.${index.columns[0]}`,
      code: "INDEX_NAME_TAKEN",
      message:
        `The table already has an index "${index.name}" on ${live.join(", ")}, under the name ` +
        `this change's ${index.unique ? "unique " : ""}index on ${index.columns.join(", ")} ` +
        `takes. Remove that index first, then save again.`,
    })),
    logContext: {
      tableName,
      indexes: taken.map(({ index, live }) => ({ name: index.name, live })),
    },
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
  tableName: string,
  oldFields: readonly FieldDefinition[],
  newFields: readonly FieldDefinition[]
): Promise<void> {
  const stopped = newFields.filter(
    field =>
      field.unique !== true &&
      oldFields.some(old => old.name === field.name && old.unique === true)
  );
  if (stopped.length === 0) return;
  const db = adapter.getDrizzle();
  const dialect = adapter.dialect;
  const unique = await readUniqueColumns(db, dialect, tableName);
  for (const field of stopped) {
    const name = unique.get(toSnakeCase(field.name));
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
