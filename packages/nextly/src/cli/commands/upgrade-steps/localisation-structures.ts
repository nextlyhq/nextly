/**
 * Bringing repeaters and groups translated whole into one structure across languages.
 *
 * An earlier release let a repeater or group be marked `localized: true`, which kept its whole
 * value per language: each language its own rows, order and shared values. A repeater or group
 * now keeps one structure in every language (rows with their ids and order, and every shared
 * value, on the main table), and each language only the text inside, keyed by row id, on its
 * per-language row. This step converts the content an earlier release stored that way, and takes
 * the flag off the Schema Builder's own definitions, where nothing else would.
 *
 * A document converts only where every language's value has the default language's structure:
 * the same rows with the same ids in the same order, and the same shared values. Then nothing is
 * lost: the structure goes to the main table, and each language keeps its own text. Where any
 * language's structure differs, the upgrade refuses, naming each document and field, since only a
 * person can say how such content merges; a dry run lists them the same way. Its configuration's
 * own `localized: true` on such a field is refused when the configuration loads, so a site
 * declared in code reaches this step with the flag already removed.
 *
 * Found by what is stored, so a run that stopped part-way is finished, not repeated: a document
 * still to convert has no structure on its main table and a whole value on a per-language row.
 *
 * @module cli/commands/upgrade-steps/localisation-structures
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { resolveFieldGroupRegistryName } from "../../../domains/field-groups/storage/resolve-storage-names";
import { holdsOneStructure } from "../../../domains/i18n/classify-fields";
import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import {
  sameShare,
  sharedStructureShape,
  splitSharedStructure,
  type SharedStructureShape,
  type StructuredField,
} from "../../../domains/i18n/shared-structure";
import { runStatement } from "../../../domains/schema/pipeline/_internal/run-statement";
import { introspectLiveColumns } from "../../../domains/schema/pipeline/diff/introspect-live";
import { toSnakeCase } from "../../../domains/schema/services/field-column-descriptor";
import { NextlyError } from "../../../errors/nextly-error";
import {
  parsedValue,
  toJsonColumnValue,
} from "../../../shared/lib/json-column-value";
import { isPlainObject } from "../../../shared/lib/plain-copy";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

import { siteEntities, siteLanguages } from "./localisation-site";

/** The per-language table of an entity's main table. */
const languagesTableOf = (tableName: string) => `${tableName}_locales`;

/** How many parent ids one query of per-language rows names. */
const PARENTS_AT_ONCE = 500;

/** One repeater or group of an entity, and where its structure and text are stored. */
interface StructuredColumn {
  entity: LaidOutEntity;
  field: string;
  column: string;
  shape: SharedStructureShape;
}

/** One document's field to convert: its structure, and each language's text. */
interface Conversion {
  id: string;
  structure: unknown;
  overlays: Map<string, unknown>;
}

/** What the step finds of one field: the documents it converts, and those it refuses. */
interface FieldFindings {
  target: StructuredColumn;
  convert: Conversion[];
  /** Each refused document, and why, as the refusal names it. */
  differ: string[];
}

/** A Schema Builder definition still marking a repeater, group or field group translated whole. */
interface FlaggedDefinition {
  registry: string;
  slug: string;
  fields: unknown[];
}

/**
 * `fields` without `localized: true` on any repeater, group or field group, at every depth, and
 * whether any was taken off. The fields inside keep their own flags, which say what is translated.
 */
function withoutContainerFlags(fields: readonly unknown[]): {
  fields: unknown[];
  changed: boolean;
} {
  let changed = false;
  const out = fields.map(field => {
    if (!isPlainObject(field)) return field;
    const next: Record<string, unknown> = { ...field };
    if (
      next.localized === true &&
      typeof next.type === "string" &&
      holdsOneStructure({ type: next.type })
    ) {
      delete next.localized;
      changed = true;
    }
    if (Array.isArray(next.fields)) {
      const inner = withoutContainerFlags(next.fields);
      next.fields = inner.fields;
      changed ||= inner.changed;
    }
    return next;
  });
  return { fields: out, changed };
}

/** The Schema Builder's definitions whose repeaters, groups or field groups still carry the flag. */
async function flaggedDefinitions(
  context: UpgradeStepContext
): Promise<FlaggedDefinition[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const registries = ["dynamic_collections", "dynamic_singles"];
  const fieldGroups = await resolveFieldGroupRegistryName(adapter);
  if (fieldGroups) registries.push(fieldGroups);
  const found: FlaggedDefinition[] = [];
  for (const registry of registries) {
    if (!(await adapter.tableExists(registry))) continue;
    const rows = await adapter.select<{ slug: string; fields: unknown }>(
      registry,
      { columns: ["slug", "fields"] }
    );
    for (const row of rows) {
      const fields = parsedValue(row.fields);
      if (!Array.isArray(fields)) continue;
      const cleared = withoutContainerFlags(fields);
      if (cleared.changed) {
        found.push({ registry, slug: row.slug, fields: cleared.fields });
      }
    }
  }
  return found;
}

