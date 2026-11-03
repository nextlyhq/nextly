/**
 * The fields a binding on a published page may read, and what each holds: the
 * schema a binding is checked against before its value is used.
 *
 * A published page is the same for every visitor, so the shapes are the
 * anonymous visitor's. A source the visitor may not read has none, and a field
 * the visitor's field rules hide is left out, as a public read leaves out its
 * value. A rule that needs an entry to decide hides its field here, because a
 * shape is one answer for every entry and the field is hidden on some.
 *
 * The registry, the access gate and the field rules are imported inside the
 * call, so importing `nextly/runtime` costs none of them.
 *
 * @module runtime/routing/binding-field-shapes
 */
import { z } from "zod";

import type { FieldConfig } from "../../collections/fields/types";
import type { DatePickerAppearance } from "../../collections/fields/types/date";
import { isListField } from "../../domains/versions/diff/field-cardinality";
import { NextlyError } from "../../errors/nextly-error";
import { addressableFields } from "../../shared/addressable-fields";

import { readAsVisitor } from "./read-as-visitor";

/**
 * Whose fields: a collection's entries, or one Single.
 *
 * @experimental
 */
export type BindingSourceRef = { collection: string } | { single: string };

/**
 * One field as a binding is checked against it.
 *
 * @experimental
 */
export interface BindingFieldShape {
  readonly name: string;
  /** The field's type as declared, such as `text`, `date` or `relationship`. */
  readonly type: string;
  /** Present when the field holds a list of values rather than one. */
  readonly hasMany?: true;
  /** The collection, or collections, a relationship or upload points at. */
  readonly relationTo?: string | readonly string[];
  /** The values a select or radio field may hold. */
  readonly options?: readonly string[];
  /** A date picked as a day: it has no time of day and no time zone. */
  readonly dateOnly?: true;
  /** A date picked as a month and year. */
  readonly monthOnly?: true;
  /**
   * A time of day picked without a date: the date part is a fixed placeholder,
   * so only the time is a value. A date with none of the three flags is an
   * instant, read in the site's time zone.
   */
  readonly timeOnly?: true;
  /** A group's own fields, each judged as this one is. */
  readonly fields?: readonly BindingFieldShape[];
}

/** Whether the visitor may read the field at this path of names. */
export type FieldReadable = (path: readonly string[]) => Promise<boolean>;

const REF = z.union([
  z.object({ collection: z.string().min(1) }).strict(),
  z.object({ single: z.string().min(1) }).strict(),
]);

const OPTION = z.union([z.string(), z.object({ value: z.string() })]);

/**
 * The parts of a stored field definition a shape is made from. Definitions
 * come from the registry, where a builder-made collection keeps them as
 * stored data, so one that does not parse is left out rather than guessed at.
 */
const STORED_FIELD = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  hasMany: z.boolean().optional(),
  repeatable: z.boolean().optional(),
  relationTo: z.union([z.string(), z.array(z.string())]).optional(),
  options: z.array(OPTION).optional(),
  admin: z
    .object({
      date: z.object({ pickerAppearance: z.string().optional() }).optional(),
    })
    .optional(),
  fields: z.array(z.unknown()).optional(),
});

type StoredField = z.infer<typeof STORED_FIELD>;

/** Types a read never returns a value for, so nothing may bind to them. */
const NEVER_READ: ReadonlySet<string> = new Set(["password"]);

/** Types with no cardinality setting whose value is always a list of strings. */
const LIST_OF_VALUES: ReadonlySet<string> = new Set(["chips"]);

/**
 * Whether the field holds a list. A repeater and a repeatable component are
 * lists by core's own cardinality rule (`isListField`, which the version
 * diff reads rows by); a relationship, upload, select or text field is one
 * when it says `hasMany`.
 */
function manyOf(field: StoredField): Pick<BindingFieldShape, "hasMany"> {
  // The parsed definition carries the two keys the rule reads, `type` and
  // `repeatable`, under the names a stored field definition gives them.
  const listByCardinality = isListField(field as FieldConfig);
  return field.hasMany === true ||
    LIST_OF_VALUES.has(field.type) ||
    listByCardinality
    ? { hasMany: true }
    : {};
}

function optionsOf(field: StoredField): Pick<BindingFieldShape, "options"> {
  if (field.options === undefined) return {};
  return {
    options: field.options.map(option =>
      typeof option === "string" ? option : option.value
    ),
  };
}

