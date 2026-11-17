/**
 * The forms plugin's fields as a form provider describes them: each of its
 * field types as the plain HTML control the page builder's Form block draws,
 * with its label, help, placeholder, options and limits.
 *
 * What a control cannot say is carried as opaque values for the plugin's own
 * script (`provider`), a conditional field's condition among them. Without
 * that script every field shows, and the plugin's server already leaves the
 * answers to a field whose condition failed out of what it checks and keeps.
 *
 * @module form-provider/describe-fields
 */
import type {
  FormFieldDescription,
  FormFieldKind,
} from "@nextlyhq/plugin-sdk/blocks";

import type { AnyFormField } from "../types";

/** The control each of the plugin's own field types is drawn as. */
export const FIELD_KINDS: Readonly<Record<string, FormFieldKind>> = {
  text: "text",
  email: "email",
  number: "number",
  phone: "tel",
  url: "url",
  textarea: "textarea",
  select: "select",
  checkbox: "checkbox",
  radio: "radio",
  file: "file",
  date: "date",
  time: "time",
  hidden: "hidden",
  consent: "checkbox",
};

/** A finite number, or `undefined`. */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Non-empty text, or `undefined`. */
function words(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** A select's or radio's options, as stored, each with a value and its words. */
function optionsOf(
  field: Record<string, unknown>
): { value: string; label: string }[] {
  const stored = Array.isArray(field.options) ? field.options : [];
  return stored.flatMap(option => {
    if (typeof option !== "object" || option === null) return [];
    const { value, label } = option as Record<string, unknown>;
    if (typeof value !== "string" || value === "") return [];
    return [{ value, label: typeof label === "string" ? label : value }];
  });
}

/** The words a field is labelled with: a consent box's are what it agrees to. */
function labelOf(field: AnyFormField, raw: Record<string, unknown>): string {
  const own = words(field.label) ?? field.name;
  return field.type === "consent" ? (words(raw.agreementText) ?? own) : own;
}

/** A field's help and placeholder, where it has them. */
function wordingOf(
  field: AnyFormField
): Pick<FormFieldDescription, "help" | "placeholder"> {
  const help = words(field.helpText);
  const placeholder = words(field.placeholder);
  return {
    ...(help === undefined ? {} : { help }),
    ...(placeholder === undefined ? {} : { placeholder }),
  };
}

/** The limits a control states: a number's bounds, a file's types, a pattern. */
function limitsOf(
  field: AnyFormField,
  raw: Record<string, unknown>
): Pick<FormFieldDescription, "accept" | "min" | "max" | "pattern"> {
  const validation = (raw.validation ?? {}) as Record<string, unknown>;
  const number = field.type === "number";
  const min = number ? finite(validation.min) : undefined;
  const max = number ? finite(validation.max) : undefined;
  const accept = field.type === "file" ? words(raw.accept) : undefined;
  const pattern = words(validation.pattern);
  return {
    ...(accept === undefined ? {} : { accept }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(pattern === undefined ? {} : { pattern }),
  };
}

/**
 * One of the plugin's fields as a description, or `undefined` for a field
 * no plain control can take (a type another plugin added).
 */
export function describeField(
  field: AnyFormField
): FormFieldDescription | undefined {
  const raw = field as unknown as Record<string, unknown>;
  const kind = FIELD_KINDS[field.type];
  if (kind === undefined || typeof field.name !== "string") return undefined;
  const choices = field.type === "select" || field.type === "radio";
  // A Dropdown taking several answers is drawn as a group of checkboxes, the
  // control that sends one name more than once.
  const many = field.type === "select" && raw.allowMultiple === true;
  return {
    name: field.name,
    label: labelOf(field, raw),
    kind: many ? "checkbox" : kind,
    // A conditional field's requirement holds only while its condition does,
    // which the plugin's server judges; the browser would demand it always.
    ...(field.required === true && !conditional(raw) ? { required: true } : {}),
    ...wordingOf(field),
    ...(choices ? { options: optionsOf(raw) } : {}),
    ...limitsOf(field, raw),
    ...providerData(raw),
  };
}

/** Whether a field's showing depends on a condition. */
function conditional(field: Record<string, unknown>): boolean {
  return (
    (field.conditionalLogic as { enabled?: unknown } | undefined)?.enabled ===
    true
  );
}

/**
 * What the plugin's own script reads about a field and a control cannot
 * say: its condition, as the plugin stores it. Opaque to the page builder.
 */
function providerData(field: Record<string, unknown>): {
  provider?: Record<string, string>;
} {
  const logic = field.conditionalLogic as { enabled?: unknown } | undefined;
  if (logic?.enabled !== true) return {};
  return { provider: { "forms-condition": JSON.stringify(logic) } };
}
