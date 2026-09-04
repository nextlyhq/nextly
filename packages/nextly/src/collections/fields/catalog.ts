/**
 * The serializable field-type catalog: one description of every built-in
 * field type — its key, human label, picker category, one-line hint, and
 * Lucide icon name. Pure data with no runtime imports, safe to consume from
 * the browser, the server, and plugins alike.
 *
 * This is the single source of truth the admin's field pickers render from.
 * Surfaces narrow it to their allowed subset by key (user profile fields,
 * form fields, block props); none of them redeclare what a field type is.
 *
 * Icons are carried as Lucide icon *names*: the catalog stays serializable,
 * and each consumer resolves names against its own icon set.
 */

import { STORAGE_FORMAT } from "../../schemas/storage-format";

import type { FieldType } from "./types/base";

/**
 * Picker grouping, in display order: Basic → Advanced → Media → Relational →
 * Structured. Categories render as sticky headers; entries appear under
 * their header in catalog order.
 */
export type FieldTypeCategory =
  | "Basic"
  | "Advanced"
  | "Media"
  | "Relational"
  | "Structured";

/**
 * One catalog row describing a field type for pickers and docs. Generic over
 * the key so a surface's own types (see the user-surface entries below) carry
 * their narrower union end to end.
 */
export interface FieldTypeCatalogEntry<T extends string = FieldType> {
  /** The type key field instances reference. */
  type: T;
  /** Human label shown in pickers. */
  label: string;
  /** Picker grouping. */
  category: FieldTypeCategory;
  /** One-line description shown under the label. */
  hint: string;
  /** Lucide icon name, resolved by each consumer's icon set. */
  icon: string;
}

/** Every built-in field type, described once. */
export const FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry[] = [
  // Basic
  {
    type: "text",
    label: "Text",
    category: "Basic",
    hint: "Single-line input",
    icon: "Type",
  },
  {
    type: "textarea",
    label: "Long text",
    category: "Basic",
    hint: "Multi-line input",
    icon: "AlignLeft",
  },
  {
    type: "richText",
    label: "Editor",
    category: "Basic",
    hint: "Lexical rich-text editor",
    icon: "Edit",
  },
  {
    type: "email",
    label: "Email",
    category: "Basic",
    hint: "Validated email address",
    icon: "Mail",
  },
  {
    type: "password",
    label: "Password",
    category: "Basic",
    hint: "Hashed at rest",
    icon: "Lock",
  },
  {
    type: "number",
    label: "Number",
    category: "Basic",
    hint: "Integer or decimal",
    icon: "Hash",
  },
  // Advanced
  {
    type: "code",
    label: "Code",
    category: "Advanced",
    hint: "Code with syntax highlighting",
    icon: "Code",
  },
  {
    type: "date",
    label: "Date",
    category: "Advanced",
    hint: "Date or datetime",
    icon: "Calendar",
  },
  {
    type: "select",
    label: "Select",
    category: "Advanced",
    hint: "Dropdown of options",
    icon: "List",
  },
  {
    type: "radio",
    label: "Radio",
    category: "Advanced",
    hint: "One choice from a set",
    icon: "Circle",
  },
  {
    type: "checkbox",
    label: "Checkbox",
    category: "Advanced",
    hint: "Boolean rendered as a checkbox",
    icon: "CheckSquare",
  },
  {
    type: "json",
    label: "JSON",
    category: "Advanced",
    hint: "Raw JSON value",
    icon: "Braces",
  },
  {
    type: "chips",
    label: "Tags",
    category: "Advanced",
    hint: "Free-form list of strings",
    icon: "Tags",
  },
  // Media
  {
    type: "upload",
    label: "Media",
    category: "Media",
    hint: "File or image upload",
    icon: "Upload",
  },
  // Relational
  {
    type: "relationship",
    label: "Relationship",
    category: "Relational",
    hint: "Link to records in another collection",
    icon: "Link2",
  },
  // Structured
  {
    type: "repeater",
    label: "Repeater",
    category: "Structured",
    hint: "Repeating group of fields",
    icon: "Layers",
  },
  {
    type: "group",
    label: "Group",
    category: "Structured",
    hint: "Nested set of fields",
    icon: "FolderOpen",
  },
  {
    // `type` is the STORED value and deliberately still reads `component`; the label is what the
    // picker shows. Renaming the type would make every existing `fields` JSON row unreadable, so
    // the two are pinned apart by a test rather than left to be kept in step by hand.
    type: STORAGE_FORMAT.fieldType,
    label: "Field Group",
    category: "Structured",
    hint: "Embed a reusable field group",
    icon: "Puzzle",
  },
];

