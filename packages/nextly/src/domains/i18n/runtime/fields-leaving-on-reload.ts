/**
 * Fields a config reload under `next dev` makes shared on an entity that stays translated, and
 * the move of their values, in the Schema Builder's order: the main column is added without the
 * field's Required or Unique setting, the other languages are archived and the default language's
 * value copied onto it, the setting is applied once the values can take it, and the translations
 * column is dropped last. Nothing asks in the terminal: a setting the values cannot take is
 * refused, naming the field, and otherwise the values carry it.
 *
 * A field leaves translation when the config now declares it shared, the registry recorded it
 * translated before this reload, and its translations column is still there. The registry is what
 * tells a field leaving from a column left behind, whose values are older than the main table's.
 *
 * @module domains/i18n/runtime/fields-leaving-on-reload
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DesiredSchema } from "../../schema/pipeline/types";
import { resolveLocalizedFieldNames } from "../classify-fields";
import { appLanguageOrder } from "../configured-locales";
import { companionUniqueIndexName } from "../migration/companion-unique-indexes";
import {
  type LeavingFieldLike,
  type LeavingTranslationRefusal,
  refusalsForFieldsLeavingTranslation,
  withoutLeavingConstraints,
} from "../migration/field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "../migration/field-to-column-spec";
import { copyLiveness } from "../migration/generate-down";
import {
  applyCompanionStatements,
  dropHeldLeavingFields,
} from "../migration/held-leaving-drops";
import { refusalsForConstrainedFieldsLeaving } from "../migration/leaving-constraint-preconditions";
import {
  buildCompanionTransitionStatements,
  type CompanionTransitionPlan,
} from "../migration/reconcile-companion";
import {
  readRecordedEntities,
  type RecordedEntity,
  recordedBeforeOf,
} from "../migration/recorded-before";
import type { I18nTransitionKind } from "../migration/transition-state";
import { storesPerLanguage } from "../per-language-storage";

import { companionColumnNames, liveCompanionShape } from "./companion-io";
import {
  localizableConfigEntities,
  type LocalizableEntity,
} from "./localizable-config-entities";

/** The reloaded config, as far as these fields go. */
type ReloadConfig = Parameters<typeof localizableConfigEntities>[0] & {
  localization?: { defaultLocale?: string };
};

/** One entity's fields leaving translation in a reload. */
export interface FieldsLeavingOnReload {
  kind: I18nTransitionKind;
  slug: string;
  tableName: string;
  status: boolean;
  /** The entity's fields as the config declares them now. */
  newFields: readonly LeavingFieldLike[];
  /** The same fields before the reload: those leaving translation as the registry recorded them. */
  oldFields: readonly LeavingFieldLike[];
  leaving: ReadonlySet<string>;
  /**
   * The unique indexes in the entity's `indexes` that cover a field of `leaving`, by their fields.
   * Held back from the first apply and created by the settings push once the values are copied.
   */
  uniqueIndexes: readonly (readonly string[])[];
  /**
   * Those of `leaving` a one-column unique index covers, so each must be unique on its own
   * (`uniqueIndexes`). One in a wider index is unique only together with its other columns, which
   * the database judges when the push creates it.
   */
  uniqueIndexed: ReadonlySet<string>;
}

/**
 * Before the reload's gate and apply: the fields leaving translation (`fieldsLeavingOnReload`), and
 * the entities refused (`leavingRefusalsOnReload`), each refusal reported with what to do. A reload
 * with any refused applies nothing, so a refusal changes nothing.
 *
 * Rejects when it can't tell: a registry that can't be read, or a database read that fails. The
 * reload then applies nothing, since applied without the move, a field becoming shared would get
 * its main column empty while its values stayed in the translations column.
 */
