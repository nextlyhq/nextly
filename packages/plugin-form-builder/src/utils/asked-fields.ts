/**
 * What a submission was asked: each field's label, type and option labels,
 * and which fields its conditions hid, kept with the submission so its page
 * reads as it was answered after the form changes. A field renamed, an
 * option relabelled or a condition changed later leaves the submission as it
 * was. A submission stored before this kept nothing, and reads with the form
 * as it is now.
 *
 * @module utils/asked-fields
 */

import type { AnyFormField } from "../types";

import { fieldsHiddenByCondition } from "./condition-visibility";

/** One field as the submission was asked it. */
export interface AskedField {
  name: string;
  label: string;
  type: string;
  /** The choices of a select or radio, value and label as shown. */
  options?: Array<{ value: string; label: string }>;
}

/** What a submission was asked, as stored with it. */
export interface AskedSnapshot {
  fields: AskedField[];
  /** The fields its conditions hid from the visitor, so never asked. */
  hidden: string[];
}

/** A stored option value or label as text: a string or a number. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

/** One form field as a submission keeps it. */
function askedField(field: AnyFormField): AskedField {
  const options = (field as { options?: unknown }).options;
  return {
    name: field.name,
    label: field.label || field.name,
    type: field.type,
    ...(Array.isArray(options)
      ? {
          options: options.map(option => {
            const { value, label } = option as {
              value?: unknown;
              label?: unknown;
            };
            const text = textOf(value);
            return { value: text, label: textOf(label) || text };
          }),
        }
      : {}),
  };
}

/** What a new submission with `data` was asked, from its form's fields. */
export function askedSnapshotOf(
  fields: readonly AnyFormField[],
  data: Record<string, unknown>
): AskedSnapshot {
  const hidden = fieldsHiddenByCondition([...fields], data);
  return {
    fields: fields.map(askedField),
    hidden: fields.map(field => field.name).filter(name => hidden.has(name)),
  };
}

/** A stored snapshot, read: as written, or a JSON string of it. */
export function readAskedSnapshot(value: unknown): AskedSnapshot | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const { fields, hidden } = parsed as Record<string, unknown>;
  if (!Array.isArray(fields)) return undefined;
  return {
    fields: fields.filter(
      (field): field is AskedField =>
        !!field &&
        typeof (field as AskedField).name === "string" &&
        typeof (field as AskedField).label === "string" &&
        typeof (field as AskedField).type === "string"
    ),
    hidden: Array.isArray(hidden)
      ? hidden.filter((name): name is string => typeof name === "string")
      : [],
  };
}

/**
 * The snapshot after staff edit answers. An answer that changed is read with
 * the field as it was when edited to, so an edit to an option added later
 * keeps that option's label; every other field stays as the visitor was
 * asked it. A submission with no snapshot keeps none.
 */
export function askedAfterEdit(
  stored: AskedSnapshot | undefined,
  fields: readonly AnyFormField[],
  before: Record<string, unknown>,
  after: Record<string, unknown>
): AskedSnapshot | undefined {
  if (stored === undefined) return undefined;
  const changed = new Set(
    fields
      .map(field => field.name)
      .filter(
        name => JSON.stringify(before[name]) !== JSON.stringify(after[name])
      )
  );
  if (changed.size === 0) return stored;
  const current = new Map(fields.map(field => [field.name, field]));
  const kept = stored.fields.map(field =>
    changed.has(field.name) && current.has(field.name)
      ? askedField(current.get(field.name)!)
      : field
  );
  // A field answered by the edit that the visitor was never asked.
  for (const name of changed) {
    if (!kept.some(field => field.name === name) && current.has(name)) {
      kept.push(askedField(current.get(name)!));
    }
  }
  return {
    fields: kept,
    hidden: stored.hidden.filter(name => !changed.has(name)),
  };
}

/**
 * The fields a submission's page reads its answers with: as it was asked, or
 * the form as it is now for one stored before submissions kept that.
 */
export function askedFieldsOf(
  stored: unknown,
  formFields: readonly AnyFormField[],
  data: Record<string, unknown>
): AskedSnapshot {
  return readAskedSnapshot(stored) ?? askedSnapshotOf(formFields, data);
}