/**
 * The admin surfaces a field type can appear on. Each surface narrows the
 * visible type set independently: what a picker shows resolves as the
 * surface's own capability set ∩ the type's declared surfaces ∩ the host's
 * excludes — every level can only remove types, never force one in. Lives
 * here beside the surface catalogs so both the built-in surface types and
 * plugin-declared `surfaces` reference one definition.
 */
export type FieldSurface = "entries" | "users" | "forms" | "blocks";

/**
 * The surface a plugin field type targets when its author declares none. Shared
 * so the server-side gate and the client-side picker projection never diverge.
 */
export const DEFAULT_FIELD_SURFACES: readonly FieldSurface[] = ["entries"];

/**
 * Field types that exist only on specific admin surfaces. They are NOT part
 * of the canonical `FieldType` union: a collection cannot declare them, so
 * they can never reach the schema pipeline's column mappers. Their storage
 * is either text with validation semantics (url, phone, time, hidden) or the
 * surface's own blob handling (file inside a form's JSON).
 */
export type UserSurfaceFieldType = "url" | "phone";

/** Field types that exist only on the form-builder surface. */
export type FormSurfaceFieldType = "url" | "phone" | "file" | "time" | "hidden";

/**
 * Surface-only catalog entries, described once so every surface that admits
 * them shares one label/icon/hint. Slotted into per-surface catalogs below.
 */
const URL_SURFACE_ENTRY = {
  type: "url",
  label: "URL",
  category: "Basic",
  hint: "Validated web address",
  icon: "Globe",
} as const satisfies FieldTypeCatalogEntry<"url">;

const PHONE_SURFACE_ENTRY = {
  type: "phone",
  label: "Phone",
  category: "Basic",
  hint: "Phone number",
  icon: "Phone",
} as const satisfies FieldTypeCatalogEntry<"phone">;

const TIME_SURFACE_ENTRY = {
  type: "time",
  label: "Time",
  category: "Advanced",
  hint: "Time of day",
  icon: "Clock",
} as const satisfies FieldTypeCatalogEntry<"time">;

const FILE_SURFACE_ENTRY = {
  type: "file",
  label: "File upload",
  category: "Media",
  hint: "File attached by the visitor",
  icon: "Paperclip",
} as const satisfies FieldTypeCatalogEntry<"file">;

/**
 * What a surface-only type behaves as when its validation rules are asked for.
 *
 * The comment above already states this — url, phone, time and hidden store as
 * text with validation semantics — but stating it in prose left
 * `validationRulesForFieldType` unable to act on it, so every surface-only type
 * fell through to the two rules true of any field. A form's URL field then
 * offered no pattern, which is the one rule a URL field most obviously wants.
 *
 * Expressed as a storage primitive rather than as a rule list, so it rides the
 * mapping plugin-contributed types already use: declare what you persist as,
 * and inherit the rules of the built-in type that primitive behaves as. A
 * second list of rules here would be a second answer to a question
 * `FIELD_TYPE_VALIDATION_RULES` already owns.
 *
 * `file` is deliberately absent: its storage is the surface's own blob
 * handling, not text, so it correctly takes only what is true of every field.
 */
const SURFACE_FIELD_TYPE_STORAGE: Readonly<
  Partial<Record<string, FieldStoragePrimitive>>
> = {
  url: "text",
  phone: "text",
  time: "text",
  hidden: "text",
};

