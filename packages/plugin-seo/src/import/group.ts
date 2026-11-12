/**
 * Importing from a field group a site already keeps its SEO values in: a
 * `group` field, or a component (field group) such as Rext's `meta-data`,
 * on the content types SEO is added to.
 *
 * The groups are found on each type's fields, and each field inside one is
 * offered with how many pages hold a value in it and where its name says it
 * should go, for a person to check. The plugin's own `seo` group, as an
 * earlier version of the plugin stored it, is offered too: its values stay
 * where they are, and the import only turns a typed value that is the same
 * as the automatic one back into automatic.
 *
 * @module import/group
 */
import { humanizeFieldName, type PluginContext } from "@nextlyhq/plugin-sdk";

import type { ReadPage } from "../bulk/pages";
import { isRecord, textOf } from "../plain-values";
import { SEO_GROUP } from "../tab/typed";

import type { GroupField, ImportGroup, ImportTarget } from "./contract";
import {
  count,
  idText,
  type ImportedRecord,
  type ImportedValues,
  type ParsedSource,
} from "./records";

/** What the plugin's own group's fields are, and where each already is. */
export const OWN_FIELDS: Readonly<Record<string, ImportTarget>> = {
  metaTitle: "title",
  metaDescription: "description",
  ogImage: "image",
  socialTitle: "socialTitle",
  socialDescription: "socialDescription",
  canonical: "canonical",
  noindex: "hidden",
};

/** A declared field, read loosely: only what the import needs of it. */
interface DeclaredField {
  name: string;
  label?: string;
  type?: string;
  fields?: unknown;
  component?: unknown;
  repeatable?: unknown;
  hasMany?: unknown;
}

const asField = (value: unknown): DeclaredField | undefined =>
  isRecord(value) && typeof value.name === "string" && value.name !== ""
    ? (value as unknown as DeclaredField)
    : undefined;

/** The fields a list of declared fields holds, each read loosely. */
function fieldsOf(value: unknown): DeclaredField[] {
  return Array.isArray(value)
    ? value.flatMap(field => asField(field) ?? [])
    : [];
}

/** A component's own fields, where the site declares the component in code. */
function componentFields(
  ctx: PluginContext,
  slug: unknown
): DeclaredField[] | undefined {
  if (typeof slug !== "string") return undefined;
  const declared: readonly unknown[] = ctx.config.fieldGroups ?? [];
  const found = declared.find(group => isRecord(group) && group.slug === slug);
  return isRecord(found) ? fieldsOf(found.fields) : undefined;
}

/**
 * The single group or component fields of a type: a field that holds one
 * set of values per page. A repeating one, or a component choosing from
 * several, holds no one value per page, and is not offered.
 */
function groupFieldsOf(
  ctx: PluginContext,
  fields: readonly DeclaredField[]
): { field: DeclaredField; inner: DeclaredField[] | undefined }[] {
  const found: { field: DeclaredField; inner: DeclaredField[] | undefined }[] =
    [];
  for (const field of fields) {
    if (field.repeatable === true || field.hasMany === true) continue;
    if (field.type === "group") {
      found.push({ field, inner: fieldsOf(field.fields) });
    } else if (
      field.type === "component" &&
      typeof field.component === "string"
    ) {
      found.push({ field, inner: componentFields(ctx, field.component) });
    }
  }
  return found;
}

/** Where a field's name says its values go. */
export function suggestedTarget(name: string): ImportTarget {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  if (
    /twitter|keyword|card|locale|width|height|alt|type|follow|published|modified|time$/.test(
      key
    )
  ) {
    return "skip";
  }
  if (/noindex|hidden|hide/.test(key)) return "hidden";
  if (key.endsWith("index")) return "shown";
  if (/canonical/.test(key)) return "canonical";
  if (/^(og|social|share|open)/.test(key)) {
    if (/title/.test(key)) return "socialTitle";
    if (/desc/.test(key)) return "socialDescription";
    if (/image|picture|photo/.test(key)) return "image";
    return "skip";
  }
  if (/image|picture|photo/.test(key)) return "image";
  if (/title/.test(key)) return "title";
  if (/desc/.test(key)) return "description";
  return "skip";
}

