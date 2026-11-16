/**
 * How the field picker offers, finds and groups field types. Pure functions
 * over field-type descriptions, so every surface that opens the picker finds a
 * type the same way.
 *
 * @module components/field-ui/field-type-search
 */
import type {
  FieldTypeCatalogEntry,
  FieldTypeDescription,
} from "nextly/field-catalog";
import {
  BLOCK_FIELD_TYPE_CATALOG,
  describeFieldTypes,
  FIELD_TYPE_CATALOG,
  FIELD_TYPE_CATEGORY_ORDER,
  FORM_FIELD_TYPE_CATALOG,
  USER_FIELD_TYPE_CATALOG,
} from "nextly/field-catalog";
import { isFieldGroupFieldType } from "nextly/field-group-type";

/** A heading in the picker and the types under it. */
export interface FieldTypeGroup {
  heading: string;
  types: readonly FieldTypeDescription<string>[];
}

/**
 * Every built-in type id on any surface, offered here or not: a plugin type
 * never takes one. Read from the surface catalogs themselves, so a surface-only
 * type (a form's `phone`, say) counts the moment a catalog lists it.
 */
const BUILT_IN_TYPE_IDS: ReadonlySet<string> = new Set(
  [
    FIELD_TYPE_CATALOG,
    USER_FIELD_TYPE_CATALOG,
    FORM_FIELD_TYPE_CATALOG,
    BLOCK_FIELD_TYPE_CATALOG,
  ].flatMap(catalog => catalog.map(entry => entry.type))
);

/** Whether a type id belongs to a built-in, field groups' every spelling included. */
function isBuiltInTypeId(type: string): boolean {
  return BUILT_IN_TYPE_IDS.has(type) || isFieldGroupFieldType(type);
}

/**
 * The types a surface offers: its built-ins, then the plugin rows declared for
 * it. A built-in wins a type id, even one this surface does not offer, so a
 * plugin reusing an id never stands in for the built-in. `exclude` removes
 * types of either kind.
 */
export function offeredFieldTypes(
  builtIns: readonly FieldTypeDescription<string>[],
  pluginRows: readonly FieldTypeCatalogEntry<string>[],
  exclude: readonly string[] = []
): FieldTypeDescription<string>[] {
  const excluded = new Set(exclude);
  const builtInIds = new Set(builtIns.map(type => type.type));
  const plugins = describeFieldTypes(
    pluginRows.filter(
      row => !isBuiltInTypeId(row.type) && !builtInIds.has(row.type)
    )
  );
  return [...builtIns, ...plugins].filter(type => !excluded.has(type.type));
}

/**
 * How well a type matches a query: 0 when its name starts with it, 1 when its
 * name contains it, 2 for a synonym, 3 for its description or category, or
 * when each word of a longer query is found somewhere. `null` when it does
 * not match.
 */
function matchRank(
  type: FieldTypeDescription<string>,
  query: string
): number | null {
  const label = type.label.toLowerCase();
  if (label.startsWith(query)) return 0;
  if (label.includes(query)) return 1;
  const synonyms = type.synonyms.map(word => word.toLowerCase());
  if (synonyms.some(word => word.includes(query))) return 2;
  const rest = [type.hint, type.category].map(text => text.toLowerCase());
  if (rest.some(text => text.includes(query))) return 3;
  const haystack = [label, ...synonyms, ...rest];
  const words = query.split(/\s+/);
  return words.length > 1 &&
    words.every(word => haystack.some(text => text.includes(word)))
    ? 3
    : null;
}

/**
 * The types matching `query` by name, synonym, description or category, best
 * first and otherwise in the order given. `null` for an empty query, when the
 * picker shows its groups instead; an empty list when nothing matches.
 */
export function searchFieldTypes(
  types: readonly FieldTypeDescription<string>[],
  query: string
): FieldTypeDescription<string>[] | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  return types
    .map((type, index) => ({ type, index, rank: matchRank(type, q) }))
    .filter(
      (
        hit
      ): hit is {
        type: FieldTypeDescription<string>;
        index: number;
        rank: number;
      } => hit.rank !== null
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(hit => hit.type);
}

/**
 * The picker's view before anything is typed: a "Most used" group of the
 * offered `mostUsed` types in that order, then each category in the catalog's
 * order with the rest, each type once. A category outside that order (a
 * plugin's) follows as its own group rather than being dropped.
 */
export function groupFieldTypes(
  types: readonly FieldTypeDescription<string>[],
  mostUsed: readonly string[]
): FieldTypeGroup[] {
  const byId = new Map(types.map(type => [type.type, type]));
  const first = mostUsed.flatMap(id => byId.get(id) ?? []);
  const shown = new Set(first.map(type => type.type));
  const groups: FieldTypeGroup[] =
    first.length > 0 ? [{ heading: "Most used", types: first }] : [];
  const categories: string[] = [...FIELD_TYPE_CATEGORY_ORDER];
  for (const type of types) {
    if (!categories.includes(type.category)) categories.push(type.category);
  }
  for (const category of categories) {
    const inCategory = types.filter(
      type => type.category === category && !shown.has(type.type)
    );
    if (inCategory.length > 0) {
      groups.push({ heading: category, types: inCategory });
    }
  }
  return groups;
}