const HIDDEN_SURFACE_ENTRY = {
  type: "hidden",
  label: "Hidden",
  category: "Advanced",
  hint: "Invisible value submitted with the form",
  icon: "EyeOff",
} as const satisfies FieldTypeCatalogEntry<"hidden">;

/** The user-profile surface's field types: flat scalars plus url/phone. */
export type UserFieldCatalogType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "url"
  | "phone"
  | "select"
  | "radio"
  | "checkbox"
  | "date";

/**
 * The user-profile picker's catalog: the flat-scalar subset of the shared
 * catalog with the two user-surface types slotted beside email, where a
 * profile author expects contact-shaped fields together.
 */
export const USER_FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry<UserFieldCatalogType>[] =
  (() => {
    const scalars = narrowFieldTypeCatalog([
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ] as const);
    const combined: FieldTypeCatalogEntry<UserFieldCatalogType>[] = [];
    for (const entry of scalars) {
      combined.push(entry);
      if (entry.type === "email") {
        combined.push(URL_SURFACE_ENTRY, PHONE_SURFACE_ENTRY);
      }
    }
    return combined;
  })();

/** The form-builder surface's field types: flat inputs plus its own five. */
export type FormFieldCatalogType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "url"
  | "phone"
  | "select"
  | "radio"
  | "checkbox"
  | "date"
  | "time"
  | "file"
  | "hidden";

/**
 * The form-builder picker's catalog: the flat-input subset of the shared
 * catalog plus the form-surface types — url/phone beside email (contact
 * shapes together, matching the user surface), time beside date, and
 * file/hidden appended in their own categories. Form fields live in the
 * form's JSON blob, so none of these touch the schema pipeline.
 */
export const FORM_FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry<FormFieldCatalogType>[] =
  (() => {
    const scalars = narrowFieldTypeCatalog([
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ] as const);
    const combined: FieldTypeCatalogEntry<FormFieldCatalogType>[] = [];
    for (const entry of scalars) {
      combined.push(entry);
      if (entry.type === "email") {
        combined.push(URL_SURFACE_ENTRY, PHONE_SURFACE_ENTRY);
      }
      if (entry.type === "date") {
        combined.push(TIME_SURFACE_ENTRY);
      }
    }
    combined.push(HIDDEN_SURFACE_ENTRY, FILE_SURFACE_ENTRY);
    return combined;
  })();

/**
 * The block-prop surface's field types: everything a collection can declare
 * except two deliberate exclusions.
 *
 * - `password` is excluded because a block document is public page content
 *   rendered to every visitor, so a secret must never be authorable as a
 *   block prop.
 * - `component` is excluded because reusable composition inside a block
 *   document happens through slots and component-instance nodes; admitting the
 *   component field type as well would give one concept two storage shapes.
 * - `blocks` is excluded because a prop holding a whole nested document is
 *   what slots already express, and nesting documents inside documents would
 *   put two migration boundaries in one value.
 *
 * Link-shaped props keep using `text` until the dedicated link picker joins
 * the catalog with its admin component.
 */
export type BlockFieldCatalogType = Exclude<
  FieldType,
  "password" | "component" | "fieldGroup"
>;

/** Every block-prop field type, in catalog order. */
export const BLOCK_FIELD_TYPES: readonly BlockFieldCatalogType[] = [
  "text",
  "textarea",
  "richText",
  "email",
  "number",
  "code",
  "date",
  "select",
  "radio",
  "checkbox",
  "json",
  "chips",
  "upload",
  "relationship",
  "repeater",
  "group",
];

/**
 * The block-prop picker's catalog: the shared catalog narrowed to the types a
 * block prop may declare. Unlike the user and form surfaces it adds no
 * surface-only types, so every entry here maps to a real `FieldConfig`.
 */
export const BLOCK_FIELD_TYPE_CATALOG: readonly FieldTypeCatalogEntry<BlockFieldCatalogType>[] =
  narrowFieldTypeCatalog(BLOCK_FIELD_TYPES);

