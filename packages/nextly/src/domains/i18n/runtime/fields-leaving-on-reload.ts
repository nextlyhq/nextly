/**
 * Fields a config reload under `next dev` makes shared on an entity that stays translated, and
 * the move of their values, in the Schema Builder's order: the main column is added without the
 * field's Required or Unique setting, the other languages are archived and the default language's
 * value copied onto it, the setting is applied once the values can take it, and the translations
 * column is dropped last (`applyCompanionTransition`). Nothing asks in the terminal: a setting the
 * values cannot take is refused, naming the field, and otherwise the values carry it.
 *
 * Read from the live database rather than the registry: a translations column whose field the
 * config now declares shared is a field leaving translation, whatever an earlier reload recorded.
 *
 * @module domains/i18n/runtime/fields-leaving-on-reload
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import type { DesiredSchema } from "../../schema/pipeline/types";
import { resolveLocalizedFieldNames } from "../classify-fields";
import { companionUniqueIndexName } from "../migration/companion-unique-indexes";
import {
  type LeavingFieldLike,
  type LeavingTranslationRefusal,
  withoutLeavingConstraints,
} from "../migration/field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "../migration/field-to-column-spec";
import { applyCompanionTransition } from "../migration/held-leaving-drops";
import { refusalsForConstrainedFieldsLeaving } from "../migration/leaving-constraint-preconditions";
import { buildCompanionTransitionStatements } from "../migration/reconcile-companion";
import type { I18nTransitionKind } from "../migration/transition-state";

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
  /** The same fields before the reload: those leaving translation still translated. */
  oldFields: readonly LeavingFieldLike[];
  leaving: ReadonlySet<string>;
}

/**
 * Before the apply: the fields leaving translation (`fieldsLeavingOnReload`), and the entities
 * whose Required or Unique setting their default language's values cannot take, each reported
 * with what to do. A reload that has any applies nothing, so a refusal changes nothing.
 */
export async function prepareFieldsLeavingOnReload(
  adapter: DrizzleAdapter,
  config: ReloadConfig,
  fieldGroupTables: ReadonlyMap<string, string>,
  deferred: ReadonlySet<string>,
  report: (message: string) => void
): Promise<{ entries: FieldsLeavingOnReload[]; refused: string[] }> {
  const entries = await fieldsLeavingOnReload(
    adapter,
    config,
    fieldGroupTables,
    deferred
  );
  const refusals = await leavingRefusalsOnReload(
    adapter,
    entries,
    defaultLocaleOf(config)
  );
  for (const r of refusals) report(r.message);
  return { entries, refused: [...new Set(refusals.map(r => r.slug))] };
}

/** The language a field leaving translation keeps as its shared value. */
function defaultLocaleOf(config: ReloadConfig): string {
  return config.localization?.defaultLocale ?? "en";
}

/**
 * Each entity the config keeps translated whose translations table still has a column for a field
 * the config now declares shared. `fieldGroupTables` is each field group's stored table, which the
 * reload resolved already; `deferred` names the entities (`<kind>:<slug>`) whose change this
 * reload does not apply.
 */
async function fieldsLeavingOnReload(
  adapter: DrizzleAdapter,
  config: ReloadConfig,
  fieldGroupTables: ReadonlyMap<string, string>,
  deferred: ReadonlySet<string>
): Promise<FieldsLeavingOnReload[]> {
  const found: FieldsLeavingOnReload[] = [];
  for (const [kind, entities, tableNameOf] of localizableConfigEntities(
    config
  )) {
    for (const entity of entities) {
      const slug = entity.slug;
      if (slug === undefined || entity.localized !== true) continue;
      if (deferred.has(`${kind}:${slug}`)) continue;
      const tableName =
        (kind === "fieldGroup" ? fieldGroupTables.get(slug) : undefined) ??
        tableNameOf(entity);
      const entry = await leavingIn(adapter, { kind, slug, tableName, entity });
      if (entry) found.push(entry);
    }
  }
  return found;
}

