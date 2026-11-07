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

import type { FieldStoragePrimitive } from "../../collections/fields/catalog";
import type { FieldConfig } from "../../collections/fields/types";
import type { DatePickerAppearance } from "../../collections/fields/types/date";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../domains/field-groups/storage/field-group-field-type";
import { getFieldType } from "../../domains/schema/field-types/field-type-registry";
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
  /**
   * The storage primitive a plugin-contributed field type persists as, from
   * the field-type registry, so the binding catalog can judge the field by
   * it as `BindingEndpoint.storage`. Absent for a built-in type.
   */
  readonly storage?: FieldStoragePrimitive;
  /**
   * A group's own fields, or the fields of the one component a component
   * field holds, each judged as this one is: a component's by that
   * component's own rules.
   */
  readonly fields?: readonly BindingFieldShape[];
}

/**
 * Where a field inside a component sits: the component whose rules it is
 * filed under, and its path of names from that component's top level.
 */
export interface ComponentLevel {
  component: string;
  path: readonly string[];
}

/**
 * Whether the visitor may read the field at this path of names from the
 * source's top level; `within` says where it sits in a component, when it
 * does.
 */
export type FieldReadable = (
  path: readonly string[],
  within?: ComponentLevel
) => Promise<boolean>;

const REF = z.union([
  z.object({ collection: z.string().min(1) }).strict(),
  z.object({ single: z.string().min(1) }).strict(),
]);

/**
 * What the shapes are for.
 *
 * @experimental
 */
export interface BindingFieldShapesOptions {
  /**
   * The language of the page the shapes are checked for. A field rule that
   * answers by language is told it, as a read in it would be; absent, the
   * rules are told every configured language.
   */
  locale?: string;
}

const OPTIONS = z.object({ locale: z.string().min(1).optional() }).strict();

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

/** A plugin-contributed type's storage primitive; nothing for a built-in, which the registry does not hold. */
function storageOf(field: StoredField): Pick<BindingFieldShape, "storage"> {
  const contributed = getFieldType(field.type);
  return contributed === undefined ? {} : { storage: contributed.storage };
}

/**
 * The level a container's children are judged at, as their parent: a
 * group's, the group's own place (`within`, which already names it); one
 * component's, that component's top level. `null` for a container whose
 * children are not part of its shape: a dynamic zone, whose members differ by
 * instance, and anything else.
 */
function childLevelOf(
  field: StoredField,
  stored: unknown,
  within: ComponentLevel | undefined
): { within: ComponentLevel | undefined } | null {
  if (field.type === "group") return { within };
  if (!isFieldGroupFieldType(field.type)) return null;
  const { single, many } = extractFieldGroupReferences(stored);
  if (single === undefined || (many?.length ?? 0) > 0) return null;
  return { within: { component: single, path: [] } };
}

async function shapeOf(
  field: StoredField,
  stored: unknown,
  path: readonly string[],
  readable: FieldReadable,
  within: ComponentLevel | undefined
): Promise<BindingFieldShape> {
  // A group stores its fields inside its own value, and a component field
  // holds its component's, grafted on when the fields were expanded, so a
  // binding may follow either; no other container's fields are in its shape.
  const level = childLevelOf(field, stored, within);
  const nested =
    level !== null && field.fields !== undefined
      ? {
          fields: await fieldShapesOf(
            field.fields,
            readable,
            path,
            level.within
          ),
        }
      : {};
  return Object.freeze({
    name: field.name,
    type: field.type,
    ...storageOf(field),
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
  parent: readonly string[] = [],
  within?: ComponentLevel
): Promise<BindingFieldShape[]> {
  const shapes: BindingFieldShape[] = [];
  for (const stored of addressableFields(fields, {
    descendInto: storedAtThisLevel,
  })) {
    const parsed = STORED_FIELD.safeParse(stored);
    if (!parsed.success || NEVER_READ.has(parsed.data.type)) continue;
    const path = [...parent, parsed.data.name];
    const own =
      within === undefined
        ? undefined
        : {
            component: within.component,
            path: [...within.path, parsed.data.name],
          };
    if (!(await readable(path, own))) continue;
    shapes.push(await shapeOf(parsed.data, stored, path, readable, own));
  }
  return shapes;
}

/** A binding source's ref, read before anything else is. */
function sourceOf(
  ref: BindingSourceRef
):
  | { readonly kind: "collection"; readonly slug: string }
  | { readonly kind: "single"; readonly slug: string } {
  const parsed = REF.safeParse(ref);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "A binding's source names one collection or one Single.",
      logContext: { reason: "binding-source-invalid" },
    });
  }
  return "collection" in parsed.data
    ? { kind: "collection", slug: parsed.data.collection }
    : { kind: "single", slug: parsed.data.single };
}

/** Every field readable: the reader of an editor's view, not a visitor's. */
const EVERY_FIELD: FieldReadable = () => Promise.resolve(true);

/** The timestamps an entry carries where its source keeps them. */
const TIMESTAMPS: readonly BindingFieldShape[] = [
  { name: "createdAt", type: "date" },
  { name: "updatedAt", type: "date" },
];

/**
 * The fields of a collection or a Single as they are declared, whoever may
 * read them: what a document may bind, as a save judges it. `undefined` when
 * there is no such source. A field the public may not read is in it, since
 * binding one is allowed (the published page shows the binding's fallback);
 * {@link bindingFieldShapes} is the visitor's narrower view of the same
 * fields, built by the same walk.
 *
 * `createdAt` and `updatedAt` are listed, as dates, where the source's
 * entries carry them, and are absent where they do not, so a binding to one
 * is judged as any field is.
 *
 * @experimental
 */
export async function declaredFieldShapes(
  ref: BindingSourceRef
): Promise<readonly BindingFieldShape[] | undefined> {
  const source = sourceOf(ref);
  const { declaredSource } = await import("./visitor-fields");
  const declared = await declaredSource(source);
  if (declared === undefined) return undefined;
  const shapes = await fieldShapesOf(declared.fields, EVERY_FIELD);
  const named = new Set(shapes.map(shape => shape.name));
  return Object.freeze([
    ...shapes,
    ...(declared.timestamps
      ? TIMESTAMPS.filter(shape => !named.has(shape.name))
      : []),
  ]);
}

/**
 * The fields of a collection or a Single that a binding on a published page
 * may read, as the anonymous visitor may read them; `undefined` when the
 * source does not exist or the visitor may read none of it.
 *
 * The rules are told the language `options.locale` names, or every configured
 * language, never the one an enclosing operation set.
 *
 * Judged as no one, as the public reader's reads are: neither the key of an
 * API request a page renders during nor a plugin person the operation around
 * it is made as can widen or narrow the answer.
 *
 * @experimental
 */
export async function bindingFieldShapes(
  ref: BindingSourceRef,
  options: BindingFieldShapesOptions = {}
): Promise<readonly BindingFieldShape[] | undefined> {
  const source = sourceOf(ref);
  const asked = OPTIONS.safeParse(options);
  if (!asked.success) {
    throw NextlyError.invalidInput({
      message: "Field shapes take a language and nothing else.",
      logContext: { reason: "binding-shapes-options-invalid" },
    });
  }
  const { inReadLanguage, visitorFields } = await import("./visitor-fields");
  // The language is pinned inside the visitor frame, so the gate and every
  // field rule are told the page's language and nothing the caller set.
  return readAsVisitor(() =>
    inReadLanguage(asked.data.locale, async () => {
      const visible = await visitorFields(source);
      if (visible === undefined) return undefined;
      return Object.freeze(
        await fieldShapesOf(visible.fields, visible.readable)
      );
    })
  );
}
