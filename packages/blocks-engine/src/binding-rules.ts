/**
 * The rules a binding is checked against before its value is used.
 *
 * A binding names a prop, a source and a field path. Whether it can work
 * depends on three things the stored document does not hold: the block's
 * props, the source's fields, and the format's options. This module answers
 * that question once, for the renderer, which checks every binding before it
 * fills a prop, and for the validator, which checks the same rules when it is
 * given a schema.
 *
 * What a binding that breaks a rule turns into is part of the answer:
 *
 * - a binding to a prop the block does not have fills nothing;
 * - any other broken binding renders its fallback, or the prop's own value
 *   when the fallback is not itself a valid value of the prop;
 * - a format this release does not apply shows the value as it is, when the
 *   value fits the prop by itself, and the fallback otherwise.
 *
 * Every broken binding is reported with a code from `BINDING_ISSUE_CODES`.
 *
 * @module binding-rules
 */
import {
  checkFormat,
  machineDate,
  type CheckedFormat,
  type FormatCheck,
} from "./binding-format";
import type { BindingIssue, BindingIssueCode } from "./binding-issues";
import {
  bindablePropTypeOf,
  bindingKindOf,
  canBindFieldToProp,
  STORAGE_PRIMITIVE_AS_FIELD_TYPE,
  type BindablePropType,
  type BindingEndpoint,
  type BindingValueKind,
  type FieldStoragePrimitive,
} from "./binding-vocabulary";
import type { PropSchema } from "./block";
import {
  DEFAULT_BINDING_SOURCE,
  isBindingSource,
  isUnsetOverride,
  type BindingFormatType,
  type BindingSource,
  type ExposedPropertyType,
} from "./document";
import { exposedValueFits } from "./placement-values";
import { isPlainRecord } from "./plain-record";
import { isRichTextNode, isRichTextValue } from "./rich-text";
import { ownEntry } from "./safe-record";

/**
 * A binding path: a dot-joined chain of field identifiers, such as "title" or
 * "author.name". Anything else is refused, so nothing evaluable is stored.
 */
const BIND_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Whether a value is a well-formed binding path.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function isBindPath(value: unknown): value is string {
  return typeof value === "string" && BIND_PATH_RE.test(value);
}

/**
 * The shape of value a bound prop holds, which its own value and its fallback
 * are judged by.
 *
 * The first five are the kinds a component's exposed property is edited as,
 * and are judged by the same check a placement's value is.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindablePropKind =
  | Exclude<ExposedPropertyType, "visibility">
  | "number"
  | "boolean"
  | "date"
  | "json"
  | "list"
  | "reference";

/**
 * The value shape of each prop type the vocabulary can fill, keyed by the same
 * types, so a prop type cannot be bindable without one. `null` for the types
 * that are composed rather than bound.
 */
const PROP_VALUE_SHAPE: {
  readonly [Type in BindablePropType]: BindablePropKind | null;
} = {
  text: "text",
  textarea: "text",
  email: "text",
  code: "text",
  richText: "richText",
  number: "number",
  date: "date",
  select: "select",
  radio: "select",
  checkbox: "boolean",
  json: "json",
  chips: "list",
  upload: "image",
  media: "image",
  url: "link",
  link: "link",
  relationship: "reference",
  repeater: null,
  group: null,
};

/** A prop schema as one end of a binding. */
function propEndpoint(schema: PropSchema): BindingEndpoint {
  const relationTo = relationTargets(schema.relationTo);
  return {
    type: schema.type,
    ...(schema.hasMany === true ? { hasMany: true } : {}),
    ...(isStoragePrimitive(schema.storage) ? { storage: schema.storage } : {}),
    ...(relationTo === undefined ? {} : { relationTo }),
  };
}

/** A field shape as one end of a binding. */
function fieldEndpoint(field: BindingFieldShape): BindingEndpoint {
  return {
    type: field.type,
    ...(field.hasMany === true ? { hasMany: true } : {}),
    ...(field.storage === undefined ? {} : { storage: field.storage }),
    ...(field.relationTo === undefined ? {} : { relationTo: field.relationTo }),
  };
}

/** A prop's declared targets, when they are a collection or a list of them. */
function relationTargets(
  value: unknown
): string | readonly string[] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(item => typeof item === "string")) {
    return value;
  }
  return undefined;
}

const STORAGE_PRIMITIVES: ReadonlySet<string> = new Set(
  Object.keys(STORAGE_PRIMITIVE_AS_FIELD_TYPE)
);

