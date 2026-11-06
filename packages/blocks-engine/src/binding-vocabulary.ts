/**
 * The binding vocabulary: which kind of value each field type produces, which
 * kinds each prop type accepts, and how a plugin's field type takes part
 * through the storage primitive it persists as.
 *
 * One table each, and the only ones. An editor's picker asks
 * {@link canBindFieldToProp} which fields to offer for a prop; the renderer
 * asks the same question and then whether the value fills the prop as it is
 * (`binding-rules`), so a binding the picker offers and a binding the page can
 * draw are judged by one rule.
 *
 * The names are the field catalog's, so the CMS publishes these rather than a
 * second copy.
 *
 * @module binding-vocabulary
 */

/**
 * The storage shapes a plugin-contributed field type can persist as. A plugin
 * type is not a built-in, so binding reasons about it through the primitive it
 * declared.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type FieldStoragePrimitive =
  | "text"
  | "longText"
  | "boolean"
  | "number"
  | "timestamp"
  | "json";

/**
 * The built-in field types a storage primitive behaves as.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type StorageFieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "number"
  | "date"
  | "json";

/**
 * The built-in field type each storage primitive behaves as.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const STORAGE_PRIMITIVE_AS_FIELD_TYPE: Readonly<
  Record<FieldStoragePrimitive, StorageFieldType>
> = {
  text: "text",
  longText: "textarea",
  boolean: "checkbox",
  number: "number",
  timestamp: "date",
  json: "json",
};

/**
 * The value shapes a binding can carry. A binding connects a field to a prop,
 * so both sides are described in this one vocabulary and compatibility is a
 * set membership test.
 *
 * `url` is an address: it is text to a text prop, and the one text a link or
 * an image may be filled from.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindingValueKind =
  | "text"
  | "url"
  | "richText"
  | "number"
  | "boolean"
  | "date"
  | "media"
  | "option"
  | "reference"
  | "list"
  | "json";

/**
 * The kind of value a field of each type produces as a binding source. `null`
 * means it cannot be bound from: `password` never leaves the server, a group,
 * a component or a field group is bound by its parts, and a repeater is a
 * to-many collection a list iterates. A type not listed is unbindable unless
 * it declares a storage primitive.
 *
 * @experimental Settles with the editor's binding controls.
 */
/**
 * The field types the binding vocabulary knows.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindingFieldType =
  | StorageFieldType
  | "richText"
  | "email"
  | "password"
  | "code"
  | "icon"
  | "select"
  | "radio"
  | "upload"
  | "relationship"
  | "repeater"
  | "group"
  | "component"
  | "fieldGroup"
  | "chips"
  | "url"
  | "phone"
  | "file";

export const FIELD_TYPE_BINDING_KIND: Readonly<
  Record<BindingFieldType, BindingValueKind | null>
> = {
  text: "text",
  textarea: "text",
  richText: "richText",
  email: "text",
  password: null,
  code: "text",
  // An icon id ("lucide:star") is a short string and binds as text.
  icon: "text",
  number: "number",
  checkbox: "boolean",
  date: "date",
  select: "option",
  radio: "option",
  upload: "media",
  relationship: "reference",
  repeater: null,
  group: null,
  json: "json",
  component: null,
  fieldGroup: null,
  chips: "list",
  url: "url",
  phone: "text",
  file: "media",
};

/**
 * A prop type a binding can be judged against.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindablePropType =
  | StorageFieldType
  | "richText"
  | "email"
  | "code"
  | "select"
  | "radio"
  | "chips"
  | "upload"
  | "media"
  | "url"
  | "link"
  | "relationship"
  | "repeater"
  | "group";

/**
 * The value kinds each prop type accepts from a binding. A prop's
 * bindability is read from its declared type here and never from a per-block
 * opt-in, so every block gets bindings on every prop of a bindable type.
 *
 * A text prop accepts numbers and dates because a binding carries a format
 * that renders them as text; without one they do not fill it. Rich text
 * accepts only rich text. An image (`media`, or `upload` as the field catalog
 * names it) accepts a media field or a URL field and no other text, and a link
 * only a URL field. Structured props are composed rather than bound.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const BINDABLE_KINDS: Readonly<
  Record<BindablePropType, readonly BindingValueKind[]>
> = {
  text: ["text", "url", "option", "number", "date"],
  textarea: ["text", "url", "option", "number", "date"],
  richText: ["richText"],
  email: ["text"],
  number: ["number"],
  code: ["text"],
  date: ["date"],
  select: ["option", "text"],
  radio: ["option", "text"],
  checkbox: ["boolean"],
  json: ["json"],
  chips: ["list"],
  upload: ["media", "url"],
  media: ["media", "url"],
  url: ["url"],
  link: ["url"],
  relationship: ["reference"],
  repeater: [],
  group: [],
};

/**
 * One end of a candidate binding: a field bound from, or a prop bound into.
 *
 * `hasMany` matters because a multi-valued field produces a list. `storage`
 * lets a plugin's type take part through its primitive. `relationTo` names
 * the collections a reference or media end points at.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingEndpoint {
  readonly type: string;
  readonly hasMany?: boolean;
  readonly storage?: FieldStoragePrimitive;
  readonly relationTo?: string | readonly string[];
}

/** Whether a key is one of a record's own, so stored names cannot reach the prototype. */
function ownKey<T extends object>(
  record: T,
  key: string
): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** The field type an endpoint is judged as: its own, else its primitive's. */
function fieldTypeOf(endpoint: BindingEndpoint): BindingFieldType | undefined {
  if (ownKey(FIELD_TYPE_BINDING_KIND, endpoint.type)) return endpoint.type;
  return endpoint.storage === undefined
    ? undefined
    : STORAGE_PRIMITIVE_AS_FIELD_TYPE[endpoint.storage];
}

