/**
 * Which media items a stored document uses, read from what its tables hold,
 * and the record of it rewritten.
 *
 * Read rather than taken from what a write path had in hand: there are many
 * write paths, and a partial update, a promotion or a publish of every
 * language each holds a different part of the document. Reading the stored
 * rows on the write's own transaction, after the write, sees exactly what it
 * left, whichever path made it; and the rebuild command reads them the same
 * way, so a rebuilt record and a written one cannot disagree.
 *
 * A document's values come from three places, and each gives its references
 * a language:
 *
 *   - its main row holds the values every language shares, recorded under "";
 *   - its translations table, where there is one, holds each language's own
 *     translatable values, recorded under that language;
 *   - its field groups' tables hold their instances per language, recorded
 *     under the language when the field group is translatable, else under "".
 *
 * @module domains/media/usage/stored-document-usage
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { readComponentSubtrees } from "../../field-groups/read-component-subtrees";
import { extractFieldGroupReferences } from "../../field-groups/storage/field-group-field-type";
import { toSnakeCase } from "../../schema/services/field-column-descriptor";
import type { ComponentSchemas } from "../../versions/restore-snapshot";
import { resolveComponentSchemas } from "../../versions/restore-version";

import {
  collectMediaReferences,
  type FieldGroupSchemas,
} from "./media-references";
import {
  removeDocumentUsage,
  replaceDocumentUsage,
  type LocatedMediaReference,
  type UsageSubject,
} from "./media-usage-store";

/** A document's translations table, when its translatable values are there. */
export interface UsageTranslations {
  companionTableName: string;
  /** Each translatable field's name and its column there. */
  localizedFields: ReadonlyArray<{ name: string; column: string }>;
}

/** Where one document is stored. */
export interface StoredDocumentSource {
  /** The document's main table. */
  tableName: string;
  /** The id of its row there. */
  rowId: string;
  fields: readonly FieldConfig[];
  /**
   * Its translations table, when it is there to read: absent before the
   * translations migration has run, when the translatable values are still
   * on the main row.
   */
  translations: UsageTranslations | null;
}

/** What reading a document needs besides the transaction. */
export interface StoredUsageDeps {
  /** Absent when no field-group service is registered. */
  fieldGroupDataService: FieldGroupDataService | undefined;
  /** The site's language codes; empty when it has no localization. */
  locales: readonly string[];
}

