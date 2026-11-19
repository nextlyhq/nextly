/**
 * Brings each collection, Single and field group registry row the registry
 * source records to that record (`registry-source.ts`), writing nothing to a
 * row that already matches. A row of an entity the source does not hold is
 * left as it is, unless an applied migration dropped the entity (its record
 * held it, the next no longer does, and its table is gone): removing a row
 * deletes data, which only a migration applied with consent may do. A Builder record leaves the
 * settings it does not say as they are stored, unless a migration cleared
 * them (`registry-history.ts`).
 *
 * Each declaration is turned into a row by the projection the start's
 * code-first sync uses for a config entry, or, for a Builder entity, by the
 * one its generated registry upsert uses, so `nextly migrate`, a start and a
 * migration file agree on what a matching row is.
 *
 * @module domains/schema/migrate/registry-writer
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { isReservedResourceSlug } from "../../../schemas/_zod/rbac";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { adapterForReads } from "../../../shared/lib/read-transaction-scope";
import type { Logger } from "../../../shared/types";
import {
  CollectionRegistryService,
  type CodeFirstCollectionConfig,
  type UnsaidSetting,
} from "../../collections/services/collection-registry-service";
import {
  toCodeFirstCollectionConfig,
  type CodeFirstCollectionSource,
} from "../../collections/services/collection-sync-service";
import { dashboardPinsPresent } from "../../dashboard/dashboard-pins";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  FieldGroupRegistryService,
  toCodeFirstComponentConfig,
  type CodeFirstComponentConfig,
  type CodeFirstComponentSource,
} from "../../field-groups/services/field-group-registry-service";
import {
  SingleRegistryService,
  toCodeFirstSingleConfig,
  type CodeFirstSingleConfig,
  type CodeFirstSingleSource,
} from "../../singles/services/single-registry-service";
import { mediaUsageTablePresent } from "../../versions/entity-teardown";
import type {
  RecordedEntitySettings,
  SettingsEntityKind,
} from "../migrate-create/entity-settings";
import {
  carriesRegistryMetadata,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";
import { inRegistryStep, writeRegistryRows } from "../schema-version";
import type { OwningEntity } from "../services/remove-entity-owned-data";
import {
  collectionRowValues,
  componentRowValues,
  singleRowValues,
} from "../ui-schema/metadata-sql";

import {
  anySlugs,
  clearedSettings,
  droppedEntities,
  RECORDED_KINDS,
  typeChangedEntities,
  type SlugsByKind,
} from "./registry-history";
import { removeRegistryRow } from "./registry-row-removal";
import type { RegistrySource } from "./registry-source";
import { topLevelFieldNames } from "./top-level-field-names";

export interface RegistryWriteDeps {
  adapter: DrizzleAdapter;
  logger: Logger;
  /**
   * The origin of each collection a plugin contributes, `plugin:<name>` by
   * slug, as the start gives it: a row the writer creates for one of them
   * is that plugin's, not the app's.
   */
  collectionSources?: ReadonlyMap<string, `plugin:${string}`>;
  /**
   * Which rows the registry already holds are brought to the source, by kind
   * and slug; every one when absent. A row the registry lacks is written
   * whatever this says. A development run passes it so a row a live sync
   * edited is rewritten only where a migration it applied changed the entity
   * (`reconcile-metadata.ts`).
   */
  rewrites?: (kind: SettingsEntityKind, slug: string) => boolean;
}

export interface RegistryWriteResult {
  /** Rows created or rewritten, by kind. */
  written: Record<SettingsEntityKind, number>;
  /** Rows removed, as `<kind> <slug>`. */
  removed: string[];
  /** Entities whose row could not be written or removed, as `<kind> <slug>`. */
  failed: string[];
  /**
   * Entities an applied migration dropped whose tables are gone, for the run to retire once this
   * pass commits (`retireDroppedEntities`): the rows they own outside their tables first, each kind
   * on its own, their registry row last. Their registry rows are left in this pass, so an entity
   * whose retirement stops part-way is still found owed by the next run.
   */
  retiring?: OwningEntity[];
}