/** Whether a field type may be declared as a block prop. */
export function isBlockFieldType(type: string): type is BlockFieldCatalogType {
  return (BLOCK_FIELD_TYPES as readonly string[]).includes(type);
}

/**
 * The storage shapes a plugin-contributed field type can persist as. A plugin
 * type is not a member of the built-in union, so everything that needs to
 * reason about its values (validation, bindings) goes through the primitive it
 * declared.
 */
export type FieldStoragePrimitive =
  | "text"
  | "longText"
  | "boolean"
  | "number"
  | "timestamp"
  | "json";

/**
 * The built-in field type each storage primitive behaves as. A plugin type
 * validates by its primitive's rules and binds by its primitive's value kind,
 * while its own admin component renders it.
 */
export const STORAGE_PRIMITIVE_AS_FIELD_TYPE: Readonly<
  Record<FieldStoragePrimitive, BlockFieldCatalogType>
> = {
  text: "text",
  longText: "textarea",
  boolean: "checkbox",
  number: "number",
  timestamp: "date",
  json: "json",
};

/**
 * The value shapes a binding can carry. A binding connects a data field to a
 * block prop, so both sides are described in this one vocabulary and
 * compatibility is a set membership test rather than a per-pair table.
 */
export type BindingValueKind =
  | "text"
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
 * The kind of value a field of each type produces when it is a binding
 * SOURCE. `null` means the type cannot be bound from at all: `password` never
 * leaves the server, `component` and `group` are containers whose parts are
 * bound individually, and a `repeater` is a to-many collection that a loop
 * iterates rather than a binding flattens.
 */
export const FIELD_TYPE_BINDING_KIND: Readonly<
  Record<FieldType, BindingValueKind | null>
> = {
  text: "text",
  textarea: "text",
  richText: "richText",
  email: "text",
  password: null,
  code: "text",
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
  // A field group binds like a component: its parts are bound individually,
  // never the whole container.
  fieldGroup: null,
  chips: "list",
};

/**
 * The validation rules a field can carry, named as `FieldValidation` spells
 * them. `FieldValidation` permits every member on every field, because it is
 * one record shared by all types; which of them MEAN anything for a given type
 * is the separate question this vocabulary exists to answer.
 */
export type FieldValidationRule =
  | "required"
  | "pattern"
  | "message"
  | "minLength"
  | "maxLength"
  | "min"
  | "max"
  | "minRows"
  | "maxRows";

/**
 * Which validation rules are meaningful for each field type.
 *
 * A length bound says nothing about a checkbox and a numeric bound says nothing
 * about a string, so an editor that offers every rule everywhere invites values
 * that nothing will ever read. `Record<FieldType, …>` makes the map exhaustive
 * by construction: a new member of the union does not compile until it states
 * its rules, which is the property that keeps this from drifting behind the
 * types the way a hand-kept list does.
 *
 * `required` is meaningful for every type and is listed for every type, because
 * this map describes the field rather than any one editor's layout. A surface
 * that presents requiredness through its own control renders the rest of the
 * list and skips this member.
 */
export const FIELD_TYPE_VALIDATION_RULES: Readonly<
  Record<FieldType, readonly FieldValidationRule[]>
> = {
  text: ["required", "minLength", "maxLength", "pattern", "message"],
  // Multi-line text is bounded by characters like other text, and by rows as a
  // repeating container.
  textarea: [
    "required",
    "minLength",
    "maxLength",
    "pattern",
    "minRows",
    "maxRows",
    "message",
  ],
  richText: [
    "required",
    "minLength",
    "maxLength",
    "pattern",
    "minRows",
    "maxRows",
    "message",
  ],
  email: ["required", "minLength", "maxLength", "pattern", "message"],
  password: ["required", "minLength", "maxLength", "pattern", "message"],
  code: ["required", "minLength", "maxLength", "pattern", "message"],
  number: ["required", "min", "max", "message"],
  // A date is ordered, so it bounds by value rather than by length.
  date: ["required", "min", "max", "message"],
  checkbox: ["required", "message"],
  select: ["required", "message"],
  radio: ["required", "message"],
  upload: ["required", "message"],
  relationship: ["required", "message"],
  // A repeater holds rows and nothing else measurable at this level; the fields
  // inside it carry their own rules.
  repeater: ["required", "minRows", "maxRows", "message"],
  group: ["required", "message"],
  json: ["required", "message"],
  component: ["required", "message"],
  fieldGroup: ["required", "message"],
  chips: ["required", "message"],
};