export async function prepareFieldsLeavingOnReload(
  adapter: DrizzleAdapter,
  config: ReloadConfig,
  fieldGroupTables: ReadonlyMap<string, string>,
  report: (message: string) => void
): Promise<{ entries: FieldsLeavingOnReload[]; refused: string[] }> {
  const recorded = await readRecordedEntities(adapter, config, error => {
    report(
      `[nextly] The registry could not be read, so the fields leaving translation can't be told: ${error instanceof Error ? error.message : String(error)}`
    );
    throw new NextlyError({
      code: "DATABASE_ERROR",
      publicMessage: "The registry could not be read.",
      cause: error instanceof Error ? error : undefined,
    });
  });
  const entries: FieldsLeavingOnReload[] = [];
  const renamed: { slug: string; message: string }[] = [];
  for (const [kind, entities, tableNameOf] of localizableConfigEntities(
    config
  )) {
    for (const entity of entities) {
      const target = reloadTarget(kind, entity, tableNameOf, fieldGroupTables);
      if (!target) continue;
      const before = recordedBeforeOf(recorded, kind, target.slug);
      const refusal = await renamedWhileLeaving(adapter, target, before);
      if (refusal) {
        renamed.push(refusal);
        continue;
      }
      const entry = await leavingIn(adapter, target, before);
      if (entry) entries.push(entry);
    }
  }
  const refusals = [
    ...renamed,
    ...(await leavingRefusalsOnReload(
      adapter,
      entries,
      defaultLocaleOf(config)
    )),
  ];
  for (const r of refusals) report(r.message);
  return { entries, refused: [...new Set(refusals.map(r => r.slug))] };
}

/** The language a field leaving translation keeps as its shared value. */
function defaultLocaleOf(config: ReloadConfig): string {
  return config.localization?.defaultLocale ?? "en";
}

/** One entity the config keeps translated, at its table, or `undefined` for any other. */
interface ReloadTarget {
  kind: I18nTransitionKind;
  slug: string;
  tableName: string;
  entity: LocalizableEntity;
}

/** A field group's table is the one stored for it, which the reload resolved already. */
function reloadTarget(
  kind: I18nTransitionKind,
  entity: LocalizableEntity,
  tableNameOf: (e: LocalizableEntity) => string,
  fieldGroupTables: ReadonlyMap<string, string>
): ReloadTarget | undefined {
  const slug = entity.slug;
  // Kept per language when translated, or for every entity under `experimental.perLanguageStorage`:
  // either way a field made shared leaves its per-language table.
  if (slug === undefined || !storesPerLanguage(entity)) return undefined;
  const stored = kind === "fieldGroup" ? fieldGroupTables.get(slug) : undefined;
  return { kind, slug, tableName: stored ?? tableNameOf(entity), entity };
}

/**
 * The refusal of a field translated before this reload that the config renames and makes shared in
 * the same edit. The move finds fields leaving translation by name, so the renamed one is not among
 * them, and its values would stay in a translations column nothing reads. Found by the main table's
 * own rename rule (`detectFieldRename`) where it can pair the two names; where it can't (another
 * field added or removed beside it, or its type changed too), any translated field gone while
 * shared fields appear is refused the same way (`goneWhileSharedAppear`). Undefined for any other
 * edit.
 */
async function renamedWhileLeaving(
  adapter: DrizzleAdapter,
  e: ReloadTarget,
  before: RecordedEntity | null | undefined
): Promise<{ slug: string; message: string } | undefined> {
  if (before?.localized !== true) return undefined;
  const fields: readonly LeavingFieldLike[] = e.entity.fields ?? [];
  const { DynamicCollectionSchemaService } = await import(
    "../../dynamic-collections/services/dynamic-collection-schema-service"
  );
  const detected = new DynamicCollectionSchemaService(
    undefined,
    adapter.getCapabilities().dialect
  ).detectFieldRename(
    before.fields as unknown as FieldDefinition[],
    fields as unknown as FieldDefinition[]
  );
  if (!detected) return goneWhileSharedAppear(e, before, fields, adapter);
  const translatedBefore = new Set(
    resolveLocalizedFieldNames([...before.fields], true)
  );
  const translatedNow = new Set(resolveLocalizedFieldNames([...fields], true));
  if (
    !translatedBefore.has(detected.from.name) ||
    translatedNow.has(detected.to.name)
  ) {
    return undefined;
  }
  return {
    slug: e.slug,
    message:
      `[nextly] "${e.slug}": \`${detected.from.name}\` is renamed to \`${detected.to.name}\` and made ` +
      "shared in one edit, which would leave its values in the translations table. Rename the " +
      "field first, then mark it shared, in two reloads.",
  };
}

/**
 * The refusal of an edit in which a field translated before this reload is gone by name while
 * shared fields that store a column appear, when no rename pair can be chosen between them. Either
 * one of them is the translated field renamed, whose values would stay in the translations table,
 * or a field was removed and others added in one edit; both are refused alike, since the reload
 * cannot tell them apart. Undefined when either side is empty.
 */