function isStoragePrimitive(value: unknown): value is FieldStoragePrimitive {
  return typeof value === "string" && STORAGE_PRIMITIVES.has(value);
}

/**
 * The shape of value a prop can be bound to, or nothing for a prop whose type
 * no binding can fill (a list of items, a colour).
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindablePropKind(
  schema: PropSchema | undefined
): BindablePropKind | undefined {
  if (schema === undefined) return undefined;
  const type = bindablePropTypeOf(propEndpoint(schema));
  return type === undefined ? undefined : (PROP_VALUE_SHAPE[type] ?? undefined);
}

/**
 * One field of a source, as a binding is checked against it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingFieldShape {
  readonly name: string;
  /** The field's declared type, such as `text`, `date` or `relationship`. */
  readonly type: string;
  /** Whether the field holds a list of values rather than one. */
  readonly hasMany?: boolean;
  /** The collection, or collections, a relationship or upload points at. */
  readonly relationTo?: string | readonly string[];
  /** The values a select or radio field may hold. */
  readonly options?: readonly string[];
  /** A date picked as a day: no time of day, no time zone. */
  readonly dateOnly?: boolean;
  /** A date picked as a month and year. */
  readonly monthOnly?: boolean;
  /** A time of day, stored on a placeholder date in UTC. */
  readonly timeOnly?: boolean;
  /** The storage primitive a plugin's field type persists as. */
  readonly storage?: FieldStoragePrimitive;
  /** A group's own fields, or those of the one component a field holds. */
  readonly fields?: readonly BindingFieldShape[];
}

/**
 * Whose fields: a collection's entries, one Single, or the site settings.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindingSchemaRef =
  | { readonly collection: string }
  | { readonly single: string }
  | { readonly site: true };

/**
 * Where a binding's fields are looked up. `undefined` means the shapes of
 * that source are not known, and its bindings are then judged by the shape of
 * the value they read.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingSchemaSource {
  fieldsOf(ref: BindingSchemaRef): readonly BindingFieldShape[] | undefined;
}

/**
 * The schema refs of the sources whose collection depends on where the
 * document is: the entry the page shows, and the list item being drawn.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingRefs {
  readonly entry?: BindingSchemaRef;
  readonly item?: BindingSchemaRef;
}

/**
 * A binding that passed every check that does not need its value.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface CheckedBinding {
  readonly prop: string;
  readonly source: BindingSource;
  /** The Single a `single` binding reads. */
  readonly sourceKey?: string;
  readonly path: string;
  readonly segments: readonly string[];
  /** What the prop takes, when the block's props were known. */
  readonly kind?: BindablePropKind;
  readonly propSchema?: PropSchema;
  /** The field the path ends at, when the source's schema was known. */
  readonly field?: BindingFieldShape;
  readonly format: CheckedFormat | null;
  /** A stored format this release does not apply. */
  readonly unsupportedFormat?: BindingFormatType;
  /** The fallback, when one is stored and is a valid value of the prop. */
  readonly fallback?: { readonly value: unknown };
}

/**
 * What checking one binding found.
 *
 * - `resolve`: read the value; the binding may still fall back on it.
 * - `fallback`: show the fallback when there is one, else the prop's own value.
 * - `ignore`: fill nothing.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindingCheck =
  | {
      readonly outcome: "resolve";
      readonly binding: CheckedBinding;
      readonly issues: readonly BindingIssue[];
    }
  | {
      readonly outcome: "fallback";
      readonly fallback?: { readonly value: unknown };
      readonly issues: readonly BindingIssue[];
    }
  | { readonly outcome: "ignore"; readonly issues: readonly BindingIssue[] };

/**
 * What {@link checkBinding} needs.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingCheckInput {
  readonly nodeId: string;
  readonly prop: string;
  /** The binding as stored: outside input, read here before anything else. */
  readonly binding: unknown;
  /**
   * The block's declared props. Absent when the caller cannot look them up;
   * the prop is then not judged.
   */
  readonly props?: Readonly<Partial<Record<string, PropSchema>>>;
  readonly schema?: BindingSchemaSource;
  readonly refs?: BindingRefs;
}

/** A stored binding whose shape was read. */
interface StoredBinding {
  readonly path: string;
  readonly source: BindingSource;
  readonly sourceKey?: string;
  readonly hasFallback: boolean;
  readonly fallback: unknown;
  readonly format: unknown;
}