/**
 * The rules meaningful for a field, including one contributed by a plugin.
 *
 * A plugin type is not a member of `FieldType`, so it cannot key the map. It
 * declares the primitive it persists as, and `STORAGE_PRIMITIVE_AS_FIELD_TYPE`
 * already names the built-in type that primitive behaves as — so a plugin type
 * inherits that type's rules rather than needing its own entry, and a plugin
 * shipped after this code was written is covered without editing anything here.
 */
export function validationRulesForFieldType(
  type: string,
  pluginStorage?: FieldStoragePrimitive
): readonly FieldValidationRule[] {
  if (type in FIELD_TYPE_VALIDATION_RULES) {
    return FIELD_TYPE_VALIDATION_RULES[type as FieldType];
  }
  if (pluginStorage) {
    return FIELD_TYPE_VALIDATION_RULES[
      STORAGE_PRIMITIVE_AS_FIELD_TYPE[pluginStorage]
    ];
  }
  // A surface-only type is not in the canonical union, but it does say what it
  // stores as, which is enough to answer through the same mapping.
  const surfaceStorage = SURFACE_FIELD_TYPE_STORAGE[type];
  if (surfaceStorage) {
    return FIELD_TYPE_VALIDATION_RULES[
      STORAGE_PRIMITIVE_AS_FIELD_TYPE[surfaceStorage]
    ];
  }
  // An unknown type with no declared primitive: offer only what is true of
  // every field, rather than guessing at a vocabulary it may not honour.
  return ["required", "message"];
}

/**
 * The value kinds each block-prop type accepts from a binding. This map IS the
 * bindability rule: a prop's binding affordance is derived from its declared
 * TYPE and never from a per-block opt-in, so a new block gets binding support
 * on every compatible prop the moment it is written.
 *
 * String-valued props accept numbers and dates because a binding carries an
 * optional formatter that renders them as text. Rich text accepts only rich
 * text: its stored value is structured editor content, and a plain string
 * would not survive the round trip. Structured props (`repeater`, `group`) are
 * composed rather than bound, so they accept nothing.
 */
export const BINDABLE_KINDS: Readonly<
  Record<BlockFieldCatalogType, readonly BindingValueKind[]>
> = {
  text: ["text", "option", "number", "date"],
  textarea: ["text", "option", "number", "date"],
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
  upload: ["media"],
  relationship: ["reference"],
  repeater: [],
  group: [],
};

/**
 * One end of a candidate binding: a field being bound from, or a block prop
 * being bound into.
 *
 * `hasMany` matters because a multi-valued field produces an array, so type
 * agreement alone does not make two ends compatible. `storage` describes a
 * plugin-contributed type, which is not a member of the built-in union but
 * persists as one of the primitives; supplying it lets a plugin type take part
 * in bindings on the same terms as a built-in. `relationTo` carries the
 * collection identity of a reference or media endpoint, which the value kind
 * alone does not express.
 */
export interface BindingEndpoint {
  type: string;
  hasMany?: boolean;
  storage?: FieldStoragePrimitive;
  relationTo?: string | string[];
}

/**
 * The built-in field type an endpoint resolves to, or `null` when the type is
 * neither a built-in nor a plugin type whose storage primitive was supplied.
 */
function resolveEndpointType(endpoint: BindingEndpoint): FieldType | null {
  if (isFieldType(endpoint.type)) return endpoint.type;
  return endpoint.storage
    ? STORAGE_PRIMITIVE_AS_FIELD_TYPE[endpoint.storage]
    : null;
}

/**
 * The value kind an endpoint produces when it is a binding source, or `null`
 * when it cannot be bound from.
 */