/** Whether a value counts as filled in. */
function filled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "boolean") return value;
  return true;
}

/** A group's values on one page, or none. */
function valuesIn(page: ReadPage, field: string): Record<string, unknown> {
  const value = page.document[field];
  return isRecord(value) ? value : {};
}

/**
 * Whether a key a stored component carries is one of its fields: its id is
 * not, nor is any system key, which begins with an underscore where a field
 * name must begin with a letter.
 */
function isFieldKey(key: string): boolean {
  return key !== "id" && !key.startsWith("_");
}

/** A group as the types holding it declare it, before its pages are read. */
interface DeclaredGroup {
  label: string;
  types: { slug: string; label: string }[];
  /** Each field inside, by name, with its label. */
  inner: Map<string, string>;
}

/** The groups the types declare, by field name, with each field inside. */
function declaredGroups(
  ctx: PluginContext,
  types: readonly { slug: string; label: string; fields: unknown }[]
): Map<string, DeclaredGroup> {
  const groups = new Map<string, DeclaredGroup>();
  for (const type of types) {
    for (const { field, inner } of groupFieldsOf(ctx, fieldsOf(type.fields))) {
      const group = groups.get(field.name) ?? {
        label: textOf(field.label) ?? humanizeFieldName(field.name),
        types: [],
        inner: new Map<string, string>(),
      };
      group.types.push({ slug: type.slug, label: type.label });
      for (const each of inner ?? []) {
        if (group.inner.has(each.name)) continue;
        group.inner.set(
          each.name,
          textOf(each.label) ?? humanizeFieldName(each.name)
        );
      }
      groups.set(field.name, group);
    }
  }
  return groups;
}

/** One declared group as the panel offers it, counted over its pages. */
function offeredGroup(
  name: string,
  group: DeclaredGroup,
  pages: readonly ReadPage[]
): ImportGroup {
  const onTypes = new Set(group.types.map(type => type.slug));
  const read = pages.filter(page => onTypes.has(page.type));
  // A field a code declaration does not name, such as one a builder-made
  // component holds, is found in the values themselves.
  const inner = new Map(group.inner);
  for (const key of read.flatMap(page => Object.keys(valuesIn(page, name)))) {
    if (isFieldKey(key) && !inner.has(key)) {
      inner.set(key, humanizeFieldName(key));
    }
  }
  const own = name === SEO_GROUP;
  const fields: GroupField[] = [...inner].map(([field, label]) => ({
    name: field,
    label,
    filled: read.filter(page => filled(valuesIn(page, name)[field])).length,
    suggested: own ? (OWN_FIELDS[field] ?? "skip") : suggestedTarget(field),
  }));
  return {
    field: name,
    label: group.label,
    types: group.types,
    pages: read.length,
    fields,
    own,
  };
}

/** How many values a group's pages hold, in all its fields. */
const valuesHeld = (group: ImportGroup) =>
  group.fields.reduce((sum, field) => sum + field.filled, 0);

/**
 * The groups the pages' types hold, each field inside with how many of the
 * pages hold a value in it, the groups holding the most values first and
 * the plugin's own last.
 */
export function groupsOf(
  ctx: PluginContext,
  types: readonly { slug: string; label: string; fields: unknown }[],
  pages: readonly ReadPage[]
): ImportGroup[] {
  return [...declaredGroups(ctx, types)]
    .map(([name, group]) => offeredGroup(name, group, pages))
    .sort(
      (a, b) => Number(a.own) - Number(b.own) || valuesHeld(b) - valuesHeld(a)
    );
}