/** A field's name, or "" for a field that has none. */
function nameOf(field: FieldConfig): string {
  const name = (field as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

/** A stored value, under its field's name or its column's. */
function storedValue(row: Record<string, unknown>, name: string): unknown {
  return row[name] !== undefined ? row[name] : row[toSnakeCase(name)];
}

/** Whether any field group a field may hold is translatable. */
function translatableFieldGroup(
  field: FieldConfig,
  schemas: ComponentSchemas
): boolean {
  const { single, many } = extractFieldGroupReferences(field);
  const slugs = [...(single ? [single] : []), ...(many ?? [])];
  return slugs.some(slug => schemas.get(slug)?.localized === true);
}

/** The references the main row's shared values make. */
function mainRowReferences(
  row: Record<string, unknown>,
  fields: readonly FieldConfig[],
  translated: ReadonlySet<string>,
  schemas: FieldGroupSchemas
): LocatedMediaReference[] {
  const shared = fields.filter(
    field =>
      !isFieldGroupField(field as { type: string }) &&
      !translated.has(nameOf(field))
  );
  const values: Record<string, unknown> = {};
  for (const field of shared) {
    const name = nameOf(field);
    if (name !== "") values[name] = storedValue(row, name);
  }
  return collectMediaReferences(shared, values, schemas).map(ref => ({
    ...ref,
    locale: "",
  }));
}

/** The references each language's translated values make. */
async function translationReferences(
  tx: TransactionContext,
  source: StoredDocumentSource,
  schemas: FieldGroupSchemas
): Promise<LocatedMediaReference[]> {
  const translations = source.translations;
  if (translations === null || translations.localizedFields.length === 0) {
    return [];
  }
  const rows = await tx.select<Record<string, unknown>>(
    translations.companionTableName,
    { where: { and: [{ column: "_parent", op: "=", value: source.rowId }] } }
  );
  const names = new Set(translations.localizedFields.map(f => f.name));
  const fields = source.fields.filter(field => names.has(nameOf(field)));
  const refs: LocatedMediaReference[] = [];
  for (const row of rows) {
    const stored = row._locale ?? row.locale;
    const locale = typeof stored === "string" ? stored : "";
    const values: Record<string, unknown> = {};
    for (const field of translations.localizedFields) {
      values[field.name] =
        row[field.name] !== undefined ? row[field.name] : row[field.column];
    }
    for (const ref of collectMediaReferences(fields, values, schemas)) {
      refs.push({ ...ref, locale });
    }
  }
  return refs;
}

/** The references the document's field-group instances make, per language. */
async function fieldGroupReferences(
  tx: TransactionContext,
  deps: StoredUsageDeps,
  source: StoredDocumentSource,
  schemas: ComponentSchemas,
  subject: UsageSubject
): Promise<LocatedMediaReference[]> {
  const groupFields = source.fields.filter(field =>
    isFieldGroupField(field as { type: string })
  );
  if (groupFields.length === 0 || deps.fieldGroupDataService === undefined) {
    return [];
  }
  const refs: LocatedMediaReference[] = [];
  const languages: Array<string | undefined> =
    deps.locales.length > 0 ? [...deps.locales] : [undefined];
  for (const language of languages) {
    const subtrees = await readComponentSubtrees({
      fieldGroupDataService: deps.fieldGroupDataService,
      tx,
      entryId: source.rowId,
      parentTable: source.tableName,
      fieldConfigs: [...source.fields],
      locale: language,
      reason: "media-usage-field-group-read",
      logContext: { kind: subject.kind, slug: subject.slug },
    });
    for (const field of groupFields) {
      const locale =
        language !== undefined && translatableFieldGroup(field, schemas)
          ? language
          : "";
      for (const ref of collectMediaReferences([field], subtrees, schemas)) {
        refs.push({ ...ref, locale });
      }
    }
  }
  return refs;
}

/**
 * Every reference the stored document makes, in every language, read on
 * `tx`; or `null` when its row is not there.
 */
async function storedDocumentReferences(
  tx: TransactionContext,
  deps: StoredUsageDeps,
  subject: UsageSubject,
  source: StoredDocumentSource
): Promise<LocatedMediaReference[] | null> {
  const row = await tx.selectOne<Record<string, unknown>>(source.tableName, {
    where: { and: [{ column: "id", op: "=", value: source.rowId }] },
  });
  if (row === null || row === undefined) return null;
  // Read on the transaction's connection: the registry lookup would
  // otherwise wait for a pooled one this transaction may be holding.
  const schemas = await resolveComponentSchemas(
    [...source.fields],
    tx.getDrizzle()
  );
  const translated = new Set(
    source.translations?.localizedFields.map(f => f.name) ?? []
  );
  return [
    ...mainRowReferences(row, source.fields, translated, schemas),
    ...(await translationReferences(tx, source, schemas)),
    ...(await fieldGroupReferences(tx, deps, source, schemas, subject)),
  ];
}

/**
 * Rewrite the record of `subject` from what its tables hold now, on `tx`,
 * the transaction of the write that changed it. A document whose row is gone
 * keeps no record.
 */
export async function recordStoredDocumentUsage(
  tx: TransactionContext,
  deps: StoredUsageDeps,
  subject: UsageSubject,
  source: StoredDocumentSource
): Promise<void> {
  const refs = await storedDocumentReferences(tx, deps, subject, source);
  if (refs === null) {
    await removeDocumentUsage(tx, subject);
    return;
  }
  await replaceDocumentUsage(tx, subject, refs);
}
