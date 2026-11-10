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

// The binding vocabulary is the page-builder engine's: which kind of value
// each field type produces, and which kinds each prop type accepts. The engine
// is the lower package (this one depends on it, never the reverse), and its
// renderer and validator judge every binding with these tables, so the
// catalog republishes them rather than keeping a copy that could disagree
// with what a published page draws. `/format` is the engine's parser-free
// entry: the tables cost the catalog no compiler.
import {
  BINDABLE_KINDS as ENGINE_BINDABLE_KINDS,
  FIELD_TYPE_BINDING_KIND as ENGINE_FIELD_TYPE_BINDING_KIND,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE as ENGINE_STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  bindablePropTypeOf,
  type BindingValueKind,
  type FieldStoragePrimitive,
} from "@nextlyhq/blocks-engine/format";

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
  /**
   * The type's one plain name, in sentence case, shown wherever the type is
   * named (pickers, outlines, settings, review). Never the internal type id:
   * that is what stored data uses, not what a person reads.
   */
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
    label: "Rich text",
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
  {
    type: "icon",
    label: "Icon",
    category: "Basic",
    hint: "An icon from the site's icon sets",
    icon: "Star",
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
    label: "Image or file",
    category: "Media",
    hint: "An uploaded file or image",
    icon: "Upload",
  },
  // Relational
  {
    type: "relationship",
    label: "Link to entries",
    category: "Relational",
    hint: "Link to records in another collection",
    icon: "Link2",
  },
  // Structured
  {
    type: "repeater",
    label: "Repeating rows",
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
    label: "Field group",
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
 * @experimental What every setting a plugin field type declares carries.
 *
 * `key` is where the value is stored on a field of the type: inside its
 * `pluginOptions`, the container the Schema Builder keeps a type's own options
 * in, so a key never competes with a name the field schema declares. `type`
 * and `name` are refused, because a field restates them as its own identity.
 */
export interface PluginFieldTypeSettingBase {
  /** Where the value is stored: `pluginOptions[key]`. Letters, digits and `_`, starting with a letter. */
  key: string;
  /** The setting's name in the settings panel. */
  label: string;
  /** A line under it saying what it does. */
  help?: string;
  /**
   * The tab it is drawn in. `"general"` (the default) draws it first in
   * General, as one of the settings that make a field this type.
   */
  tab?: "general" | "validation" | "display" | "advanced";
}

/**
 * @experimental A setting a plugin field type declares, drawn in the shared
 * settings panel for every field of the type and stored in its
 * `pluginOptions`. `text` stores a string, `number` a number, `boolean` true
 * or false, and `select` the `value` of the option chosen.
 */
export type PluginFieldTypeSetting =
  | (PluginFieldTypeSettingBase & { control: "text" | "number" | "boolean" })
  | (PluginFieldTypeSettingBase & {
      control: "select";
      /** The choices, at least one, each `value` once. */
      options: readonly { label: string; value: string }[];
    });

/**
 * A plugin field type as the admin receives it in `/admin-meta`: the editor
 * component path, the storage primitive (which decides binding
 * compatibility), the picker presentation, the `surfaces` the type opted into,
 * the `"takeover"` layout hint, and the settings the type declares. Declared
 * here, beside the types it is made of, so the server that serves it and the
 * admin that reads it share one shape.
 */
export interface PluginFieldTypeMeta {
  type: string;
  component: string;
  storage: FieldStoragePrimitive;
  layout?: "takeover";
  label?: string;
  description?: string;
  icon?: string;
  category?: FieldTypeCategory;
  surfaces?: readonly FieldSurface[];
  /** The type's own settings, drawn in the settings panel; checked at boot. */
  settings?: readonly PluginFieldTypeSetting[];
}

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
 * - `icon` is excluded for now: the icon block prop arrives with the Icon
 *   block, together with its prop builder, and until then a block cannot
 *   declare one.
 *
 * Link-shaped props keep using `text` until the dedicated link picker joins
 * the catalog with its admin component.
 */
export type BlockFieldCatalogType = Exclude<
  FieldType,
  "password" | "component" | "fieldGroup" | "icon"
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

// Which repeaters get a saved row id, for the admin's new rows: the rule the
// server gives ids by, read where the admin reads the catalog.
export { declaresOwnId } from "./repeater-row-identity";

// The engine's own functions, not wrappers: `bindingKindOf` answers the kind
// a field produces, and `canBindFieldToProp` whether a field fits a prop, by
// the one table the renderer and validator read. Each takes any
// `BindingEndpoint` below.
export {
  bindingKindOf,
  canBindFieldToProp,
  type BindingValueKind,
  type FieldStoragePrimitive,
} from "@nextlyhq/blocks-engine/format";

/**
 * The built-in field type each storage primitive behaves as. A plugin type
 * validates by its primitive's rules and binds by its primitive's value kind,
 * while its own admin component renders it. The engine's table, typed as the
 * block-prop types its values all are.
 */
export const STORAGE_PRIMITIVE_AS_FIELD_TYPE: Readonly<
  Record<FieldStoragePrimitive, BlockFieldCatalogType>
> = ENGINE_STORAGE_PRIMITIVE_AS_FIELD_TYPE;

/**
 * The kind of value a field of each type produces when it is a binding
 * SOURCE, for the canonical field types. `null` means the type cannot be
 * bound from at all: `password` never leaves the server, `component`, a field
 * group and `group` are containers whose parts are bound individually, and a
 * `repeater` is a to-many collection that a loop iterates rather than a
 * binding flattens.
 *
 * Each value is read from the engine's table; only the key set is this
 * package's, so a canonical type the engine does not know fails to compile
 * here rather than binding by a rule of its own.
 */
export const FIELD_TYPE_BINDING_KIND: Readonly<
  Record<FieldType, BindingValueKind | null>
> = Object.freeze({
  text: ENGINE_FIELD_TYPE_BINDING_KIND.text,
  textarea: ENGINE_FIELD_TYPE_BINDING_KIND.textarea,
  richText: ENGINE_FIELD_TYPE_BINDING_KIND.richText,
  email: ENGINE_FIELD_TYPE_BINDING_KIND.email,
  password: ENGINE_FIELD_TYPE_BINDING_KIND.password,
  code: ENGINE_FIELD_TYPE_BINDING_KIND.code,
  icon: ENGINE_FIELD_TYPE_BINDING_KIND.icon,
  number: ENGINE_FIELD_TYPE_BINDING_KIND.number,
  checkbox: ENGINE_FIELD_TYPE_BINDING_KIND.checkbox,
  date: ENGINE_FIELD_TYPE_BINDING_KIND.date,
  select: ENGINE_FIELD_TYPE_BINDING_KIND.select,
  radio: ENGINE_FIELD_TYPE_BINDING_KIND.radio,
  upload: ENGINE_FIELD_TYPE_BINDING_KIND.upload,
  relationship: ENGINE_FIELD_TYPE_BINDING_KIND.relationship,
  repeater: ENGINE_FIELD_TYPE_BINDING_KIND.repeater,
  group: ENGINE_FIELD_TYPE_BINDING_KIND.group,
  json: ENGINE_FIELD_TYPE_BINDING_KIND.json,
  component: ENGINE_FIELD_TYPE_BINDING_KIND.component,
  fieldGroup: ENGINE_FIELD_TYPE_BINDING_KIND.fieldGroup,
  chips: ENGINE_FIELD_TYPE_BINDING_KIND.chips,
});

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
  // An icon is picked, never typed, and its id shape is checked by the type
  // itself, so length and pattern bounds say nothing a person could act on.
  icon: ["required", "message"],
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
 *
 * Each entry is the engine's own list for that prop type, so the picker and
 * the renderer accept the same kinds.
 */
export const BINDABLE_KINDS: Readonly<
  Record<BlockFieldCatalogType, readonly BindingValueKind[]>
> = Object.freeze({
  text: ENGINE_BINDABLE_KINDS.text,
  textarea: ENGINE_BINDABLE_KINDS.textarea,
  richText: ENGINE_BINDABLE_KINDS.richText,
  email: ENGINE_BINDABLE_KINDS.email,
  number: ENGINE_BINDABLE_KINDS.number,
  code: ENGINE_BINDABLE_KINDS.code,
  date: ENGINE_BINDABLE_KINDS.date,
  select: ENGINE_BINDABLE_KINDS.select,
  radio: ENGINE_BINDABLE_KINDS.radio,
  checkbox: ENGINE_BINDABLE_KINDS.checkbox,
  json: ENGINE_BINDABLE_KINDS.json,
  chips: ENGINE_BINDABLE_KINDS.chips,
  upload: ENGINE_BINDABLE_KINDS.upload,
  relationship: ENGINE_BINDABLE_KINDS.relationship,
  repeater: ENGINE_BINDABLE_KINDS.repeater,
  group: ENGINE_BINDABLE_KINDS.group,
});

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
 *
 * Every endpoint of this shape is one the engine's `bindingKindOf` and
 * `canBindFieldToProp` take, which `isBindablePropType` below holds at
 * compile time by handing it to the engine.
 */
export interface BindingEndpoint {
  type: string;
  hasMany?: boolean;
  storage?: FieldStoragePrimitive;
  relationTo?: string | string[];
}

/**
 * Whether a block prop can be bound to a data field at all: its type, or a
 * plugin type's storage primitive, is one the engine accepts some kind of
 * value into.
 */
export function isBindablePropType(prop: BindingEndpoint): boolean {
  const propType = bindablePropTypeOf(prop);
  return propType !== undefined && ENGINE_BINDABLE_KINDS[propType].length > 0;
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

/**
 * The order the picker's categories appear in, as the category type's comment
 * describes it. A category a plugin declares outside this list still shows,
 * after these, so a mistyped category never hides a type.
 */
export const FIELD_TYPE_CATEGORY_ORDER: readonly FieldTypeCategory[] = [
  "Basic",
  "Advanced",
  "Media",
  "Relational",
  "Structured",
];

/**
 * The types the picker shows first, before the categories, in this order. A
 * surface that offers none of them shows no most-used group.
 */
export const MOST_USED_FIELD_TYPES: readonly FieldType[] = [
  "text",
  "richText",
  "upload",
  "relationship",
  "select",
  "date",
];

/**
 * A field type as the picker describes and searches it: the catalog row plus
 * the other words a person may type for it.
 *
 * Kept a separate type rather than a new member of `FieldTypeCatalogEntry`,
 * because that row is published in the shape plugins already consume and a
 * new member would change it for every one of them.
 */
export interface FieldTypeDescription<T extends string = FieldType>
  extends FieldTypeCatalogEntry<T> {
  /**
   * Words that find this type besides its name, description and category:
   * the type id first (the name developers use), then the names earlier
   * versions of Nextly showed, then everyday words for what it holds.
   */
  synonyms: readonly string[];
}

/**
 * The extra search words for each type, besides its id. Keyed by every type a
 * surface can offer, so a type added to the union does not compile until it
 * says what else a person might call it.
 */
const FIELD_TYPE_SYNONYMS: Readonly<
  Record<
    FieldType | UserSurfaceFieldType | FormSurfaceFieldType,
    readonly string[]
  >
> = {
  text: ["string", "title", "name", "heading", "short text"],
  textarea: ["paragraph", "multi-line", "excerpt", "summary", "plain text"],
  // "Editor" is what the picker called this before it was named rich text.
  richText: ["editor", "wysiwyg", "body", "content", "markdown", "html"],
  email: ["mail", "e-mail", "contact"],
  password: ["secret", "credential"],
  number: ["integer", "decimal", "float", "price", "amount", "count"],
  code: ["snippet", "script", "embed", "source"],
  icon: ["symbol", "glyph", "emoji", "pictogram"],
  date: ["time", "datetime", "calendar", "day", "timestamp"],
  select: ["dropdown", "choice", "option", "enum"],
  radio: ["radio buttons", "choice", "option", "one of"],
  checkbox: ["boolean", "toggle", "switch", "yes or no", "true or false"],
  json: ["raw", "object", "data"],
  chips: ["tags", "keywords", "labels"],
  // "Media" is this type's earlier name; image, photo and file are what
  // people look for.
  upload: ["media", "image", "photo", "picture", "file", "attachment", "pdf"],
  // "Relationship" is this type's earlier name and its id.
  relationship: ["relation", "reference", "link", "foreign key", "author"],
  // "Repeater" is this type's earlier name and its id.
  repeater: ["array", "list", "rows", "repeat"],
  group: ["object", "section", "nested", "fieldset"],
  // A field group is stored under two spellings; both, and the word the
  // admin used before "field group", find it.
  component: ["fieldGroup", "field group", "reusable"],
  fieldGroup: ["component", "field group", "reusable"],
  url: ["link", "website", "web address", "href"],
  phone: ["telephone", "mobile", "cell"],
  time: ["clock", "hour", "minute"],
  file: ["upload", "attachment", "document"],
  hidden: ["invisible", "tracking", "utm"],
};

/**
 * Describe catalog rows for the picker: each row as it is, plus its search
 * words. The one place a description is made, for built-in, surface-only and
 * plugin rows alike; a type with no entry above (a plugin's) is found by its
 * id as well as its name, description and category.
 */
export function describeFieldTypes<T extends string>(
  entries: readonly FieldTypeCatalogEntry<T>[]
): FieldTypeDescription<T>[] {
  return entries.map(entry => {
    const extra = Object.prototype.hasOwnProperty.call(
      FIELD_TYPE_SYNONYMS,
      entry.type
    )
      ? FIELD_TYPE_SYNONYMS[entry.type as keyof typeof FIELD_TYPE_SYNONYMS]
      : [];
    return { ...entry, synonyms: [entry.type, ...extra] };
  });
}