/** A Single names its slug, and no other source names one. */
function sourceKeyFits(source: BindingSource, sourceKey: unknown): boolean {
  return source === "single"
    ? typeof sourceKey === "string" && sourceKey !== ""
    : sourceKey === undefined;
}

/** The fields a stored binding is read through, refusing anything else. */
function readStoredBinding(value: unknown): StoredBinding | undefined {
  if (!isPlainRecord(value)) return undefined;
  const path = ownEntry(value, "$bind");
  if (!isBindPath(path)) return undefined;
  const source = ownEntry(value, "source") ?? DEFAULT_BINDING_SOURCE;
  if (typeof source !== "string" || !isBindingSource(source)) return undefined;
  const sourceKey = ownEntry(value, "sourceKey");
  if (!sourceKeyFits(source, sourceKey)) return undefined;
  const hasFallback =
    Object.prototype.hasOwnProperty.call(value, "fallback") &&
    ownEntry(value, "fallback") !== undefined;
  return {
    path,
    source,
    ...(typeof sourceKey === "string" ? { sourceKey } : {}),
    hasFallback,
    fallback: ownEntry(value, "fallback"),
    format: ownEntry(value, "format"),
  };
}

/** The values a select prop declares, as stored strings or `{ value }` records. */
function choicesOfProp(schema: PropSchema): readonly string[] {
  const options: unknown = schema.options;
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options as unknown[]) {
    if (typeof option === "string") values.push(option);
    else if (isPlainRecord(option) && typeof option.value === "string") {
      values.push(option.value);
    }
  }
  return values;
}

/**
 * A stored reference: an entry id, or the `{ relationTo, value }` pair a
 * reference to more than one collection stores.
 */
function isReferenceValue(value: unknown): boolean {
  if (typeof value === "string") return value !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return (
    isPlainRecord(value) &&
    typeof value.relationTo === "string" &&
    (typeof value.value === "string" || typeof value.value === "number")
  );
}

/**
 * Whether a value is one a prop of this kind can hold, judged as the prop's
 * own value would be.
 *
 * The kinds an exposed property shares are judged by the same check a
 * component placement's value is, so the two cannot disagree about what a
 * text, a link or a choice is.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function isValidPropValue(
  kind: BindablePropKind,
  schema: PropSchema,
  value: unknown
): boolean {
  switch (kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      // Read as a bound date is read, so a fallback a date prop accepts is
      // one the formatter can also give a machine value.
      return typeof value === "string" && machineDate(value) !== undefined;
    case "json":
      return value !== undefined;
    case "list":
      return (
        Array.isArray(value) &&
        value.every((item: unknown) => typeof item === "string")
      );
    case "reference":
      return isReferenceValue(value);
    default:
      // The sentinel that clears an override is not a value of any prop.
      if (isUnsetOverride(value)) return false;
      return exposedValueFits(
        {
          type: kind,
          options: choicesOfProp(schema).map(choice => ({
            value: choice,
            label: choice,
          })),
        },
        value
      );
  }
}

/**
 * Whether a rich-text value holds nothing a reader would see: only empty
 * paragraphs. An image or any other non-text node is content.
 */
function isEmptyRichText(value: unknown): boolean {
  if (!isRichTextValue(value)) return false;
  return value.root.children.every(
    child =>
      isRichTextNode(child) &&
      child.type === "paragraph" &&
      (child.children ?? []).every(
        inner =>
          isRichTextNode(inner) &&
          inner.type === "text" &&
          (inner.text ?? "") === ""
      )
  );
}

/**
 * Whether a bound value is empty, so the binding shows its fallback.
 *
 * Empty is absent, `null`, an empty string, an empty list, or rich text with
 * nothing in it. `false` and `0` are values.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function isEmptyBoundValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isEmptyRichText(value);
}

/**
 * Whether a field's value fills a prop as it is, past the picker's question.
 *
 * A number or a date reaches a text prop only through a format. A choice
 * prop is filled by a choice field only when every value the field allows is
 * one the prop allows, and never by free text, since the prop's choices are
 * what it can render.
 */
function fillsUnformatted(
  kind: BindingValueKind | null,
  shape: BindablePropKind,
  field: BindingFieldShape,
  schema: PropSchema
): boolean {
  if (shape === "text") return kind !== "number" && kind !== "date";
  if (shape !== "select") return true;
  if (kind !== "option") return false;
  const allowed = choicesOfProp(schema);
  return (
    allowed.length === 0 ||
    (field.options ?? []).every(option => allowed.includes(option))
  );
}