/**
 * Each entity's repeaters and groups that keep text inside, where both its main table and its
 * per-language table have the field's column: the only ones content can be stored whole in.
 * Read with the container's own flag off, as the definitions are once this step has run.
 */
async function structuredColumns(
  context: UpgradeStepContext
): Promise<StructuredColumn[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const found: StructuredColumn[] = [];
  for (const entity of await siteEntities(context)) {
    const languagesTable = languagesTableOf(entity.tableName);
    if (!(await adapter.tableExists(languagesTable))) continue;
    const shaped = withoutContainerFlags(entity.fields).fields.flatMap(
      field => {
        if (!isPlainObject(field) || typeof field.name !== "string") return [];
        const shape = sharedStructureShape(field as unknown as StructuredField);
        return shape ? [{ field: field.name, shape }] : [];
      }
    );
    if (shaped.length === 0) continue;
    const { tables } = await introspectLiveColumns(
      adapter.getDrizzle(),
      adapter.dialect,
      [entity.tableName, languagesTable]
    );
    const columnsOf = (table: string) =>
      new Set(
        (tables.find(live => live.name === table)?.columns ?? []).map(
          column => column.name
        )
      );
    const onMain = columnsOf(entity.tableName);
    const perLanguage = columnsOf(languagesTable);
    for (const { field, shape } of shaped) {
      const column = toSnakeCase(field);
      if (onMain.has(column) && perLanguage.has(column)) {
        found.push({ entity, field, column, shape });
      }
    }
  }
  return found;
}

/**
 * Whether `value`, read from a per-language row, is a whole value of the field as an earlier
 * release stored it, rather than the text alone: a repeater's rows, or a group's values.
 */
function isWholeValue(value: unknown, shape: SharedStructureShape): boolean {
  return shape.kind === "repeater"
    ? Array.isArray(value)
    : isPlainObject(value);
}

/** A structure, read for comparison: its rows, ids, order and shared values. */
function structureOf(value: unknown, shape: SharedStructureShape): unknown {
  return splitSharedStructure(value, shape).structure;
}

/** What one field's stored content holds to convert, and what differs by language. */
async function findingsFor(
  context: UpgradeStepContext,
  target: StructuredColumn,
  defaultLocale: string
): Promise<FieldFindings> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const { entity, column, shape } = target;
  // Read through statements: the upgrade's connection registers no content tables. A document
  // still to convert has no structure on its main table.
  const unconverted = await adapter.queryStatement<{ id: unknown }>(
    sql`SELECT ${sql.identifier("id")} AS ${sql.identifier("id")} FROM ${sql.identifier(entity.tableName)} WHERE ${sql.identifier(column)} IS NULL`
  );
  const findings: FieldFindings = { target, convert: [], differ: [] };
  const ids = unconverted.map(row => String(row.id));
  for (let at = 0; at < ids.length; at += PARENTS_AT_ONCE) {
    const batch = ids.slice(at, at + PARENTS_AT_ONCE);
    const rows = await adapter.queryStatement<{
      parent: unknown;
      locale: string;
      value: unknown;
    }>(
      sql`SELECT ${sql.identifier("_parent")} AS ${sql.identifier("parent")}, ${sql.identifier("_locale")} AS ${sql.identifier("locale")}, ${sql.identifier(column)} AS ${sql.identifier("value")} FROM ${sql.identifier(languagesTableOf(entity.tableName))} WHERE ${sql.identifier("_parent")} IN (${sql.join(
        batch.map(id => sql`${id}`),
        sql`, `
      )}) AND ${sql.identifier(column)} IS NOT NULL`
    );
    const byParent = new Map<string, Map<string, unknown>>();
    for (const row of rows) {
      const value = parsedValue(row.value);
      if (!isWholeValue(value, shape)) continue;
      const parent = String(row.parent);
      const values = byParent.get(parent) ?? new Map<string, unknown>();
      values.set(row.locale, value);
      byParent.set(parent, values);
    }
    for (const [id, values] of byParent) {
      const judged = judge(id, values, shape, defaultLocale);
      if (typeof judged === "string") findings.differ.push(judged);
      else findings.convert.push(judged);
    }
  }
  return findings;
}

/**
 * One document's languages judged against its default language's: a conversion where every
 * language has the same structure, else why it is refused.
 */
