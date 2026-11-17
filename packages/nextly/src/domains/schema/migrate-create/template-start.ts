/**
 * The tables a project made from a template starts with.
 *
 * A template ships a hand-written migration and, beside it, an older-format
 * snapshot that lists its collections and Singles with their top-level fields
 * and no tables (`isOlderFormatSnapshot`). So that the first migration a
 * project writes holds only what it changed, and the comparison `nextly
 * migrate` makes names only that, the listed entities are taken as already
 * made, with the fields the template lists:
 *
 * - a declared entity the template lists: its table as declared, without the
 *   fields the template does not list (each is new), and with the fields the
 *   template lists that the declaration lost (each is removed);
 * - a listed entity no longer declared: its table, to be removed;
 * - a declared entity the template does not list: new, unless it is a
 *   collection a plugin contributes, which no template lists and which is
 *   taken as made whole. A field group is always new: the format has no place
 *   for one, and a template's migration makes no table for one.
 *
 * Names only: a listed field whose type or options changed is not seen, since
 * the template's wording for them is not the declaration's.
 *
 * @module domains/schema/migrate-create/template-start
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { SYSTEM_COLUMNS } from "../../../lib/system-columns";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "./generate";
import type { TemplateEntities, TemplateEntity } from "./snapshot-io";

/**
 * Every spelling of a column Nextly adds to a table itself (`title`, `slug`,
 * the dates): a template lists some of them as fields, and a declaration
 * without such a field has not removed one.
 */
const SYSTEM_NAMES: ReadonlySet<string> = new Set(
  SYSTEM_COLUMNS.flatMap(column => [column.name, column.camelName])
);

/** `declared` as the template made it, or undefined where the template does not list it. */
function asMade(
  declared: MinimalConfigEntity,
  listed: TemplateEntity | undefined
): MinimalConfigEntity | undefined {
  if (listed === undefined) return undefined;
  const listedNames = new Set(listed.fields.map(field => field.name));
  const declaredNames = new Set(declared.fields.map(field => field.name));
  return {
    ...declared,
    // The table the template made, where the file names it: a declaration
    // that has since moved the entity to another table has changed it.
    tableName: listed.tableName ?? declared.tableName,
    fields: [
      // A field without a name (a layout container) is not one the template
      // could list, so it stays.
      ...declared.fields.filter(
        field => typeof field.name !== "string" || listedNames.has(field.name)
      ),
      ...listed.fields.filter(
        field => !declaredNames.has(field.name) && !SYSTEM_NAMES.has(field.name)
      ),
    ],
  };
}

/** The listed entities nothing declares any more, with the table each was made as. */
function noLongerDeclared(
  listed: readonly TemplateEntity[],
  declared: readonly MinimalConfigEntity[]
): MinimalConfigEntity[] {
  const slugs = new Set(declared.map(entity => entity.slug));
  return listed.flatMap(entity =>
    slugs.has(entity.slug) || entity.tableName === undefined
      ? []
      : [
          {
            slug: entity.slug,
            tableName: entity.tableName,
            fields: entity.fields,
          },
        ]
  );
}

/** One kind's entities as the template made them. */
function madeOf(
  declared: readonly MinimalConfigEntity[],
  listed: readonly TemplateEntity[],
  madeWhole: ReadonlySet<string>
): MinimalConfigEntity[] {
  const bySlug = new Map(listed.map(entity => [entity.slug, entity]));
  return [
    ...declared.flatMap(entity => {
      if (madeWhole.has(entity.slug)) return [entity];
      const made = asMade(entity, bySlug.get(entity.slug));
      return made === undefined ? [] : [made];
    }),
    ...noLongerDeclared(listed, declared),
  ];
}

/** The tables the template's entities are taken as already made with. */
export function templateStartingTables(args: {
  template: TemplateEntities;
  collections: readonly MinimalConfigEntity[];
  singles: readonly MinimalConfigEntity[];
  /** The slugs of the collections a plugin contributes (`pluginCollectionSources`). */
  pluginCollections: ReadonlySet<string>;
  dialect: SupportedDialect;
}): NextlySchemaSnapshot {
  return buildDesiredSnapshotFromConfig(
    madeOf(args.collections, args.template.collections, args.pluginCollections),
    madeOf(args.singles, args.template.singles, new Set()),
    [],
    args.dialect
  );
}
