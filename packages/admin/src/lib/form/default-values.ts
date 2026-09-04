/**
 * form-default-values — what a form holds before anyone edits it.
 *
 * The entry editor and the single editor both needed this and each carried its
 * own copy: 152 lines and 198 lines that agreed on most field types and
 * disagreed on six. The disagreements were not deliberate, and users could see
 * them — a `chips` field's declared default was honoured in one editor and
 * discarded in the other; a `code` field opened empty in one and null in the
 * other.
 *
 * Each divergence was resolved on its merits rather than by keeping whichever
 * copy was longer. The entry editor's behaviour won every one:
 *
 * - `chips` honours the schema author's `defaultValue` instead of forcing `[]`.
 * - `code` and `json` are named rather than left to the generic fallthrough,
 *   which gave a code input `null` where it wants an empty string.
 * - `relationship` and `upload` decide multiplicity from `hasMany` alone. The
 *   other copy also read a `multiple` key; no field config in this repository
 *   sets one, and both inputs read `hasMany`.
 * - a single-value `select`/`radio` seeds `null` rather than `""`. Both inputs
 *   render `value || ""`, so nothing looks different; `null` is what the other
 *   absent-value cases use and what belongs in the database.
 *
 * The work is split across two functions because a STORED value and a DECLARED
 * default are different questions. One reconciles what the database returned
 * with what the input expects; the other reads what the schema author asked
 * for. Answering both inside one switch made a function with a cyclomatic
 * complexity of 61.
 *
 * @module lib/form/default-values
 */

import type { FieldConfig } from "nextly/config";
// The shared predicate keeps the structural-field decisions — which types
// seed nested defaults and which treat a stored null as shape-to-materialise
// — aligned across both stored field-group spellings.
import { isFieldGroupFieldType } from "nextly/field-group-type";

/** Convert camelCase to snake_case, for the DB column-name fallback below. */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