/** One entity's fields leaving translation, or `undefined` when none is. */
async function leavingIn(
  adapter: DrizzleAdapter,
  e: {
    kind: I18nTransitionKind;
    slug: string;
    tableName: string;
    entity: LocalizableEntity;
  }
): Promise<FieldsLeavingOnReload | undefined> {
  if (!(await adapter.tableExists(`${e.tableName}_locales`))) return undefined;
  const live = new Set(await companionColumnNames(adapter, e.tableName));
  const fields: readonly LeavingFieldLike[] = e.entity.fields ?? [];
  const translated = new Set(resolveLocalizedFieldNames([...fields], true));
  const dialect = adapter.getCapabilities().dialect;
  const leaving = new Set(
    fields
      .filter(f => !translated.has(f.name))
      .filter(f => {
        // The column the field had while it was translated.
        const column = fieldToLocalizedColumnSpec(
          { ...f, localized: true },
          dialect,
          "codeFirst"
        );
        return column !== null && live.has(column.name);
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
      leaving.has(f.name) ? { ...f, localized: true } : f
    ),
    leaving,
  };
}

/** The setting each refusal of a leaving field is about, for what the reload says to do. */
const SETTING_OF: Partial<Record<LeavingTranslationRefusal["code"], string>> = {
  REQUIRED_FIELD_LEAVES_WITHOUT_VALUES: "required",
  UNIQUE_FIELD_LEAVES_OVER_DUPLICATES: "unique",
};

/**
 * Why the reload can't move these fields: each Required or Unique setting their default language's
 * values cannot take (`refusalsForConstrainedFieldsLeaving`), with what to do. Empty when every
 * setting holds. Asked before the apply, so a refused reload changes nothing, and again right
 * before the settings are applied, for an entry written in between.
 */
async function leavingRefusalsOnReload(
  adapter: DrizzleAdapter,
  entries: readonly FieldsLeavingOnReload[],
  defaultLocale: string
): Promise<{ slug: string; message: string }[]> {
  const said: { slug: string; message: string }[] = [];
  for (const e of entries) {
    const refusals = await refusalsForConstrainedFieldsLeaving({
      adapter,
      dialect: adapter.getCapabilities().dialect,
      tableName: e.tableName,
      builtBy: "codeFirst",
      defaultLocale,
      leaving: e.leaving,
      oldFields: e.oldFields,
      newFields: e.newFields,
      surface: "code",
    });
    for (const r of refusals) {
      const field = r.path.replace(/^fields\./, "");
      const setting = SETTING_OF[r.code];
      const fix =
        setting === undefined
          ? "Change it back, and save the config again."
          : `Give those entries their own values, or remove \`${setting}\` from ${field}, and save the config again.`;
      said.push({
        slug: e.slug,
        message: `[nextly] "${e.slug}": ${r.message} ${fix}`,
      });
    }
  }
  return said;
}

/**
 * `desired` with each leaving field's Required and Unique held back (`withoutLeavingConstraints`),
 * the schema the reload applies first: its main column is added nullable and not unique, so the
 * apply asks nothing about the rows it has no value for yet.
 */
export function withLeavingSettingsHeld(
  desired: DesiredSchema,
  entries: readonly FieldsLeavingOnReload[]
): DesiredSchema {
  if (entries.length === 0) return desired;
  const held = <E extends { slug: string; fields: unknown[] }>(
    kind: I18nTransitionKind,
    byKind: Record<string, E>
  ): Record<string, E> =>
    Object.fromEntries(
      Object.entries(byKind).map(([key, entity]) => {
        const entry = entries.find(e => e.kind === kind && e.slug === key);
        if (!entry) return [key, entity];
        // Only fields that carry a name can leave translation, and those are what it reads.
        const fields = withoutLeavingConstraints(
          entity.fields as LeavingFieldLike[],
          entry.leaving
        );
        return [key, { ...entity, fields }];
      })
    );
  return {
    collections: held("collection", desired.collections),
    singles: held("single", desired.singles),
    components: held("fieldGroup", desired.components),
  };
}

/**
 * After the apply: moves each entity's leaving fields, the other languages archived, the default
 * language's values copied onto main, the settings applied by `push` (the config's schema whole)
 * once the values can still take them, and the translations columns dropped
 * (`applyCompanionTransition`, as a Schema Builder save runs it). The drops, with each column's last
 * archive and copy, run in one transaction on PostgreSQL and SQLite.
 *
 * Returns the entities whose move did not finish, each reported; a reload with any publishes
 * nothing, so reads keep going through the translations tables, which still hold every language.
 * Nothing moves when `blockedBy` names an entity the reload already stopped for, or when any
 * entity's settings are refused now (an entry written since the check before the apply): a move
 * that landed beside an unpublished config would leave its reads on a column it dropped.
 */
export async function moveFieldsLeavingOnReload(args: {
  adapter: DrizzleAdapter;
  entries: readonly FieldsLeavingOnReload[];
  config: ReloadConfig;
  blockedBy: readonly string[];
  push: () => Promise<{ success: boolean }>;
  report: (message: string) => void;
}): Promise<string[]> {
  if (args.blockedBy.length > 0) return [];
  const defaultLocale = defaultLocaleOf(args.config);
  const refusals = await leavingRefusalsOnReload(
    args.adapter,
    args.entries,
    defaultLocale
  );
  for (const r of refusals) args.report(r.message);
  if (refusals.length > 0) return [...new Set(refusals.map(r => r.slug))];
  const stopped: string[] = [];
  for (const e of args.entries) {
    try {
      await moveLeavingFields(args.adapter, e, defaultLocale, args.push);
    } catch (error) {
      stopped.push(e.slug);
      args.report(
        `[nextly] The fields leaving translation in "${e.slug}" were not moved: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return stopped;
}

/**
 * `e.oldFields` with each leaving field Unique only where its translations table has the field's
 * per-language unique index. The setting the config gives it now is the one it gains as a shared
 * field; read as its old one, the move would first build that index over values it never held
 * unique, and the move would stop there.
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

async function moveLeavingFields(
  adapter: DrizzleAdapter,
  e: FieldsLeavingOnReload,
  defaultLocale: string,
  push: () => Promise<{ success: boolean }>
): Promise<void> {
  const shape = await liveCompanionShape(adapter, {
    tableName: e.tableName,
    oldFields: e.oldFields,
    newFields: e.newFields,
    builtBy: "codeFirst",
    companionExists: true,
  });
  const dialect = adapter.getCapabilities().dialect;
  const plan = buildCompanionTransitionStatements({
    builtBy: "codeFirst",
    slug: e.slug,
    kind: e.kind,
    tableName: e.tableName,
    dialect,
    defaultLocale,
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
  // Held back in the first push only when a leaving field has a setting to hold.
  const held = withoutLeavingConstraints(e.newFields, e.leaving);
  const settings = held.some((f, i) => f !== e.newFields[i]);
  await applyCompanionTransition({
    adapter,
    plan,
    kind: e.kind,
    slug: e.slug,
    tableName: e.tableName,
    settleLeaving: async () => {
      if (!settings) return;
      const refused = await leavingRefusalsOnReload(
        adapter,
        [e],
        defaultLocale
      );
      if (refused.length > 0) {
        throw new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: refused.map(r => r.message).join(" "),
          logContext: { entity: e.slug, fields: [...e.leaving] },
        });
      }
      if (!(await push()).success) {
        throw new NextlyError({
          code: "NEXTLY_MIGRATION_APPLY_FAILED",
          publicMessage: `The Required or Unique settings of ${[...e.leaving].join(", ")} were not applied.`,
          logContext: { op: "leavingFieldSettings", entity: e.slug },
        });
      }
    },
  });
}