/**
 * Whether a field's value fills a prop as it is: the picker's question
 * ({@link canBindFieldToProp}), and then the value's.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function fieldFitsProp(
  field: BindingFieldShape,
  schema: PropSchema
): boolean {
  const shape = bindablePropKind(schema);
  if (shape === undefined) return false;
  const source = fieldEndpoint(field);
  return (
    canBindFieldToProp(source, propEndpoint(schema)) &&
    fillsUnformatted(bindingKindOf(source), shape, field, schema)
  );
}

/**
 * Fields every entry carries that a schema need not list. A binding to one
 * is judged by the value it reads, as a binding with no schema is.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "updatedAt",
]);

/** The most path segments a binding can need: one relation, then its field. */
const MAX_SEGMENTS_WITHOUT_SCHEMA = 2;

/** What walking a path through a source's fields found. */
type PathWalk =
  | { readonly ok: true; readonly field?: BindingFieldShape }
  | {
      readonly ok: false;
      readonly code: BindingIssueCode;
      readonly message: string;
    };

function walkFailure(code: BindingIssueCode, message: string): PathWalk {
  return { ok: false, code, message };
}

/**
 * The rest of a path through fields no schema describes, judged by its length:
 * at most one relation and its field.
 */
function shapelessRest(remaining: number): PathWalk {
  return remaining > 1
    ? walkFailure(
        "binding-path-too-deep",
        "This path goes further than one relation."
      )
    : { ok: true };
}

/**
 * A path naming a field its source's schema does not list: one every entry
 * carries is judged by its value, any other is missing.
 */
function unlistedField(
  name: string,
  index: number,
  segments: readonly string[]
): PathWalk {
  if (index === 0 && SYSTEM_FIELDS.has(name)) {
    return shapelessRest(segments.length - MAX_SEGMENTS_WITHOUT_SCHEMA + 1);
  }
  return walkFailure(
    "binding-field-missing",
    `The source has no field "${name}" a visitor may read.`
  );
}

/**
 * Follow a path through a source's fields.
 *
 * A group is walked into freely; a relation is a hop, and a path may follow
 * one. Past a relation whose collection's fields are unknown, the rest of the
 * path is judged by its length alone.
 */
function walkPath(
  segments: readonly string[],
  root: readonly BindingFieldShape[],
  schema: BindingSchemaSource
): PathWalk {
  let fields: readonly BindingFieldShape[] | undefined = root;
  let hops = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index] ?? "";
    const last = index === segments.length - 1;
    if (fields === undefined) return shapelessRest(segments.length - index);
    const field: BindingFieldShape | undefined = fields.find(
      candidate => candidate.name === name
    );
    if (field === undefined) return unlistedField(name, index, segments);
    if (last) return { ok: true, field };
    const step = stepInto(field, hops, schema);
    if (!step.ok) return step;
    fields = step.fields;
    hops = step.hops;
  }
  return { ok: true };
}

/** One step of a path past a field: into a group, or across a relation. */
function stepInto(
  field: BindingFieldShape,
  hops: number,
  schema: BindingSchemaSource
):
  | {
      readonly ok: true;
      readonly fields: readonly BindingFieldShape[] | undefined;
      readonly hops: number;
    }
  | Extract<PathWalk, { ok: false }> {
  const kind = bindingKindOf(fieldEndpoint(field));
  if (field.hasMany === true || field.type === "repeater" || kind === "list") {
    return {
      ok: false,
      code: "binding-path-to-many",
      message: `"${field.name}" holds a list, which a binding cannot follow; show it with a nested list.`,
    };
  }
  // A group, or the one component a field holds: walked into, as no hop.
  if (field.fields !== undefined) {
    return { ok: true, fields: field.fields, hops };
  }
  if (kind === "reference" || kind === "media") {
    return crossRelation(field, hops, schema);
  }
  if (kind !== null) {
    return {
      ok: false,
      code: "binding-field-missing",
      message: `"${field.name}" holds a single value with no fields of its own.`,
    };
  }
  // A field whose inside the schema does not describe: what lies past it is
  // judged by the value read, as without a schema.
  return { ok: true, fields: undefined, hops };
}