function judge(
  id: string,
  values: ReadonlyMap<string, unknown>,
  shape: SharedStructureShape,
  defaultLocale: string
): Conversion | string {
  const fromDefault = values.get(defaultLocale);
  if (fromDefault === undefined) {
    return `document ${id} has no "${defaultLocale}" value to take the structure from (it has ${[...values.keys()].join(", ")})`;
  }
  const structure = structureOf(fromDefault, shape);
  const differing = [...values]
    .filter(
      ([locale, value]) =>
        locale !== defaultLocale &&
        !sameShare(structureOf(value, shape), structure)
    )
    .map(([locale]) => locale);
  if (differing.length > 0) {
    return `document ${id}: ${differing.join(", ")} ${differing.length === 1 ? "has" : "have"} other rows, another order or other shared values than "${defaultLocale}"`;
  }
  const overlays = new Map<string, unknown>();
  for (const [locale, value] of values) {
    overlays.set(locale, splitSharedStructure(value, shape).overlay ?? {});
  }
  return { id, structure, overlays };
}

/** Each field's findings, for every repeater or group that can hold content stored whole. */
async function allFindings(
  context: UpgradeStepContext
): Promise<FieldFindings[]> {
  const { defaultLocale } = await siteLanguages(context);
  const findings: FieldFindings[] = [];
  for (const target of await structuredColumns(context)) {
    const found = await findingsFor(context, target, defaultLocale);
    if (found.convert.length > 0 || found.differ.length > 0) {
      findings.push(found);
    }
  }
  return findings;
}

/** How a field is named to an operator. */
function fieldLabel({ entity, field }: StructuredColumn): string {
  return `the ${entity.kind} "${entity.slug}", field "${field}"`;
}

/** The refusals of `findings`, one line per document. */
function refusalsOf(findings: readonly FieldFindings[]): string[] {
  return findings.flatMap(found =>
    found.differ.map(why => `${fieldLabel(found.target)}: ${why}`)
  );
}

/** Refuse, naming each document whose languages differ, before anything is written. */
function refuseWhereLanguagesDiffer(findings: readonly FieldFindings[]): void {
  const refused = refusalsOf(findings);
  if (refused.length === 0) return;
  throw new NextlyError({
    code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
    publicMessage:
      `A repeater or group kept a structure per language, and now keeps one in every language. ` +
      `These documents' languages differ, so they cannot be converted without choosing what to ` +
      `keep: ${refused.join("; ")}. Make each language's rows, order and shared values the ` +
      `same as the default language's (or remove the extra content), then run the upgrade ` +
      `again. Nothing was changed.`,
    logContext: { refused },
  });
}

/**
 * How many things the step would change: each Schema Builder definition to take the flag off, and
 * each document's field to convert. Refuses, naming them, where any document's languages differ.
 */
export async function structuresToConvert(
  context: UpgradeStepContext
): Promise<number> {
  const findings = await allFindings(context);
  refuseWhereLanguagesDiffer(findings);
  return (
    (await flaggedDefinitions(context)).length +
    findings.reduce((count, found) => count + found.convert.length, 0)
  );
}

/** Take the flag off the definitions and convert every document; how many things changed. */
export async function convertStructures(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const findings = await allFindings(context);
  refuseWhereLanguagesDiffer(findings);
  const flagged = await flaggedDefinitions(context);
  let changed = 0;
  await adapter.transaction(async tx => {
    for (const definition of flagged) {
      await tx.update(
        definition.registry,
        { fields: toJsonColumnValue(definition.fields) },
        { and: [{ column: "slug", op: "=", value: definition.slug }] }
      );
      changed += 1;
    }
    // Written through statements, as read: no content table is registered on this connection.
    const db = tx.getDrizzle();
    for (const { target, convert } of findings) {
      const table = sql.identifier(target.entity.tableName);
      const languagesTable = sql.identifier(
        languagesTableOf(target.entity.tableName)
      );
      const column = sql.identifier(target.column);
      for (const { id, structure, overlays } of convert) {
        await runStatement(
          db,
          adapter.dialect,
          sql`UPDATE ${table} SET ${column} = ${toJsonColumnValue(structure)} WHERE ${sql.identifier("id")} = ${id}`
        );
        for (const [locale, overlay] of overlays) {
          await runStatement(
            db,
            adapter.dialect,
            sql`UPDATE ${languagesTable} SET ${column} = ${toJsonColumnValue(overlay)} WHERE ${sql.identifier("_parent")} = ${id} AND ${sql.identifier("_locale")} = ${locale}`
          );
        }
        changed += 1;
      }
    }
  });
  return changed;
}

/** What the dry run lists: each definition the flag comes off, and each field's documents. */
export async function structuresReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  const findings = await allFindings(context);
  return {
    move: [
      ...(await flaggedDefinitions(context)).map(
        definition =>
          `the Schema Builder definition "${definition.slug}" (${definition.registry}): \`localized\` taken off its repeaters, groups and field groups, whose fields inside say what is translated`
      ),
      ...findings
        .filter(found => found.convert.length > 0)
        .map(
          found =>
            `${fieldLabel(found.target)}: ${found.convert.length} document(s) to one structure in every language, each language keeping its own text by row`
        ),
    ],
    conflicts: refusalsOf(findings),
    check: [],
  };
}