function goneWhileSharedAppear(
  e: ReloadTarget,
  before: RecordedEntity,
  fields: readonly LeavingFieldLike[],
  adapter: DrizzleAdapter
): { slug: string; message: string } | undefined {
  const dialect = adapter.getCapabilities().dialect;
  const stores = (f: LeavingFieldLike) => {
    const column = fieldToLocalizedColumnSpec(f, dialect, "codeFirst");
    return column !== null && column !== undefined;
  };
  const namesNow = new Set(fields.map(f => f.name));
  const namesBefore = new Set(before.fields.map(f => f.name));
  const translatedBefore = new Set(
    resolveLocalizedFieldNames([...before.fields], true)
  );
  const translatedNow = new Set(resolveLocalizedFieldNames([...fields], true));
  const gone = before.fields
    .filter(f => translatedBefore.has(f.name) && !namesNow.has(f.name))
    .filter(stores)
    .map(f => `\`${f.name}\``);
  const appeared = fields
    .filter(f => !namesBefore.has(f.name) && !translatedNow.has(f.name))
    .filter(stores)
    .map(f => `\`${f.name}\``);
  if (gone.length === 0 || appeared.length === 0) return undefined;
  return {
    slug: e.slug,
    message:
      `[nextly] "${e.slug}": the translated ${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} ` +
      `gone while the shared ${appeared.join(", ")} ${appeared.length === 1 ? "appears" : "appear"} ` +
      "in one edit. A translated field renamed and made shared at " +
      "once would leave its values in the translations table. Rename the field first, then mark it " +
      "shared, in two reloads (or, to remove one field and add another, save each change on its own).",
  };
}

/**
 * One entity's fields leaving translation, or `undefined` when none is: shared in the config,
 * translated in the registry's record before this reload, and with a translations column still.
 * Nothing leaves for an entity the registry did not record as translated: its translations columns
 * are left as they are.
 */
async function leavingIn(
  adapter: DrizzleAdapter,
  e: ReloadTarget,
  before: RecordedEntity | null | undefined
): Promise<FieldsLeavingOnReload | undefined> {
  if (before?.localized !== true) return undefined;
  if (!(await adapter.tableExists(`${e.tableName}_locales`))) return undefined;
  const live = new Set(await companionColumnNames(adapter, e.tableName));
  const fields: readonly LeavingFieldLike[] = e.entity.fields ?? [];
  const translatedNow = new Set(resolveLocalizedFieldNames([...fields], true));
  const translatedBefore = new Set(
    resolveLocalizedFieldNames([...before.fields], true)
  );
  const recordedField = new Map(before.fields.map(f => [f.name, f]));
  const dialect = adapter.getCapabilities().dialect;
  const leaving = new Set(
    fields
      .filter(f => !translatedNow.has(f.name) && translatedBefore.has(f.name))
      .filter(f => {
        // The column the field had while it was translated, as the registry describes it.
        const old = recordedField.get(f.name);
        const column =
          old && fieldToLocalizedColumnSpec(old, dialect, "codeFirst");
        return column !== null && column !== undefined && live.has(column.name);
      })
      .map(f => f.name)
  );
  if (leaving.size === 0) return undefined;
  return {
    kind: e.kind,
    slug: e.slug,
    tableName: e.tableName,
    status: e.entity.status === true,
    newFields: fields,
    oldFields: fields.map(f =>
      leaving.has(f.name)
        ? { ...(recordedField.get(f.name) ?? f), localized: true }
        : f
    ),
    leaving,
    ...uniqueIndexesOf(e.entity, leaving),
  };
}

/** The unique indexes the entity declares in `indexes` over a field of `leaving` (see the entry). */
function uniqueIndexesOf(
  entity: LocalizableEntity,
  leaving: ReadonlySet<string>
): Pick<FieldsLeavingOnReload, "uniqueIndexes" | "uniqueIndexed"> {
  const { indexes } = entity as {
    indexes?: readonly { fields: readonly string[]; unique?: boolean }[];
  };
  const uniqueIndexes = (indexes ?? [])
    .filter(index => index.unique === true)
    .map(index => index.fields)
    .filter(fields => fields.some(field => leaving.has(field)));
  return {
    uniqueIndexes,
    uniqueIndexed: new Set(
      uniqueIndexes.flatMap(fields => (fields.length === 1 ? fields : []))
    ),
  };
}