/**
 * The prop type an endpoint is judged as: its own, else its primitive's, or
 * nothing for a type no binding can fill.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindablePropTypeOf(
  endpoint: BindingEndpoint
): BindablePropType | undefined {
  if (ownKey(BINDABLE_KINDS, endpoint.type)) return endpoint.type;
  return endpoint.storage === undefined
    ? undefined
    : STORAGE_PRIMITIVE_AS_FIELD_TYPE[endpoint.storage];
}

/**
 * The kind of value an endpoint produces as a binding source, or `null` when
 * it cannot be bound from.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindingKindOf(
  endpoint: BindingEndpoint
): BindingValueKind | null {
  const type = fieldTypeOf(endpoint);
  return type === undefined ? null : FIELD_TYPE_BINDING_KIND[type];
}

/** The collections an endpoint names, as a list. */
function targetList(relationTo: string | readonly string[]): readonly string[] {
  return typeof relationTo === "string" ? [relationTo] : relationTo;
}

/**
 * Whether every collection the source can yield is one the prop accepts, and
 * both store a reference the same way: a single target stores a bare id, a
 * list of targets a `{ relationTo, value }` pair. Not judged when either end
 * names no targets, since that says nothing about collections.
 */
function targetsAgree(source: BindingEndpoint, prop: BindingEndpoint): boolean {
  if (source.relationTo === undefined || prop.relationTo === undefined) {
    return true;
  }
  if (Array.isArray(source.relationTo) !== Array.isArray(prop.relationTo)) {
    return false;
  }
  const accepted = targetList(prop.relationTo);
  return targetList(source.relationTo).every(target =>
    accepted.includes(target)
  );
}

/**
 * Whether a field can be bound into a prop at all: the question a picker asks
 * to decide which fields to offer.
 *
 * The value kind and the cardinality must agree, and reference and media ends
 * must agree on their targets. A number or a date can be bound into a text
 * prop, because the binding carries a format; whether a value fills the prop
 * as it is, without one, is the renderer's further question.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function canBindFieldToProp(
  source: BindingEndpoint,
  prop: BindingEndpoint
): boolean {
  const propType = bindablePropTypeOf(prop);
  if (propType === undefined) return false;
  if (Boolean(source.hasMany) !== Boolean(prop.hasMany)) return false;
  const kind = bindingKindOf(source);
  if (kind === null) return false;
  const accepted: readonly BindingValueKind[] = BINDABLE_KINDS[propType];
  return accepted.includes(kind) && targetsAgree(source, prop);
}
