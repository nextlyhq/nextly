/**
 * A simple form's fields, read once from what is stored, for the two that
 * must agree on them: the Form block draws them, and the page builder's
 * receiver checks a post against them.
 *
 * Each field is read into the one shape every form is drawn from
 * ({@link FormFieldDrawing}), a provider's included, so the rules the
 * browser applies to a drawn control (required, an email, a link, a number,
 * the listed choices) are the rules the receiver checks: both read them from
 * the same description.
 *
 * **A field's sent name comes from its label** ("Your email" is sent as
 * `your-email`) unless the author wrote one, and every name is made unique
 * within the form, so two fields never send their answers under one name.
 *
 * @module blocks/form-fields
 */
import type { FormFieldDrawing } from "../context";

import { flag, oneOf, text } from "./props";

/** The control types a simple form's field may declare. */
export const FORM_FIELD_TYPES = [
  "text",
  "email",
  "tel",
  "number",
  "url",
  "date",
  "textarea",
  "select",
  "checkbox",
  "radio",
] as const;

/** One of the control types a simple form's field may declare. */
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** The types whose field is a choice from a list of options. */
export const FORM_CHOICE_TYPES: readonly FormFieldType[] = ["select", "radio"];

/** One field of a simple form, as stored. */
export interface FormFieldSpec {
  /** The visible label. */
  label?: string;
  /** The name the value is sent under; made from the label when empty. */
  name?: string;
  /** Which control is drawn. */
  type?: FormFieldType;
  /** Whether an empty answer is refused. */
  required?: boolean;
  /** A Dropdown's or Choice's options, one per entry. */
  options?: string[];
}

/** One field as the form draws it and its receiver checks it: every default applied. */
export interface FormField {
  /** The name the value is sent under: unique within the form. */
  readonly name: string;
  /** What the label says. */
  readonly label: string;
  /** Which control is drawn. */
  readonly type: FormFieldType;
  /** Whether an empty answer is refused. */
  readonly required: boolean;
  /** A Dropdown's or Choice's options; empty for any other type. */
  readonly options: readonly string[];
}

/**
 * How many fields are read from one stored array.
 *
 * A stored array has no length of its own, so `fields` arrives at whatever
 * length was written, and past the renderer's inspection budget the
 * normalizer refuses the WHOLE output and the block becomes a placeholder:
 * an accidentally long form would lose every field rather than the ones past
 * the end. Well above any form a person fills in, and well below the budget.
 */
const MAX_FIELDS = 100;

/** How many options one field reads, for the same reason as {@link MAX_FIELDS}. */
const MAX_OPTIONS = 100;

/** The longest sent name: past it a name is cut, then made unique. */
const MAX_NAME_LENGTH = 64;

/** Whether a stored array member is shaped like a field at all. */
function isFieldSpec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The name a label is sent under: lower case, its letters and digits kept
 * and everything between them one `-`, so "Your email" is `your-email` and
 * "Café & menu" is `cafe-menu`. `field` for a label with no letter or digit.
 */
export function sentNameOf(label: string): string {
  const name = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^-+|-+$/g, "");
  return name === "" ? "field" : name;
}

/**
 * A stored name as it may be sent, or `""` where it cannot be. A name the
 * receiver keeps for itself starts with `_` (`_form`, `_hp`), so a field
 * stored under one would be read as the receiver's own and its answer lost,
 * or read as the spam trap; such a name is made from the label instead.
 */
function storedName(value: unknown): string {
  const name = text(value).trim().slice(0, MAX_NAME_LENGTH);
  return name.startsWith("_") ? "" : name;
}

/** `name`, or the first of `name-2`, `name-3`… that `taken` does not hold. */
function uniqueName(name: string, taken: Set<string>): string {
  let unique = name;
  for (let n = 2; taken.has(unique); n += 1) unique = `${name}-${n}`;
  taken.add(unique);
  return unique;
}

/** A field's options: its non-empty, distinct entries, at most {@link MAX_OPTIONS}. */
function optionsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const options: string[] = [];
  for (const raw of value.slice(0, MAX_OPTIONS)) {
    const option = text(raw).trim();
    if (option !== "" && !options.includes(option)) options.push(option);
  }
  return options;
}

/**
 * The fields a simple form's stored props describe, each with its defaults
 * applied: at most {@link MAX_FIELDS}, a member that is no field read as an
 * empty one, an unknown type as text, a missing name made from the label,
 * every name unique, a missing label as the name, and options only for a
 * Dropdown or a Choice.
 *
 * One reading for the two that must agree on it: the block draws these
 * fields, and the page builder's receiver checks a post against them. Two
 * copies of the defaults would let a field drawn under one name be checked
 * under another.
 */
export function formFields(props: { readonly fields?: unknown }): FormField[] {
  // A stored array can hold anything: a migration, a hand edit, or an older
  // version of this block can all leave a member that is not a field. Sliced
  // BEFORE the walk so an oversized array is never read in full.
  const stored: unknown = props.fields;
  const fields = Array.isArray(stored) ? stored.slice(0, MAX_FIELDS) : [];
  const taken = new Set<string>();
  return fields.map((raw: unknown) => {
    const field = isFieldSpec(raw) ? raw : {};
    const labelled = text(field.label).trim();
    const written = storedName(field.name);
    const name = uniqueName(
      written === "" ? sentNameOf(labelled) : written,
      taken
    );
    const type = oneOf(field.type, FORM_FIELD_TYPES, "text");
    return {
      name,
      // A label with no text announces nothing, so the sent name stands in.
      // It is a worse label than one an author wrote and a far better one
      // than silence.
      label: labelled === "" ? name : labelled,
      type,
      required: flag(field.required),
      options: FORM_CHOICE_TYPES.includes(type) ? optionsOf(field.options) : [],
    };
  });
}

/**
 * A simple form's fields as every form is drawn and checked: the one
 * description its controls are drawn from and the receiver checks a post
 * against. A Dropdown or Choice offers exactly its options, each sent as
 * its own words.
 */
export function formFieldDrawings(props: {
  readonly fields?: unknown;
}): FormFieldDrawing[] {
  return formFields(props).map(field => ({
    name: field.name,
    label: field.label,
    kind: field.type,
    required: field.required,
    ...(FORM_CHOICE_TYPES.includes(field.type)
      ? {
          options: field.options.map(option => ({
            value: option,
            label: option,
          })),
        }
      : {}),
  }));
}