/**
 * The entities the reload stops for before anything changes: those refused
 * (`prepareFieldsLeavingOnReload`), and those with fields leaving translation that the reload's
 * gate leaves for review (`deferred`), each reported. Applied without them, the rest would publish
 * the fields as shared while their values stayed in the translations table.
 */
export function stoppedBeforeApply(
  leaving: {
    entries: readonly FieldsLeavingOnReload[];
    refused: readonly string[];
  },
  deferred: ReadonlySet<string>,
  report: (message: string) => void
): string[] {
  const waiting = leaving.entries.filter(e =>
    deferred.has(`${e.kind}:${e.slug}`)
  );
  for (const e of waiting) {
    report(
      `[nextly] "${e.slug}": its fields leaving translation (${[...e.leaving].join(", ")}) are not moved ` +
        "while another change to it needs review. Save that change on its own first, then this one."
    );
  }
  return [...new Set([...leaving.refused, ...waiting.map(e => e.slug)])];
}

/** What the reload says to do about each kind of refusal of a field leaving translation. */
const FIX_OF: Partial<
  Record<LeavingTranslationRefusal["code"], (field: string) => string>
> = {
  REQUIRED_FIELD_LEAVES_WITHOUT_VALUES: field =>
    `Give those entries their own values, or remove \`required\` from ${field}, and save the config again.`,
  UNIQUE_FIELD_LEAVES_OVER_DUPLICATES: field =>
    `Give those entries their own values, or remove \`unique\` from ${field}, and save the config again.`,
  RESHAPED_FIELD_LEAVES_TRANSLATION: field =>
    `Make ${field} shared in one save, and change how it is stored in another.`,
};

/**
 * Why the reload can't move these fields: a field whose storage changes as it leaves
 * (`refusalsForFieldsLeavingTranslation`), and a Required or Unique setting its default language's
 * values cannot take (`refusalsForConstrainedFieldsLeaving`), each with what to do. Empty when the
 * move can go ahead. Asked before the apply, and again right before the settings, for an entry
 * written in between.
 */
async function leavingRefusalsOnReload(
  adapter: DrizzleAdapter,
  entries: readonly FieldsLeavingOnReload[],
  defaultLocale: string
): Promise<{ slug: string; message: string }[]> {
  const dialect = adapter.getCapabilities().dialect;
  const said: { slug: string; message: string }[] = [];
  for (const e of entries) {
    const judged = {
      leaving: e.leaving,
      oldFields: e.oldFields,
      newFields: e.newFields,
      dialect,
      builtBy: "codeFirst" as const,
      surface: "code" as const,
    };
    const refusals = [
      ...refusalsForFieldsLeavingTranslation(judged),
      ...(await refusalsForConstrainedFieldsLeaving({
        ...judged,
        adapter,
        tableName: e.tableName,
        defaultLocale,
        // The values the move keeps: a translated Draft/Published entity's translations table
        // holds each language's own state.
        liveness: copyLiveness(appLanguageOrder(), e.status),
        uniqueIndexed: e.uniqueIndexed,
      })),
    ];
    for (const r of refusals) {
      const field = r.path.replace(/^fields\./, "");
      const fix =
        FIX_OF[r.code]?.(field) ?? "Change it back, and save the config again.";
      said.push({
        slug: e.slug,
        message: `[nextly] "${e.slug}": ${r.message} ${fix}`,
      });
    }
  }
  return said;
}

/** `fields` with the leaving fields of `kind` `slug` made optional and not unique, if any. */
export function heldFields<F>(
  entries: readonly FieldsLeavingOnReload[],
  kind: I18nTransitionKind,
  slug: string,
  fields: F[]
): F[] {
  const entry = entries.find(e => e.kind === kind && e.slug === slug);
  if (!entry) return fields;
  // Only fields that carry a name can leave translation, and those are what it reads.
  return withoutLeavingConstraints(
    fields as unknown as LeavingFieldLike[],
    entry.leaving
  ) as unknown as F[];
}

/**
 * `desired` with each leaving field's Required and Unique held back (`heldFields`), the schema the
 * reload applies first: its main column is added nullable and not unique, so the apply asks nothing
 * about the rows it has no value for yet.
 */