/**
 * What one pass writes beyond bringing every recorded row to the source.
 * Each part left out is judged from the source's chain of applied records
 * (`RegistrySource.chain`), as `nextly migrate` judges it.
 */
export interface RegistryWritePlan {
  /**
   * Write only these entities' rows: one file's type change, or what a
   * rollback undoes. Nothing is removed unless `remove` names it.
   */
  only?: SlugsByKind;
  /** The rows to remove; by default the entities an applied migration dropped. */
  remove?: SlugsByKind;
  /** The Builder settings a migration cleared; by default judged along the chain. */
  cleared?: ReadonlyMap<string, ReadonlySet<UnsaidSetting>>;
  /**
   * Fail the pass on the first row that cannot be written, rather than
   * report it and go on: a row written with a migration's file, which must
   * commit with the file or not at all.
   */
  strict?: boolean;
}

/** One row the source asks for, and how to bring the registry to it. */
interface RecordedRow {
  kind: SettingsEntityKind;
  slug: string;
  write: () => Promise<"created" | "updated" | "unchanged">;
  /** The top-level field names the record declares. */
  recordedFields: readonly string[];
  /** The top-level field names the stored row holds; undefined where none was read. */
  storedFields: readonly string[] | undefined;
}

/**
 * A registry row that differs from the registry source: one `nextly migrate`
 * would write (`missing`) or rewrite (`differs`). The field names say what a
 * reader can see differ; a row whose fields agree differs in its settings.
 */
export interface RowBehindSource {
  kind: SettingsEntityKind;
  slug: string;
  row: "missing" | "differs";
  /** Fields the record declares and the row lacks. */
  missingFields: string[];
  /** Fields the row holds and the record does not declare. */
  extraFields: string[];
}

/**
 * Every registry row that differs from `source`, judged by the writer itself
 * (`RecordedWriteOptions.judgeOnly`) and writing nothing, so a row named here
 * is exactly one {@link writeRegistryFromSource} would write. A row that
 * cannot be judged is listed in `failed`, as `<kind> <slug>`.
 */
export async function rowsBehindSource(
  source: Extract<RegistrySource, { kind: "snapshot" }>,
  deps: RegistryWriteDeps,
  /**
   * The rows to judge against, in place of the ones the registry holds now:
   * the rows a registry record kept. Given, no registry table is read.
   */
  against?: RowsBySlug
): Promise<{ behind: RowBehindSource[]; failed: string[] }> {
  const chain = source.chain ?? [source.entities];
  const { rows } = await recordedRows(
    source,
    deps,
    clearedSettings(source.entities, chain.slice(0, -1)),
    true,
    against
  );
  const behind: RowBehindSource[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    let step: "created" | "updated" | "unchanged";
    try {
      step = await row.write();
    } catch {
      failed.push(`${row.kind} ${row.slug}`);
      continue;
    }
    if (step === "unchanged") continue;
    const stored = new Set(row.storedFields ?? []);
    const recorded = new Set(row.recordedFields);
    behind.push({
      kind: row.kind,
      slug: row.slug,
      row: step === "created" ? "missing" : "differs",
      missingFields:
        step === "created"
          ? []
          : row.recordedFields.filter(name => !stored.has(name)),
      extraFields: (row.storedFields ?? []).filter(name => !recorded.has(name)),
    });
  }
  return { behind, failed };
}

/** Registry rows by slug for each kind, as a registry record keeps them. */
export interface RowsBySlug {
  collections: Readonly<Record<string, unknown>>;
  singles: Readonly<Record<string, unknown>>;
  fieldGroups: Readonly<Record<string, unknown>>;
}

/** The registry rows read once, by kind and slug; a kind absent where its table could not be read. */
type StoredRows = Partial<
  Record<SettingsEntityKind, ReadonlyMap<string, unknown>>
>;