/** The one relation a path may follow, into its collection's fields. */
function crossRelation(
  field: BindingFieldShape,
  hops: number,
  schema: BindingSchemaSource
):
  | {
      readonly ok: true;
      readonly fields: readonly BindingFieldShape[] | undefined;
      readonly hops: number;
    }
  | Extract<PathWalk, { ok: false }> {
  if (typeof field.relationTo !== "string") {
    return {
      ok: false,
      code: "binding-path-unsupported",
      message: `"${field.name}" can point at more than one collection, so a binding cannot follow it.`,
    };
  }
  if (hops >= 1) {
    return {
      ok: false,
      code: "binding-path-too-deep",
      message: "This path follows more than one relation.",
    };
  }
  return {
    ok: true,
    fields: schema.fieldsOf({ collection: field.relationTo }),
    hops: hops + 1,
  };
}

/** The schema ref a binding's source is looked up under, when one is known. */
function refFor(
  stored: StoredBinding,
  refs: BindingRefs | undefined
): BindingSchemaRef | undefined {
  switch (stored.source) {
    case "entry":
      return refs?.entry;
    case "item":
      return refs?.item;
    case "single":
      return stored.sourceKey === undefined
        ? undefined
        : { single: stored.sourceKey };
    case "site":
      return { site: true };
  }
}

/** Path problems decided with a schema, or by length without one. */
function checkPath(
  stored: StoredBinding,
  segments: readonly string[],
  input: BindingCheckInput
): PathWalk {
  const ref = refFor(stored, input.refs);
  const root =
    ref === undefined || input.schema === undefined
      ? undefined
      : input.schema.fieldsOf(ref);
  if (root === undefined || input.schema === undefined) {
    return shapelessRest(segments.length - MAX_SEGMENTS_WITHOUT_SCHEMA + 1);
  }
  return walkPath(segments, root, input.schema);
}

/** A check's issue for this binding. */
function issueOf(
  input: BindingCheckInput,
  path: string,
  code: BindingIssueCode,
  message: string
): BindingIssue {
  return { nodeId: input.nodeId, prop: input.prop, code, message, path };
}

/** Whether a field fits the prop once its format, if any, is applied. */
function checkFit(
  format: Extract<FormatCheck, { ok: true }>,
  field: BindingFieldShape | undefined,
  kind: BindablePropKind | undefined,
  schema: PropSchema | undefined
): { readonly code: BindingIssueCode; readonly message: string } | undefined {
  // Without a schema or known props, the value read is judged instead.
  if (field === undefined || kind === undefined || schema === undefined) {
    return undefined;
  }
  // A formatted value still has to be one the picker would offer; its format
  // was checked against the field already.
  const fits =
    format.format === null
      ? fieldFitsProp(field, schema)
      : canBindFieldToProp(fieldEndpoint(field), propEndpoint(schema));
  return fits ? undefined : unfit(field, kind, format.unsupported);
}

/** Why a field that does not fit its prop unformatted falls back. */
function unfit(
  field: BindingFieldShape,
  kind: BindablePropKind,
  unsupported: BindingFormatType | undefined
): { readonly code: BindingIssueCode; readonly message: string } {
  if (unsupported !== undefined) {
    return {
      code: "binding-format-unsupported",
      message: `The "${unsupported}" format is not applied in this release, and a ${field.type} field cannot fill this prop unformatted.`,
    };
  }
  const fieldKind = bindingKindOf(fieldEndpoint(field));
  const needsFormat =
    (fieldKind === "date" || fieldKind === "number") && kind === "text";
  return {
    code: "binding-type-misfit",
    message: needsFormat
      ? `A ${field.type} field reaches a ${kind} prop only through a format.`
      : `A ${field.type} field cannot fill a ${kind} prop.`,
  };
}

/** The prop's kind, or why the binding fills nothing or keeps the own value. */
function checkProp(
  input: BindingCheckInput,
  path: string
):
  | {
      readonly ok: true;
      readonly kind?: BindablePropKind;
      readonly schema?: PropSchema;
    }
  | { readonly ok: false; readonly check: BindingCheck } {
  if (input.props === undefined) return { ok: true };
  const schema = ownEntry(input.props, input.prop);
  if (schema === undefined) {
    return {
      ok: false,
      check: {
        outcome: "ignore",
        issues: [
          issueOf(
            input,
            path,
            "binding-prop-missing",
            `This block has no "${input.prop}" prop, so the binding fills nothing.`
          ),
        ],
      },
    };
  }
  const kind = bindablePropKind(schema);
  if (kind === undefined) {
    return {
      ok: false,
      check: {
        outcome: "fallback",
        issues: [
          issueOf(
            input,
            path,
            "binding-prop-unbindable",
            `The "${input.prop}" prop is a ${schema.type}, which cannot be bound.`
          ),
        ],
      },
    };
  }
  return { ok: true, kind, schema };
}