/** A checkbox may come back as `true`, `"true"` or `1` depending on the driver. */
function coerceStoredBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/** Chips may arrive as a JSON string from a database with no JSONB, or from a legacy row. */
function coerceStoredChips(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Component data arrives as an array even for a non-repeatable component (from
 * `FieldGroupDataService.populateComponentData`), while the form's dynamic-zone
 * mode expects a single object carrying `_componentType`.
 */
function unwrapStoredComponent(value: unknown, field: FieldConfig): unknown {
  const isRepeatable = (field as { repeatable?: boolean }).repeatable;
  if (!isRepeatable && Array.isArray(value) && value.length === 1) {
    return value[0];
  }
  return value;
}

/**
 * How each field type reconciles what the database returned with what its input
 * expects. A type with no entry takes the stored value unchanged, which is the
 * common case and the right default for a contributed type nobody has taught
 * this module about.
 */
const FROM_STORED: Record<
  string,
  (value: unknown, field: FieldConfig) => unknown
> = {
  checkbox: coerceStoredBoolean,
  boolean: coerceStoredBoolean,
  chips: coerceStoredChips,
  component: unwrapStoredComponent,
  // The migrated spelling of `component` arrives with the same populated
  // array shape, so the same reconciliation applies. Keyed by raw stored
  // token: this map is looked up by whatever discriminator the definition
  // carries.
  fieldGroup: unwrapStoredComponent,
};

/** The value a STORED field takes in the form. */
function fromStoredValue(field: FieldConfig, existingValue: unknown): unknown {
  const coerce = FROM_STORED[field.type as string];
  return coerce ? coerce(existingValue, field) : existingValue;
}

/**
 * The seed for a field whose multiplicity is decided by `hasMany`.
 *
 * `select`, `radio`, `relationship` and `upload` all ask the same question —
 * does this hold one value or a list — so they answer it here rather than four
 * times. The declared default may be written either way round: a list field may
 * declare a scalar (`defaultValue: "design"`) and a single field may declare an
 * array, and each is coerced toward the shape its own schema validates.
 *
 * Treating an array default as a scalar would wrap it again and hand the field
 * [["technology", "design"]], which renders as one nonsense badge and fails
 * array validation.
 */
function fromMultiplicityDefault(
  field: FieldConfig,
  declared: unknown
): unknown {
  const { hasMany } = field as { hasMany?: boolean };

  if (hasMany) {
    if (Array.isArray(declared)) return declared;
    // Absence is the empty list. Tested for explicitly rather than by
    // truthiness, so an id of `0` seeds `[0]` instead of dropping out.
    return declared === undefined || declared === null || declared === ""
      ? []
      : [declared];
  }
  // A single-value field given an array default takes its first entry rather
  // than stringifying the whole array into the control.
  return Array.isArray(declared) ? (declared[0] ?? null) : (declared ?? null);
}

/**
 * A text field's seed, which depends on whether it holds one value or many.
 *
 * `convertTextFieldToZod` builds an ARRAY schema for `hasMany`, so seeding the
 * empty string there hands the validator a value of the wrong shape and the row
 * is rejected before anyone edits it.
 */
function fromTextDefault(field: FieldConfig, declared: unknown): unknown {
  if (!(field as { hasMany?: boolean }).hasMany) return declared ?? "";
  if (Array.isArray(declared)) return declared;
  return declared === undefined || declared === null || declared === ""
    ? []
    : [declared];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A private copy of a structured default.
 *
 * The declared value lives on the field definition, which outlives every row
 * seeded from it — the same definition fills every repeater row and every entry
 * created from that collection. Handing it out directly would give all of them
 * one shared object, so editing one row would reach into the others and into
 * the config itself. `field-defaults.ts` guards the write path the same way.
 */
function cloneDeclared(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    // Only a value that cannot be stored at all fails to clone, and validation
    // rejects that with a message about the value rather than about the copy.
    return value;
  }
}

/**
 * A declared container merged with the defaults of the fields inside it.
 *
 * The declared keys win and the rest are seeded, which is what the write path
 * arrives at from the other direction: `applyFieldDefaults` writes the declared
 * value first, then fills each child only where the value is absent.
 */
function seedContainer(
  declared: unknown,
  fields: FieldConfig[] | undefined
): Record<string, unknown> {
  const copy = isPlainObject(declared)
    ? (cloneDeclared(declared) as Record<string, unknown>)
    : undefined;

  // The container is its OWN evaluation context, which is why it is passed
  // down rather than the defaults being computed once and reused: a child's
  // functional default may read a sibling the container supplies
  // (`data => data.isUrgent ? "express" : "standard"` beside
  // `isUrgent: true`), and a seed computed before seeing the container reads
  // that sibling as absent. `fillRepeaterRows` copies each row and fills
  // against the copy for the same reason.
  const seeded = fields ? getDefaultValues(fields, copy) : {};

  // Declared keys win, and keys the schema does not name survive — a
  // dynamic-zone row carries its `_componentType` discriminator, and seeding
  // from the field list alone would drop it.
  return copy ? { ...seeded, ...copy } : seeded;
}

/** Each declared row, with any sub-field it leaves unset seeded from the schema. */
function fromRowsDefault(
  declared: unknown,
  fields: FieldConfig[] | undefined
): unknown[] {
  // Rows are never invented: how many a new row starts with is the schema
  // author's declaration, and `minRows` is a validation rule rather than an
  // instruction to fabricate content — the same rule `fillRepeaterRows` states.
  if (!Array.isArray(declared)) return [];
  return declared.map(row =>
    isPlainObject(row) ? seedContainer(row, fields) : row
  );
}

/** A component's seed: a list when repeatable, its nested defaults when not. */
function fromComponentDefault(field: FieldConfig, declared: unknown): unknown {
  const { componentFields, repeatable } = field as {
    componentFields?: FieldConfig[];
    repeatable?: boolean;
  };
  if (repeatable) return fromRowsDefault(declared, componentFields);
  if (componentFields) return seedContainer(declared, componentFields);
  // With no nested schema there is nothing to seed, so a declared value is the
  // only thing that can fill it.
  return isPlainObject(declared) ? cloneDeclared(declared) : null;
}

/**
 * How each field type seeds itself when the document has nothing stored.
 *
 * A table rather than a `switch`, for the reason `derived-checks.md` gives: a
 * switch reaches its `default` arm for a type nobody wrote a case for, which is
 * indistinguishable from a type deliberately left to the fallback. Here the
 * fallback IS deliberate — a plugin-contributed type takes its declared default
 * — so the two have to be told apart by whether a key exists, not by which arm
 * ran.
 *
 * Each entry takes the field and its declared `defaultValue`.
 */
const DECLARED_DEFAULT: Record<
  string,
  (field: FieldConfig, declared: unknown) => unknown
> = {
  text: (f, d) => fromTextDefault(f, d),
  textarea: (_f, d) => d ?? "",
  email: (_f, d) => d ?? "",
  password: (_f, d) => d ?? "",
  code: (_f, d) => d ?? "",
  checkbox: (_f, d) => d ?? false,
  select: fromMultiplicityDefault,
  radio: fromMultiplicityDefault,
  relationship: fromMultiplicityDefault,
  upload: fromMultiplicityDefault,
  repeater: (f, d) =>
    fromRowsDefault(d, (f as { fields?: FieldConfig[] }).fields),
  chips: (_f, d) => d ?? [],
  group: (f, d) => seedContainer(d, (f as { fields?: FieldConfig[] }).fields),
  component: fromComponentDefault,
  // The migrated spelling seeds identically: its nested schema arrives
  // enriched as `componentFields` under either stored token.
  fieldGroup: fromComponentDefault,
};

/**
 * The value a field takes when the document has nothing stored for it — a
 * create form, or a field added to the schema after this document was written.
 *
 * A type with no entry above takes its declared default and falls back to null.
 * That covers `number`, `date`, `richText` and `json`, and every field type a
 * plugin contributes: reading the declared value rather than forcing null is
 * what lets a plugin field open a create form with the value its schema author
 * chose.
 */
function fromDeclaredDefault(
  field: FieldConfig,
  soFar: Record<string, unknown>
): unknown {
  // A schema author may declare the default as a function to compute it per
  // document. It is resolved here, before the table dispatches, so every type
  // sees a value rather than each entry having to unwrap it — and so the form
  // never holds the function object itself.
  //
  // It receives the values seeded so far, which is what the write path's
  // `applyFieldDefaults` passes: a documented default may read its siblings
  // (`data => data.isUrgent ? "express" : "standard"`), and resolving it
  // against an empty object instead would seed the branch the document does
  // not take. The admin submits that value explicitly, so the server never
  // recomputes it and the divergence reaches the row.
  const raw = (field as { defaultValue?: unknown }).defaultValue;
  const declared =
    typeof raw === "function"
      ? (raw as (data: Record<string, unknown>) => unknown)(soFar)
      : raw;
  const seed = DECLARED_DEFAULT[field.type as string];
  return seed ? seed(field, declared) : (declared ?? null);
}

/**
 * Build a form's default values from a field schema and, optionally, the
 * document being edited.
 *
 * Recursive: `group` and non-repeatable `component` fields seed themselves from
 * their own nested fields.
 */
export function getDefaultValues(
  fields: FieldConfig[],
  existingData?: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  // The entry API may return DB column names (snake_case) while field configs
  // use camelCase. Try camelCase first, then the snake_case column.
  const storedValue = (name: string) =>
    existingData?.[name] ?? existingData?.[toSnakeCase(name)];

  // What a functional default reads. It starts as the whole stored document
  // rather than filling up field by field, because declaration ORDER is not the
  // document: a default reading a sibling declared after it would otherwise see
  // that sibling as absent and take the wrong branch on an entry that plainly
  // has it. The write path has no such gap — `applyFieldDefaults` receives the
  // supplied document whole — and the admin then submits the value it computed,
  // so the server never recomputes it and the divergence would reach the row.
  const context: Record<string, unknown> = {};
  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;
    const stored = storedValue(field.name);
    if (stored !== undefined) context[field.name] = stored;
  }

  for (const field of fields) {
    if (!("name" in field) || !field.name) continue;
    const fieldName = field.name;

    const existingValue = storedValue(fieldName);

    // A STORED NULL for a structural field is not a value to keep. The field's
    // own inputs materialise the shape as they register — `seo: null` becomes
    // `{ metaTitle: null, ... }` the moment its sub-fields mount — so taking the
    // null verbatim guarantees the form's values can never equal its defaults,
    // and the document reports itself edited before anyone has typed.
    // Asked through the shared predicate: a migrated field group is structural
    // exactly like the legacy one.
    const isStructural =
      field.type === "group" || isFieldGroupFieldType(field.type);
    const isRepeatable =
      (field as { repeatable?: boolean }).repeatable === true;
    const nullStructural =
      existingValue === null && isStructural && !isRepeatable;

    defaults[fieldName] =
      existingValue !== undefined && !nullStructural
        ? fromStoredValue(field, existingValue)
        : fromDeclaredDefault(field, context);

    // A later default reads the value this one settled on, coerced, rather than
    // the raw stored one — the same progression `applyFieldDefaults` makes as it
    // fills the document it was handed.
    context[fieldName] = defaults[fieldName];
  }

  return defaults;
}