export function withLeavingSettingsHeld(
  desired: DesiredSchema,
  entries: readonly FieldsLeavingOnReload[]
): DesiredSchema {
  const held = <E extends { slug: string; fields: unknown[] }>(
    kind: I18nTransitionKind,
    byKind: Record<string, E>
  ): Record<string, E> =>
    Object.fromEntries(
      Object.entries(byKind).map(([key, entity]) => [
        key,
        { ...entity, fields: heldFields(entries, kind, key, entity.fields) },
      ])
    );
  return {
    collections: withoutLeavingIndexes(
      held("collection", desired.collections),
      entries
    ),
    singles: held("single", desired.singles),
    components: held("fieldGroup", desired.components),
  };
}

/**
 * `collections` without the unique indexes that cover a field leaving translation
 * (`uniqueIndexes`), which the settings push creates once the values are copied, as it applies a
 * field's own Unique.
 */
function withoutLeavingIndexes(
  collections: DesiredSchema["collections"],
  entries: readonly FieldsLeavingOnReload[]
): DesiredSchema["collections"] {
  return Object.fromEntries(
    Object.entries(collections).map(([key, collection]) => {
      const entry = entries.find(
        e => e.kind === "collection" && e.slug === key
      );
      const indexes = collection.indexes?.filter(
        index =>
          index.unique !== true ||
          !index.fields.some(field => entry?.leaving.has(field))
      );
      return [key, indexes ? { ...collection, indexes } : collection];
    })
  );
}

/**
 * After the apply: moves the leaving fields of every entity the reload applied, in phases across
 * them all, so no entity's step runs ahead of another's:
 *
 * 1. every entity's other languages archived and default language copied onto main;
 * 2. every entity asked again whether its values can take its settings, then ONE `push` of the
 *    config's schema whole, which applies every leaving field's Required and Unique at once;
 * 3. every entity's translations columns dropped, each with its last archive and copy, in one
 *    transaction on PostgreSQL and SQLite (`dropHeldLeavingFields`).
 *
 * Returns the entities whose move did not finish, each reported; a reload with any publishes
 * nothing, so reads keep going through the translations tables. Before the drops, a stop leaves
 * every entity's translations column in place. A drop that fails leaves the entities dropped before
 * it moved and the rest not, which the next save finishes. Nothing moves when `blockedBy` names an
 * entity the reload already stopped for, and an entity in `deferred` is not moved, as its change is
 * not applied.
 */
export async function moveFieldsLeavingOnReload(args: {
  adapter: DrizzleAdapter;
  entries: readonly FieldsLeavingOnReload[];
  deferred: ReadonlySet<string>;
  config: ReloadConfig;
  blockedBy: readonly string[];
  push: () => Promise<{ success: boolean }>;
  report: (message: string) => void;
}): Promise<string[]> {
  const entries = args.entries.filter(
    e => !args.deferred.has(`${e.kind}:${e.slug}`)
  );
  if (args.blockedBy.length > 0 || entries.length === 0) return [];
  const defaultLocale = defaultLocaleOf(args.config);
  const all = entries.map(e => e.slug);
  // Each phase reports its own failures; anything else that rejects, such as the re-check's reads,
  // stops the move the same way, before any drop it has not reached.
  try {
    const planned = await copyEveryEntity(args, entries, defaultLocale);
    if (planned === undefined) return all;
    if (!(await settleEveryEntity(args, entries, defaultLocale))) return all;
    return await dropEveryEntity(args, planned);
  } catch (error) {
    args.report(notMoved(all.join(", "), error));
    return all;
  }
}

type Mover = Pick<
  Parameters<typeof moveFieldsLeavingOnReload>[0],
  "adapter" | "push" | "report"
>;

/** Phase 1: each entity's archive and copy. `undefined`, reported, when one fails. */
async function copyEveryEntity(
  args: Mover,
  entries: readonly FieldsLeavingOnReload[],
  defaultLocale: string
): Promise<
  { e: FieldsLeavingOnReload; plan: CompanionTransitionPlan }[] | undefined
> {
  const planned: { e: FieldsLeavingOnReload; plan: CompanionTransitionPlan }[] =
    [];
  for (const e of entries) {
    try {
      const plan = await planLeavingMove(args.adapter, e, defaultLocale);
      await applyCompanionStatements(args.adapter, plan);
      planned.push({ e, plan });
    } catch (error) {
      args.report(notMoved(e.slug, error));
      return undefined;
    }
  }
  return planned;
}