type DateKind = Pick<BindingFieldShape, "dateOnly" | "monthOnly" | "timeOnly">;

/**
 * What each picker appearance says a date field holds. Keyed by the field
 * type's own union, so an appearance added there fails to compile here until
 * it is given a kind.
 */
const DATE_KINDS: Readonly<Record<DatePickerAppearance, DateKind>> = {
  dayOnly: { dateOnly: true },
  monthOnly: { monthOnly: true },
  timeOnly: { timeOnly: true },
  dayAndTime: {},
};

function isPickerAppearance(value: string): value is DatePickerAppearance {
  return Object.hasOwn(DATE_KINDS, value);
}

/** A date field's picker, which says whether it holds a day, a month, a time or an instant. */
function dateKindOf(field: StoredField): DateKind {
  if (field.type !== "date") return {};
  // A date field with no picker set is picked as a day. An appearance this
  // version does not know is read as an instant, which claims nothing.
  const appearance = field.admin?.date?.pickerAppearance ?? "dayOnly";
  return isPickerAppearance(appearance) ? DATE_KINDS[appearance] : {};
}

/**
 * Whether an unnamed container's children are stored at the level it sits
 * in. An unnamed group only lays fields out, so its children are this level's
 * fields; an unnamed repeater stores its children per row. The same rule the
 * field-rule registry files its rules by, so a field found here is looked up
 * at the level its rule is filed under.
 */
function storedAtThisLevel(container: { type?: unknown }): boolean {
  return container.type === "group";
}

async function shapeOf(
  field: StoredField,
  path: readonly string[],
  readable: FieldReadable
): Promise<BindingFieldShape> {
  // A group stores its fields inside its own value, so a binding may follow
  // them; any other container's fields are not part of its shape.
  const nested =
    field.type === "group" && field.fields !== undefined
      ? { fields: await fieldShapesOf(field.fields, readable, path) }
      : {};
  return Object.freeze({
    name: field.name,
    type: field.type,
    ...manyOf(field),
    ...(field.relationTo === undefined ? {} : { relationTo: field.relationTo }),
    ...optionsOf(field),
    ...dateKindOf(field),
    ...nested,
  });
}

/**
 * The shapes of stored field definitions, each kept only when `readable`
 * allows its path. Pure apart from `readable`, which decides who sees what.
 *
 * The fields of a level are core's addressable fields, so an unnamed group's
 * children are shapes of the level it sits in, named by where their values
 * are stored.
 */
export async function fieldShapesOf(
  fields: readonly unknown[],
  readable: FieldReadable,
  parent: readonly string[] = []
): Promise<BindingFieldShape[]> {
  const shapes: BindingFieldShape[] = [];
  for (const stored of addressableFields(fields, {
    descendInto: storedAtThisLevel,
  })) {
    const parsed = STORED_FIELD.safeParse(stored);
    if (!parsed.success || NEVER_READ.has(parsed.data.type)) continue;
    const path = [...parent, parsed.data.name];
    if (!(await readable(path))) continue;
    shapes.push(await shapeOf(parsed.data, path, readable));
  }
  return shapes;
}

/**
 * The fields of a collection or a Single that a binding on a published page
 * may read, as the anonymous visitor may read them; `undefined` when the
 * source does not exist or the visitor may read none of it.
 *
 * Judged as no one, as the public reader's reads are: neither the key of an
 * API request a page renders during nor a plugin person the operation around
 * it is made as can widen or narrow the answer.
 *
 * @experimental
 */
export async function bindingFieldShapes(
  ref: BindingSourceRef
): Promise<readonly BindingFieldShape[] | undefined> {
  const parsed = REF.safeParse(ref);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "A binding's source names one collection or one Single.",
      logContext: { reason: "binding-source-invalid" },
    });
  }
  const source =
    "collection" in parsed.data
      ? { kind: "collection" as const, slug: parsed.data.collection }
      : { kind: "single" as const, slug: parsed.data.single };
  const { visitorFields } = await import("./visitor-fields");
  return readAsVisitor(async () => {
    const visible = await visitorFields(source);
    if (visible === undefined) return undefined;
    return Object.freeze(await fieldShapesOf(visible.fields, visible.readable));
  });
}