/**
 * A binding whose path or source cannot be read. Its fallback is still read on
 * its own, since a fallback is what such a binding is for: when it is a valid
 * value of a prop the block has, it is shown.
 */
function malformed(input: BindingCheckInput): BindingCheck {
  const issues = [
    issueOf(
      input,
      "",
      "binding-malformed",
      "This binding is not a field path with a known source."
    ),
  ];
  const binding = input.binding;
  const schema =
    input.props === undefined ? undefined : ownEntry(input.props, input.prop);
  const kind = bindablePropKind(schema);
  const fallback = isPlainRecord(binding)
    ? ownEntry(binding, "fallback")
    : undefined;
  if (
    fallback === undefined ||
    schema === undefined ||
    kind === undefined ||
    !isValidPropValue(kind, schema, fallback)
  ) {
    return { outcome: "fallback", issues };
  }
  return { outcome: "fallback", fallback: { value: fallback }, issues };
}

/** The prop check's answer for a binding that goes on to be read. */
type PropFit = Extract<ReturnType<typeof checkProp>, { ok: true }>;

/** The stored fallback when it is a valid value of the prop, else reported. */
function checkedFallback(
  input: BindingCheckInput,
  stored: StoredBinding,
  prop: PropFit,
  issues: BindingIssue[]
): { readonly value: unknown } | undefined {
  if (!stored.hasFallback) return undefined;
  if (
    prop.kind === undefined ||
    prop.schema === undefined ||
    isValidPropValue(prop.kind, prop.schema, stored.fallback)
  ) {
    return { value: stored.fallback };
  }
  issues.push(
    issueOf(
      input,
      stored.path,
      "binding-fallback-invalid",
      `This binding's fallback is not a valid ${prop.kind} value, so the prop's own value is shown instead.`
    )
  );
  return undefined;
}

/** A binding that passed every check, as the pass reads it. */
function checkedBinding(
  input: BindingCheckInput,
  stored: StoredBinding,
  prop: PropFit,
  field: BindingFieldShape | undefined,
  format: Extract<FormatCheck, { ok: true }>,
  fallback: { readonly value: unknown } | undefined
): CheckedBinding {
  return {
    prop: input.prop,
    source: stored.source,
    ...(stored.sourceKey === undefined ? {} : { sourceKey: stored.sourceKey }),
    path: stored.path,
    segments: stored.path.split("."),
    ...(prop.kind === undefined ? {} : { kind: prop.kind }),
    ...(prop.schema === undefined ? {} : { propSchema: prop.schema }),
    ...(field === undefined ? {} : { field }),
    format: format.format,
    ...(format.unsupported === undefined
      ? {}
      : { unsupportedFormat: format.unsupported }),
    ...(fallback === undefined ? {} : { fallback }),
  };
}

/**
 * Check one stored binding against every rule that does not need its value.
 *
 * Total: a binding of any shape gives an outcome, never a throw.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function checkBinding(input: BindingCheckInput): BindingCheck {
  const stored = readStoredBinding(input.binding);
  if (stored === undefined) return malformed(input);
  const prop = checkProp(input, stored.path);
  if (!prop.ok) return prop.check;

  const issues: BindingIssue[] = [];
  const fallback = checkedFallback(input, stored, prop, issues);
  const fallingBack: BindingCheck = {
    outcome: "fallback",
    ...(fallback === undefined ? {} : { fallback }),
    issues,
  };
  const walked = checkPath(stored, stored.path.split("."), input);
  if (!walked.ok) {
    issues.push(issueOf(input, stored.path, walked.code, walked.message));
    return fallingBack;
  }
  const format = checkFormat(stored.format, prop.kind, walked.field);
  if (!format.ok) {
    issues.push(issueOf(input, stored.path, format.code, format.message));
    return fallingBack;
  }
  const misfit = checkFit(format, walked.field, prop.kind, prop.schema);
  if (misfit !== undefined) {
    issues.push(issueOf(input, stored.path, misfit.code, misfit.message));
    return fallingBack;
  }
  if (format.unsupported !== undefined) {
    issues.push(
      issueOf(
        input,
        stored.path,
        "binding-format-unsupported",
        `The "${format.unsupported}" format is not applied in this release, so the value is shown as it is.`
      )
    );
  }
  return {
    outcome: "resolve",
    issues,
    binding: checkedBinding(
      input,
      stored,
      prop,
      walked.field,
      format,
      fallback
    ),
  };
}