export function bindingKindOf(
  endpoint: BindingEndpoint
): BindingValueKind | null {
  const resolved = resolveEndpointType(endpoint);
  return resolved ? FIELD_TYPE_BINDING_KIND[resolved] : null;
}

/** Whether a block prop can be bound to a data field at all. */
export function isBindablePropType(prop: BindingEndpoint): boolean {
  const resolved = resolveEndpointType(prop);
  return (
    resolved !== null &&
    isBlockFieldType(resolved) &&
    BINDABLE_KINDS[resolved].length > 0
  );
}

/**
 * Whether a field can be bound into a block prop. Pickers use this to filter
 * the field list they offer, so a user is never shown a binding that the
 * renderer would then have to coerce.
 *
 * Both the value kind and the cardinality must agree: a multi-valued source
 * produces an array, which a single-valued prop cannot render, and a
 * single-valued source cannot fill a prop that expects a list.
 *
 * Reference and media endpoints must also agree on the collections they point
 * at, and on how a reference to them is stored. Binding does not rewrite a
 * reference, so a source that can yield a document the prop does not relate
 * to would put an unresolvable value in the prop even though both ends are of
 * kind `reference`, and a source whose target arity differs stores a shape the
 * prop cannot read. The checks apply only when both ends name their targets,
 * since an endpoint that omits them is saying nothing about collection
 * identity rather than claiming to accept any.
 */
export function canBindFieldToProp(
  source: BindingEndpoint,
  prop: BindingEndpoint
): boolean {
  const propType = resolveEndpointType(prop);
  if (propType === null || !isBlockFieldType(propType)) return false;
  if (Boolean(source.hasMany) !== Boolean(prop.hasMany)) return false;
  const kind = bindingKindOf(source);
  if (kind === null || !BINDABLE_KINDS[propType].includes(kind)) return false;
  return targetsAreCompatible(source, prop);
}

/**
 * Whether every collection the source can yield is one the prop accepts, and
 * whether both ends store a reference the same way. An endpoint without
 * declared targets is not checked.
 *
 * Target arity decides the stored shape — a single target stores a bare id, a
 * list of targets stores a `{ relationTo, value }` pair — so two endpoints
 * that name the same collection still hold incompatible values when one
 * declares it as a string and the other as a one-element array.
 */
function targetsAreCompatible(
  source: BindingEndpoint,
  prop: BindingEndpoint
): boolean {
  if (source.relationTo === undefined || prop.relationTo === undefined) {
    return true;
  }
  if (Array.isArray(source.relationTo) !== Array.isArray(prop.relationTo)) {
    return false;
  }
  const propTargets = targetList(prop.relationTo);
  return targetList(source.relationTo).every(target =>
    propTargets.includes(target)
  );
}

function targetList(relationTo: string | string[] | undefined): string[] {
  if (relationTo === undefined) return [];
  return Array.isArray(relationTo) ? relationTo : [relationTo];
}

/** Narrowing guard for the built-in field-type union. */
function isFieldType(type: string): type is FieldType {
  return Object.prototype.hasOwnProperty.call(FIELD_TYPE_BINDING_KIND, type);
}

/** Look up one catalog entry by its type key. */
export function getFieldTypeCatalogEntry(
  type: FieldType
): FieldTypeCatalogEntry | undefined {
  return FIELD_TYPE_CATALOG.find(entry => entry.type === type);
}

/**
 * Narrow the catalog to a surface's allowed types, preserving catalog order.
 * The result's `type` is narrowed to the requested subset, so a surface with
 * its own type union (e.g. user profile fields) keeps it end to end.
 */
export function narrowFieldTypeCatalog<T extends FieldType>(
  types: readonly T[]
): Array<FieldTypeCatalogEntry & { type: T }> {
  const allowed: ReadonlySet<string> = new Set(types);
  return FIELD_TYPE_CATALOG.filter(
    (entry): entry is FieldTypeCatalogEntry & { type: T } =>
      allowed.has(entry.type)
  );
}
