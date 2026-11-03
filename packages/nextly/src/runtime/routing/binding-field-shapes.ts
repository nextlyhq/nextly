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

import { runDetachedFromRequest } from "../../auth/caller-scope";
import { NextlyError } from "../../errors/nextly-error";

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

/** Types whose value is always a list. */
const ALWAYS_MANY: ReadonlySet<string> = new Set(["repeater", "chips"]);

function manyOf(field: StoredField): Pick<BindingFieldShape, "hasMany"> {
  return field.hasMany === true || ALWAYS_MANY.has(field.type)
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

/** A date field's picker, which says whether it holds a day, a month or an instant. */
function dateKindOf(
  field: StoredField
): Pick<BindingFieldShape, "dateOnly" | "monthOnly"> {
  if (field.type !== "date") return {};
  // A date field with no picker set is picked as a day.
  const appearance = field.admin?.date?.pickerAppearance ?? "dayOnly";
  if (appearance === "dayOnly") return { dateOnly: true };
  return appearance === "monthOnly" ? { monthOnly: true } : {};
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
 */
export async function fieldShapesOf(
  fields: readonly unknown[],
  readable: FieldReadable,
  parent: readonly string[] = []
): Promise<BindingFieldShape[]> {
  const shapes: BindingFieldShape[] = [];
  for (const stored of fields) {
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
 * Judged detached from any request being served, as the public reader's
 * reads are, so the key of an API request a page renders during cannot widen
 * or narrow the answer.
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
  return runDetachedFromRequest(async () => {
    const visible = await visitorFields(source);
    if (visible === undefined) return undefined;
    return Object.freeze(await fieldShapesOf(visible.fields, visible.readable));
  });
}