/** Brings the registry to `source`, row by row, under the caller's lock. */
export async function writeRegistryFromSource(
  source: Extract<RegistrySource, { kind: "snapshot" }>,
  deps: RegistryWriteDeps,
  plan: RegistryWritePlan = {}
): Promise<RegistryWriteResult> {
  const result: RegistryWriteResult = {
    written: { collection: 0, single: 0, fieldGroup: 0 },
    removed: [],
    failed: [],
  };
  const chain = source.chain ?? [source.entities];
  const cleared =
    plan.cleared ?? clearedSettings(source.entities, chain.slice(0, -1));
  try {
    const { rows, stored } = await recordedRows(source, deps, cleared);
    for (const row of rows) {
      if (plan.only !== undefined && !plan.only[row.kind].has(row.slug)) {
        continue;
      }
      // Outside the per-row guard below: a lost lock stops the pass, it is
      // never one row's failure to report and go on from.
      await assertSchemaLockHeld();
      try {
        // Its own step of the registry write the caller opened, so a row that
        // fails is rolled back alone and the rest still land (`inRegistryStep`).
        if ((await inRegistryStep(deps.adapter, row.write)) !== "unchanged") {
          result.written[row.kind] += 1;
        }
      } catch (error) {
        if (plan.strict === true) throw error;
        // One row that cannot be written costs only that row; the rest are
        // still brought to the source, and the run says which one failed.
        result.failed.push(`${row.kind} ${row.slug}`);
        deps.logger.warn(
          `Could not write the registry row of ${row.kind} "${row.slug}": ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    if (plan.remove !== undefined) {
      await removeRows(plan.remove, stored, deps, result);
    } else if (plan.only === undefined) {
      // A drop judged from the snapshots alone is confirmed by the table: a
      // migration applied with consent dropped it, so a row whose table still
      // stands is no drop's and is left with it. The rest are retired by the
      // run once this pass commits.
      result.retiring = await retiringEntities(
        droppedEntities(chain),
        stored,
        deps,
        result
      );
    }
  } finally {
    // Every cached read of a row may now describe one that changed.
    clearRegistryRowCache();
  }
  return result;
}

/**
 * Each entity in `remove` the registry holds a row for, with that row. An entity of a reserved
 * slug, or with no stored row, is passed over; a kind whose rows could not be read is passed over
 * whole, as its rows were not written, and each of its entities is reported not done, so the run
 * never reads as complete while a row it should remove may stay.
 */
function storedCandidates(
  remove: SlugsByKind,
  stored: StoredRows,
  deps: RegistryWriteDeps,
  result: RegistryWriteResult
): { kind: SettingsEntityKind; slug: string; row: unknown }[] {
  const candidates = RECORDED_KINDS.flatMap(([kind]) =>
    [...remove[kind]]
      .filter(slug => !isReservedResourceSlug(slug))
      .map(slug => ({ kind, slug }))
  );
  for (const { kind, slug } of candidates) {
    if (stored[kind] !== undefined) continue;
    result.failed.push(`${kind} ${slug}`);
    deps.logger.warn(
      `Could not remove the registry row of ${kind} "${slug}": the ${kind} registry could not be read.`
    );
  }
  return candidates.flatMap(({ kind, slug }) => {
    const row = stored[kind]?.get(slug);
    return row === undefined ? [] : [{ kind, slug, row }];
  });
}

/**
 * The entities in `dropped` the registry still holds whose tables are gone, for the run to retire
 * (`RegistryWriteResult.retiring`), asked on the registry write the caller opened.
 */
async function retiringEntities(
  dropped: SlugsByKind,
  stored: StoredRows,
  deps: RegistryWriteDeps,
  result: RegistryWriteResult
): Promise<OwningEntity[]> {
  const view = adapterForReads(deps.adapter);
  const retiring: OwningEntity[] = [];
  for (const { kind, slug, row } of storedCandidates(
    dropped,
    stored,
    deps,
    result
  )) {
    const table = tableNameOf(row);
    // A row naming no table, or one whose table still stands, is no drop's.
    if (table === undefined || (await tableStands(deps.adapter, view, row))) {
      continue;
    }
    retiring.push({ kind, slug, table });
  }
  return retiring;
}

/**
 * Remove the stored row of each entity in `remove`, on the registry write the caller opened (or
 * one of its own), as `migrate:down` removes the row of an entity a rolled-back migration added.
 */
async function removeRows(
  remove: SlugsByKind,
  stored: StoredRows,
  deps: RegistryWriteDeps,
  result: RegistryWriteResult
): Promise<void> {
  const doomed = storedCandidates(remove, stored, deps, result);
  if (doomed.length === 0) return;
  result.removed.push(...(await removeRegistryRowsIn(deps.adapter, doomed)));
}

/**
 * Removes the registry row of each of `entities`, with what goes with it, in one registry write
 * (the caller's, or one of its own), and returns them as `<kind> <slug>`. A removal that fails
 * fails the write, so nothing of any of them is kept.
 */
export async function removeRegistryRowsIn(
  adapter: DrizzleAdapter,
  entities: readonly { kind: SettingsEntityKind; slug: string }[]
): Promise<string[]> {
  const removed: string[] = [];
  await writeRegistryRows(
    adapter,
    async tx => {
      const view = adapterForReads(adapter);
      // Asked on the transaction the rows are removed in (`view`), never on
      // a second connection that cannot see it, each as a step of its own so
      // a probe that fails cannot abort it.
      const tables = {
        dashboardPinsPresent: await inRegistryStep(adapter, () =>
          dashboardPinsPresent(adapter, undefined, view)
        ),
        mediaUsagePresent: await inRegistryStep(adapter, () =>
          mediaUsageTablePresent(adapter, undefined, view)
        ),
      };
      for (const { kind, slug } of entities) {
        await assertSchemaLockHeld();
        // Not one row's failure to report and go on from: a removal deletes
        // the entity's autosaves and pins before its row, and on MySQL a
        // step has no savepoint to undo them, so a removal that fails fails
        // the registry write it is part of, which then leaves them all.
        await removeRegistryRow({ tx, view, tables }, kind, slug);
        removed.push(`${kind} ${slug}`);
      }
      return removed.length;
    },
    { wrote: count => count > 0 }
  );
  return removed;
}

/** The table a stored registry row names, or undefined where it names none. */
function tableNameOf(row: unknown): string | undefined {
  const tableName =
    row !== null && typeof row === "object"
      ? (row as { tableName?: unknown }).tableName
      : undefined;
  return typeof tableName === "string" && tableName !== ""
    ? tableName
    : undefined;
}

/**
 * Whether the table a stored registry row names is there, asked as a step of
 * its own; a row naming none, or a table that cannot be asked about, reads
 * as standing, so its row is kept.
 */
async function tableStands(
  adapter: DrizzleAdapter,
  view: DrizzleAdapter,
  row: unknown
): Promise<boolean> {
  const tableName = tableNameOf(row);
  if (tableName === undefined) return true;
  try {
    return await inRegistryStep(adapter, () => view.tableExists(tableName));
  } catch {
    return true;
  }
}

/**
 * Every row the source records, in kind order, reserved slugs left out, and
 * the rows the registry holds, read once here rather than once per entity.
 */
async function recordedRows(
  source: Extract<RegistrySource, { kind: "snapshot" }>,
  deps: RegistryWriteDeps,
  cleared: ReadonlyMap<string, ReadonlySet<UnsaidSetting>>,
  /** Each row's `write` answers what it would do and writes nothing (`rowsBehindSource`). */
  judgeOnly = false,
  /** Rows to judge against in place of the stored ones (`rowsBehindSource`). */
  against?: RowsBySlug
): Promise<{ rows: RecordedRow[]; stored: StoredRows }> {
  const collections = new CollectionRegistryService(deps.adapter, deps.logger);
  const singles = new SingleRegistryService(deps.adapter, deps.logger);
  const fieldGroups = new FieldGroupRegistryService(deps.adapter, deps.logger);
  // A slug the system keeps for its own resources is never a registry row,
  // whatever a snapshot says.
  const kept = ([slug]: [string, RecordedEntitySettings]) =>
    !isReservedResourceSlug(slug);
  const { entities } = source;
  // Kept rows stand in for the stored ones as the registry's own would: a
  // row a record kept is the row the service read, made JSON-safe.
  const keptRows = <TRecord>(rows: Readonly<Record<string, unknown>>) =>
    new Map(Object.entries(rows)) as ReadonlyMap<string, TRecord>;
  const [storedCollections, storedSingles, storedFieldGroups] =
    against !== undefined
      ? [
          keptRows<
            Awaited<ReturnType<typeof collections.getAllCollections>>[number]
          >(against.collections),
          keptRows<Awaited<ReturnType<typeof singles.getAllSingles>>[number]>(
            against.singles
          ),
          keptRows<
            Awaited<ReturnType<typeof fieldGroups.getAllComponents>>[number]
          >(against.fieldGroups),
        ]
      : // One after another, each its own step: a registry that cannot be read
        // must not abort the transaction the rows are written in, and steps on
        // one transaction run in turn.
        [
          await storedBySlug(deps.adapter, () =>
            collections.getAllCollections()
          ),
          await storedBySlug(deps.adapter, () => singles.getAllSingles()),
          await storedBySlug(deps.adapter, () =>
            fieldGroups.getAllComponents()
          ),
        ];
  const options = <TRecord>(
    kind: SettingsEntityKind,
    recorded: RecordedEntitySettings,
    stored: ReadonlyMap<string, TRecord> | undefined,
    slug: string
  ) => ({
    ...recordedOptions(recorded, stored, slug),
    ...(cleared.has(`${kind}:${slug}`)
      ? { cleared: cleared.get(`${kind}:${slug}`) }
      : {}),
    ...(judgeOnly ? { judgeOnly } : {}),
  });
  // The field names each side holds, for a row judged to differ.
  const names = (
    recorded: RecordedEntitySettings,
    stored: ReadonlyMap<string, unknown> | undefined,
    slug: string
  ) => ({
    recordedFields: topLevelFieldNames(recorded.settings.fields),
    storedFields:
      stored === undefined
        ? undefined
        : topLevelFieldNames(
            (stored.get(slug) as { fields?: unknown } | undefined)?.fields
          ),
  });
  // A row the registry holds is left out unless `rewrites` asks for it. A
  // registry that could not be read holds nothing known, so its rows are
  // written, each read on its own as it is.
  const chosen =
    (
      kind: SettingsEntityKind,
      stored: ReadonlyMap<string, unknown> | undefined
    ) =>
    ([slug]: [string, RecordedEntitySettings]) =>
      deps.rewrites === undefined ||
      stored?.has(slug) !== true ||
      deps.rewrites(kind, slug);
  const rows: RecordedRow[] = [
    ...Object.entries(entities.collections)
      .filter(kept)
      .filter(chosen("collection", storedCollections))
      .map(([slug, recorded]) => ({
        kind: "collection" as const,
        slug,
        ...names(recorded, storedCollections, slug),
        write: () =>
          collections.writeRecordedCollection(
            recordedCollection(slug, recorded),
            collectionOriginOf(recorded, deps.collectionSources?.get(slug)),
            options("collection", recorded, storedCollections, slug)
          ),
      })),
    ...Object.entries(entities.singles)
      .filter(kept)
      .filter(chosen("single", storedSingles))
      .map(([slug, recorded]) => ({
        kind: "single" as const,
        slug,
        ...names(recorded, storedSingles, slug),
        write: () =>
          singles.writeRecordedSingle(
            recordedSingle(slug, recorded),
            originOf(recorded),
            options("single", recorded, storedSingles, slug)
          ),
      })),
    ...Object.entries(entities.fieldGroups)
      .filter(kept)
      .filter(chosen("fieldGroup", storedFieldGroups))
      .map(([slug, recorded]) => ({
        kind: "fieldGroup" as const,
        slug,
        ...names(recorded, storedFieldGroups, slug),
        write: () => {
          // Projected inside the row's own write, so a record that cannot be
          // read costs that row alone.
          const { config, tableName } = recordedFieldGroup(slug, recorded);
          return fieldGroups.writeRecordedComponent(
            config,
            originOf(recorded),
            {
              ...options("fieldGroup", recorded, storedFieldGroups, slug),
              ...(tableName === undefined ? {} : { tableName }),
            }
          );
        },
      })),
  ];
  return {
    rows,
    stored: {
      ...(storedCollections === undefined
        ? {}
        : { collection: storedCollections }),
      ...(storedSingles === undefined ? {} : { single: storedSingles }),
      ...(storedFieldGroups === undefined
        ? {}
        : { fieldGroup: storedFieldGroups }),
    },
  };
}

/**
 * A registry table's rows by slug, read once; undefined where it cannot be
 * read, so each row is read on its own and one that fails costs only itself.
 */
async function storedBySlug<TRecord extends { slug: string }>(
  adapter: DrizzleAdapter,
  read: () => Promise<TRecord[]>
): Promise<ReadonlyMap<string, TRecord> | undefined> {
  try {
    return new Map(
      (await inRegistryStep(adapter, read)).map(row => [row.slug, row])
    );
  } catch {
    return undefined;
  }
}

/**
 * How one recorded entity is handed to its service: its stored row, as read
 * with the rest (`null` when the table holds none), and whether it leaves
 * what it does not say, as a Builder record does.
 */
function recordedOptions<TRecord>(
  recorded: RecordedEntitySettings,
  stored: ReadonlyMap<string, TRecord> | undefined,
  slug: string
): { existing?: TRecord | null; leavesUnsaid: boolean } {
  return {
    ...(stored === undefined ? {} : { existing: stored.get(slug) ?? null }),
    leavesUnsaid: recorded.source === "builder",
  };
}

/**
 * What a row the writer creates says about where it came from, as the start
 * would say it: a code-first entity a plugin contributes is that plugin's
 * (`plugin`), any other code-first one the app's, a Builder one the
 * Builder's. Used only for a row the writer creates.
 */
function originOf(recorded: RecordedEntitySettings): {
  source: "code" | "ui";
  locked: boolean;
} {
  return recorded.source === "code"
    ? { source: "code", locked: true }
    : { source: "ui", locked: false };
}

/** `originOf` for a collection, which a plugin can contribute (`plugin`). */
function collectionOriginOf(
  recorded: RecordedEntitySettings,
  plugin: `plugin:${string}` | undefined
): { source: "code" | "ui" | `plugin:${string}`; locked: boolean } {
  const origin = originOf(recorded);
  return origin.source === "code" && plugin !== undefined
    ? { ...origin, source: plugin }
    : origin;
}

/** A recorded Single, as the code-first sync's payload (`recordedCollection`). */
function recordedSingle(
  slug: string,
  recorded: RecordedEntitySettings
): CodeFirstSingleConfig {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    // `defineSingle` gives every Single an admin object, empty where the
    // config declares no option, and a snapshot drops an object holding only
    // unset options. Restored, so the row stores what a start stores.
    return toCodeFirstSingleConfig({
      admin: {},
      ...declared,
    } as CodeFirstSingleSource);
  }
  const row = singleRowValues(declared as UiSchemaEntity);
  return {
    slug,
    label: row.label,
    fields: row.fields,
    ...(row.description === undefined || row.description === null
      ? {}
      : { description: row.description }),
    tableName: row.tableName,
    status: row.status,
    versions: row.versions,
    revalidate: row.revalidate,
    webhooks: row.webhooks,
    localized: row.localized,
    ...(row.admin === undefined ? {} : { admin: row.admin }),
  };
}

/**
 * A recorded field group, as the code-first sync's payload
 * (`recordedCollection`), and for a Builder one the table its own row names,
 * which its slug can spell differently from the code-first derivation.
 */
function recordedFieldGroup(
  slug: string,
  recorded: RecordedEntitySettings
): { config: CodeFirstComponentConfig; tableName?: string } {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    return {
      config: toCodeFirstComponentConfig(declared as CodeFirstComponentSource),
    };
  }
  const row = componentRowValues(declared as UiSchemaEntity);
  return {
    config: {
      slug,
      label: row.label,
      fields: row.fields,
      ...(row.description === undefined || row.description === null
        ? {}
        : { description: row.description }),
      localized: row.localized,
      ...(row.admin === undefined || row.admin === null
        ? {}
        : { admin: row.admin }),
    },
    tableName: row.tableName,
  };
}

/**
 * A recorded collection, as the code-first sync's payload: a code-first
 * declaration through the projection the start uses for a config entry, a
 * Builder one through the row its generated registry upsert writes.
 */
function recordedCollection(
  slug: string,
  recorded: RecordedEntitySettings
): CodeFirstCollectionConfig {
  const declared = { ...declaration(recorded), slug };
  if (recorded.source === "code") {
    return toCodeFirstCollectionConfig(
      declared as CodeFirstCollectionSource<
        CodeFirstCollectionConfig["fields"][number]
      >
    );
  }
  const row = collectionRowValues(declared as UiSchemaEntity);
  return {
    slug,
    labels: row.labels,
    fields: row.fields,
    ...(row.description === undefined || row.description === null
      ? {}
      : { description: row.description }),
    tableName: row.tableName,
    status: row.status,
    versions: row.versions,
    revalidate: row.revalidate,
    webhooks: row.webhooks,
    localized: row.localized,
    ...(row.admin === undefined ? {} : { admin: row.admin }),
  };
}

/**
 * A recorded declaration, refused unless it holds a field list: a snapshot
 * is read from disk, and a row written from a record without one would
 * clear every field. The refusal costs that row alone (`writeRegistryFromSource`).
 */
function declaration(
  recorded: RecordedEntitySettings
): Record<string, unknown> {
  if (!Array.isArray(recorded.settings.fields)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "fields",
          code: "REQUIRED",
          message: "A recorded declaration holds no field list.",
        },
      ],
      logContext: { source: recorded.source },
    });
  }
  return recorded.settings;
}

/**
 * The registry rows a migration's file writes with itself: those of the
 * entities whose field types change between the record the database stands
 * at before the file (`from`) and the one it stands at after (`to`), brought
 * to `to`, and no other. Undefined where nothing changes type, or where
 * either record is missing (an earlier release's snapshot, or none), since
 * then no type change can be told.
 *
 * Written so that no write is judged against a type the column no longer
 * has: in the file's transaction where it runs in one, so the conversion and
 * the row commit together; otherwise right after its last statement and
 * before it is recorded. Any row that cannot be written fails the file
 * (`strict`). The run's end then finds these rows already matching.
 */
export function typeChangedRowsWriter(args: {
  from: Pick<SnapshotFile, "entities"> | null;
  to: Pick<SnapshotFile, "entities"> | null;
  file: string;
  deps: RegistryWriteDeps;
}): ((inFileTransaction: boolean) => Promise<void>) | undefined {
  const { from, to } = args;
  if (from === null || to === null) return undefined;
  if (!carriesRegistryMetadata(from) || !carriesRegistryMetadata(to)) {
    return undefined;
  }
  const only = typeChangedEntities(from.entities, to.entities);
  if (!anySlugs(only)) return undefined;
  const source = {
    kind: "snapshot" as const,
    file: args.file,
    entities: to.entities,
    // Judged against the record the file starts from, so a Builder setting
    // the file itself cleared is cleared with it.
    chain: [from.entities, to.entities],
  };
  // Told whether the file runs in a transaction, which the rows must then
  // join (`writesInFileTransaction`); false for one marked to run outside.
  return async (inFileTransaction: boolean) => {
    if (inFileTransaction) writesInFileTransaction(args.deps, args.file);
    await writeRegistryRows(
      args.deps.adapter,
      () => writeRegistryFromSource(source, args.deps, { only, strict: true }),
      { wrote: written => RECORDED_KINDS.some(([k]) => written.written[k] > 0) }
    );
  };
}

/**
 * Refuses, before anything is written, rows meant for a migration file's
 * transaction that would not join it. They are written through the adapter,
 * whose `transaction()` joins the transaction the calling flow is inside
 * (the file's, opened on the same adapter), so they commit or roll back
 * with the file's statements. A write that would open a transaction of its
 * own could commit while the file rolls back, which is the one outcome
 * writing the row with the file exists to prevent.
 */
export function writesInFileTransaction(
  deps: Pick<RegistryWriteDeps, "adapter">,
  file: string
): void {
  if (deps.adapter.inTransaction()) return;
  throw NextlyError.internal({
    logContext: {
      reason: "registry rows written outside their file's transaction",
      file,
    },
  });
}