/**
 * Phase 2: every entity's refusals asked again, then one push of the whole config when a leaving
 * field has a setting to apply. False, reported, when either stops the move.
 */
async function settleEveryEntity(
  args: Mover,
  entries: readonly FieldsLeavingOnReload[],
  defaultLocale: string
): Promise<boolean> {
  const refusals = await leavingRefusalsOnReload(
    args.adapter,
    entries,
    defaultLocale
  );
  for (const r of refusals) args.report(r.message);
  if (refusals.length > 0) return false;
  const settings = entries.some(e => {
    const held = withoutLeavingConstraints(e.newFields, e.leaving);
    return (
      e.uniqueIndexes.length > 0 || held.some((f, i) => f !== e.newFields[i])
    );
  });
  if (!settings || (await args.push()).success) return true;
  args.report(
    "[nextly] The Required and Unique settings of the fields leaving translation were not applied; " +
      "their translations columns are kept. Fix the error above and save again."
  );
  return false;
}

/** Phase 3: each entity's held drops. The entities whose drops failed, each reported. */
async function dropEveryEntity(
  args: Mover,
  planned: readonly {
    e: FieldsLeavingOnReload;
    plan: CompanionTransitionPlan;
  }[]
): Promise<string[]> {
  const stopped: string[] = [];
  for (const { e, plan } of planned) {
    try {
      await dropHeldLeavingFields(args.adapter, plan, e.kind);
    } catch (error) {
      stopped.push(e.slug);
      args.report(notMoved(e.slug, error));
    }
  }
  return stopped;
}

/**
 * What a reload says when the translated content of `stopped` stays where it is: after an apply
 * it publishes nothing, so the running server keeps each entity's fields as they were until it is
 * reloaded, by a restart or a save that finishes the change.
 */
export function translationStaysOn(stopped: readonly string[]): string {
  return (
    `[nextly] Translation stays on for ${stopped.join(", ")}: their content could not be ` +
    `copied out of the translations table, and the content is intact where it is. Fix the error ` +
    `above. Restart the dev server (or save the collection again) to reload its fields.`
  );
}

function notMoved(slug: string, error: unknown): string {
  return (
    `[nextly] The fields leaving translation in "${slug}" were not moved: ` +
    `${error instanceof Error ? error.message : String(error)}`
  );
}

/**
 * One entity's move as the Schema Builder plans it (`buildCompanionTransitionStatements`, holding
 * the drops), read against its translations table as it is.
 */
async function planLeavingMove(
  adapter: DrizzleAdapter,
  e: FieldsLeavingOnReload,
  defaultLocale: string
): Promise<CompanionTransitionPlan> {
  const shape = await liveCompanionShape(adapter, {
    tableName: e.tableName,
    oldFields: e.oldFields,
    newFields: e.newFields,
    builtBy: "codeFirst",
    companionExists: true,
  });
  const dialect = adapter.getCapabilities().dialect;
  return buildCompanionTransitionStatements({
    builtBy: "codeFirst",
    slug: e.slug,
    kind: e.kind,
    tableName: e.tableName,
    dialect,
    defaultLocale,
    languageOrder: appLanguageOrder(),
    status: e.status,
    wasStatus: e.status,
    wasLocalized: true,
    isLocalized: true,
    oldFields: uniqueAsIndexed(e, shape.liveCompanionIndexes ?? [], dialect),
    newFields: [...e.newFields],
    companionExists: true,
    holdLeavingDrops: true,
    ...shape,
  });
}

/**
 * `e.oldFields` with each leaving field Unique only where its translations table has the field's
 * per-language unique index. Read as the registry records it, the move would first build an index
 * a reconcile held back, over values it never held unique, and stop there.
 */
function uniqueAsIndexed(
  e: FieldsLeavingOnReload,
  liveIndexes: readonly string[],
  dialect: ReturnType<DrizzleAdapter["getCapabilities"]>["dialect"]
): LeavingFieldLike[] {
  const indexed = new Set(liveIndexes);
  return e.oldFields.map(f => {
    if (!e.leaving.has(f.name)) return f;
    const column = fieldToLocalizedColumnSpec(f, dialect, "codeFirst");
    const unique =
      column !== null &&
      indexed.has(
        companionUniqueIndexName(`${e.tableName}_locales`, column.name)
      );
    return { ...f, unique };
  });
}