/** Text read as hidden (true), shown (false), or neither, by its words. */
function visibilityOfText(
  value: string,
  reversed: boolean
): boolean | "unreadable" {
  const words = value.toLowerCase().split(/[\s,]+/);
  if (words.includes("noindex")) return true;
  if (words.includes("index")) return false;
  const first = words[0] ?? "";
  if (["true", "yes", "1"].includes(first)) return !reversed;
  if (["false", "no", "0"].includes(first)) return reversed;
  return "unreadable";
}

/**
 * A visibility value read as hidden (true), shown (false) or neither: a
 * yes/no field, or text saying `noindex` or `index`. Reversed, a yes/no
 * field's yes means shown; text is read by its words either way.
 */
function visibilityOf(
  value: unknown,
  reversed: boolean
): boolean | undefined | "unreadable" {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return reversed ? !value : value;
  if (value === 0 || value === 1) return reversed ? value === 0 : value === 1;
  if (typeof value === "string") return visibilityOfText(value, reversed);
  return "unreadable";
}

/** A stored image as an id here, or none. */
function imageId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return idText(isRecord(value) ? value.id : value);
}

type Placed = Exclude<ImportTarget, "skip">;

/**
 * Put `value` in its place among `values`, unless an earlier field filled
 * that place: whether it was placed, or that it could not be read.
 */
function place(
  values: ImportedValues,
  target: Placed,
  value: unknown
): boolean | "unreadable" {
  if (target === "hidden" || target === "shown") {
    if (values.hidden !== undefined) return false;
    const hidden = visibilityOf(value, target === "shown");
    if (hidden === "unreadable" || hidden === undefined) {
      return hidden ?? false;
    }
    values.hidden = hidden;
    return true;
  }
  if (target === "image") {
    const id = imageId(value);
    if (values.image !== undefined || id === undefined) return false;
    values.image = { id };
    return true;
  }
  const text = textOf(value);
  if (values[target] !== undefined || text === undefined) return false;
  values[target] = text;
  return true;
}

/** What the person should know about how `map` places a group's values. */
function groupWarnings(
  order: readonly [string, Placed][],
  unreadable: number
): string[] {
  const shared = new Map<Placed, string[]>();
  for (const [name, target] of order) {
    shared.set(target, [...(shared.get(target) ?? []), name]);
  }
  const warnings = [...shared.values()]
    .filter(names => names.length > 1)
    .map(
      names =>
        `${names.join(" and ")} go to the same place. On each page the first one with a value wins.`
    );
  if (unreadable > 0) {
    warnings.push(
      `${count(unreadable, "value")} set to hide pages from search ${unreadable === 1 ? "isn't" : "aren't"} yes or no, or index or noindex, so ${unreadable === 1 ? "that page keeps its" : "those pages keep their"} setting. Check this match.`
    );
  }
  return warnings;
}

/** Each page's values in `field`, placed as `map` says. */
export function readGroup(
  pages: readonly ReadPage[],
  field: string,
  map: Readonly<Record<string, ImportTarget>>
): ParsedSource {
  const from: ParsedSource["from"] = {};
  const left = Object.entries(map)
    .filter(([, target]) => target === "skip")
    .map(([name]) => name);
  const order = Object.entries(map).filter(
    (entry): entry is [string, Placed] => entry[1] !== "skip"
  );
  let unreadable = 0;
  const records: ImportedRecord[] = [];
  for (const page of pages.filter(each => field in each.document)) {
    const group = valuesIn(page, field);
    const values: ImportedValues = {};
    for (const [name, target] of order) {
      const placed = place(values, target, group[name]);
      if (placed === "unreadable") unreadable++;
      if (placed !== true) continue;
      const names = (from[target === "shown" ? "hidden" : target] ??= []);
      if (!names.includes(name)) names.push(name);
    }
    records.push({
      label: page.label,
      match: { page: { type: page.type, id: page.id } },
      values,
    });
  }
  return { records, from, left, warnings: groupWarnings(order, unreadable) };
}
