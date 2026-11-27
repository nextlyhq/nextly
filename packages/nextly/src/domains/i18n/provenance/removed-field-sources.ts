/**
 * Removing the source text kept for a field that is gone or no longer translated, and moving it
 * for one that is renamed.
 *
 * The text is content, so it goes with the field it is content of: what a translation was made
 * from is never left to be found under a field added later by the same name.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/removed-field-sources
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray } from "drizzle-orm";

import type { ProvenanceScopeKind } from "../../../schemas/translation-provenance";
import {
  TRANSLATION_SOURCES_TABLE,
  translationSourcesTables,
} from "../../../schemas/translation-sources";
import type { Logger } from "../../../shared/types";
import { storesPerLanguage } from "../per-language-storage";
import {
  hasTranslationColumn,
  type StructuredField,
} from "../shared-structure";

import { fieldOfPath } from "./source-text";

/** The adapter surface the removals need. */
export interface SourcesAdapter {
  dialect: SupportedDialect;
  tableExists(table: string): Promise<boolean>;
  getDrizzle<T = unknown>(): T;
}

/** The slice of Drizzle the removals drive. */
interface SourcesDb {
  selectDistinct(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Record<string, unknown>[]>;
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/** One collection or Single. */
export interface SourcesScope {
  scopeKind: ProvenanceScopeKind;
  scopeSlug: string;
}

/** The fields of an entity that keep translations, by name: those source text is kept for. */
export function translatedFieldNames(
  fields: readonly (StructuredField & { name?: string })[],
  localized: boolean
): Set<string> {
  return new Set(
    fields.flatMap(field =>
      field.name !== undefined &&
      hasTranslationColumn({ ...field, name: field.name }, localized)
        ? [field.name]
        : []
    )
  );
}

/** The paths of `scope`'s kept text whose field `gone` says is gone. */
async function pathsGone(
  adapter: SourcesAdapter,
  scope: SourcesScope,
  gone: (field: string) => boolean
): Promise<string[]> {
  const { nextlyTranslationSources: table } = translationSourcesTables(
    adapter.dialect
  );
  const rows = await adapter
    .getDrizzle<SourcesDb>()
    .selectDistinct({ fieldPath: table.fieldPath })
    .from(table)
    .where(
      and(
        eq(table.scopeKind, scope.scopeKind),
        eq(table.scopeSlug, scope.scopeSlug)
      )
    );
  return rows
    .map(row => String(row.fieldPath))
    .filter(path => gone(fieldOfPath(path)));
}

/** Removes `scope`'s kept text of each field `gone` says is gone. */
export async function removeFieldSources(
  adapter: SourcesAdapter,
  scope: SourcesScope,
  gone: (field: string) => boolean
): Promise<void> {
  if (!(await adapter.tableExists(TRANSLATION_SOURCES_TABLE))) return;
  const paths = await pathsGone(adapter, scope, gone);
  if (paths.length === 0) return;
  const { nextlyTranslationSources: table } = translationSourcesTables(
    adapter.dialect
  );
  await adapter
    .getDrizzle<SourcesDb>()
    .delete(table)
    .where(
      and(
        eq(table.scopeKind, scope.scopeKind),
        eq(table.scopeSlug, scope.scopeSlug),
        inArray(table.fieldPath, paths)
      )
    );
}

/**
 * Moves `scope`'s kept text of a renamed field to its new name. Text an earlier field left under
 * that name goes first: it is another field's content, and would stand in the moved rows' place.
 */
export async function renameFieldSources(
  adapter: SourcesAdapter,
  scope: SourcesScope,
  rename: { from: string; to: string }
): Promise<void> {
  if (rename.from === rename.to) return;
  if (!(await adapter.tableExists(TRANSLATION_SOURCES_TABLE))) return;
  const moving = await pathsGone(
    adapter,
    scope,
    field => field === rename.from
  );
  // Asked again after it moved, there is nothing left to move, and what it moved stays.
  if (moving.length === 0) return;
  await removeFieldSources(adapter, scope, field => field === rename.to);
  const { nextlyTranslationSources: table } = translationSourcesTables(
    adapter.dialect
  );
  const db = adapter.getDrizzle<SourcesDb>();
  for (const path of moving) {
    await db
      .update(table)
      .set({ fieldPath: `${rename.to}${path.slice(rename.from.length)}` })
      .where(
        and(
          eq(table.scopeKind, scope.scopeKind),
          eq(table.scopeSlug, scope.scopeSlug),
          eq(table.fieldPath, path)
        )
      );
  }
}

/**
 * Removes the kept text of every field the registered collections and Singles no longer translate:
 * what a migration file that dropped or untranslated a field leaves, which carries schema alone.
 * An entity that is not registered is left to its own removal.
 */
export async function removeUntranslatedFieldSources(
  adapter: DrizzleAdapter
): Promise<void> {
  if (!(await adapter.tableExists(TRANSLATION_SOURCES_TABLE))) return;
  const [{ CollectionRegistryService }, { SingleRegistryService }] =
    await Promise.all([
      import("../../collections/services/collection-registry-service"),
      import("../../singles/services/single-registry-service"),
    ]);
  for (const [scopeKind, records] of [
    [
      "collection",
      await new CollectionRegistryService(
        adapter,
        QUIET
      ).getAllTranslationShapes(),
    ],
    [
      "single",
      await new SingleRegistryService(adapter, QUIET).getAllTranslationShapes(),
    ],
  ] as const) {
    for (const record of records) {
      // Fields that could not be read say nothing of which are translated.
      if (!Array.isArray(record.fields)) continue;
      const translated = translatedFieldNames(
        record.fields,
        storesPerLanguage(record)
      );
      await removeFieldSources(
        adapter,
        { scopeKind, scopeSlug: record.slug },
        field => !translated.has(field)
      );
    }
  }
}

/** The registries' records consult nothing else, so their own logging has nowhere to go. */
const QUIET: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
