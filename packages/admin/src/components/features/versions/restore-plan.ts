/**
 * Which fields "Restore…" lists, and how each is offered.
 *
 * Every field the version holds differently from the editor is listed and
 * chosen. A field the person may not read (the server withheld it), may read
 * but not change, or that is no longer in the content type is listed unchosen
 * and disabled, with its reason, and a hidden field's value is never carried.
 * A field with an unsaved edit is marked, since restoring it replaces that
 * edit. On a translated document each shared field is named as changing every
 * language.
 *
 * @module components/features/versions/restore-plan
 */

import type { FieldConfig } from "nextly/config";

import { formFieldsOf, snapshotToFormValues } from "./snapshot-to-form-values";

/** Why a field is listed but cannot be restored. */
export type RestoreRowDisabled = "hidden" | "read-only" | "removed";

/** One field the version holds differently from the editor. */
export interface RestoreRow {
  name: string;
  label: string;
  /** Chosen for the restore; a disabled field never is. */
  chosen: boolean;
  disabled?: RestoreRowDisabled;
  /** The reason a disabled field cannot be restored, as the person reads it. */
  reason?: string;
  /** Whether restoring it replaces an unsaved edit in the editor. */
  replacesUnsaved: boolean;
  /** Whether it is a shared field of a translated document: every language. */
  shared: boolean;
  /** The version's value; absent for a field whose value never reaches here. */
  value?: unknown;
}

export interface RestorePlanInput {
  /** The content type's fields as they are now. */
  fields: FieldConfig[];
  /** The version's values, as the server returned them to this person. */
  snapshot: Record<string, unknown>;
  /** The editor's values now. */
  current: Record<string, unknown>;
  /** The fields with unsaved edits. */
  dirty: ReadonlySet<string>;
  /** The fields the server withheld from this person. */
  withheld: readonly string[];
  /** Whether this person may change a field. */
  canEdit: (name: string) => boolean;
  /** The translated fields, where the document is translated. */
  translatable?: ReadonlySet<string>;
}

/** The reasons R-8 gives the person, as they read them. */
const REASONS: Record<RestoreRowDisabled, string> = {
  hidden: "Hidden: you can't read this field",
  "read-only": "You can't edit this field",
  removed: "No longer in this content type",
};

/**
 * Keys a document carries that no one edits: its id, its timestamps, its
 * status (which a restore never touches) and the transport keys the server
 * adds, all spelled with a leading underscore.
 */
const NOT_EDITED = new Set(["id", "createdAt", "updatedAt", "status"]);

function isEditedKey(key: string): boolean {
  return !NOT_EDITED.has(key) && !key.startsWith("_");
}

export function restorePlan(input: RestorePlanInput): RestoreRow[] {
  const withheld = new Set(input.withheld.map(path => path.split(".")[0]));
  const versionValues = snapshotToFormValues(input.fields, input.snapshot);
  const formFields = formFieldsOf(input.fields);
  const rows: RestoreRow[] = [];

  for (const field of formFields) {
    const name = field.name;
    const base = {
      name,
      label: labelOf(field),
      replacesUnsaved: input.dirty.has(name),
      shared: input.translatable ? !input.translatable.has(name) : false,
    };
    // Hidden from this person: whether it changed cannot be told, and its
    // value never reaches the editor.
    if (withheld.has(name)) {
      rows.push({ ...base, ...disabledAs("hidden") });
      continue;
    }
    // A field the version does not hold is not the version's to restore.
    if (!Object.hasOwn(input.snapshot, name)) continue;
    const value = versionValues[name];
    if (sameValue(value, input.current[name])) continue;
    rows.push(
      input.canEdit(name)
        ? { ...base, chosen: true, value }
        : { ...base, ...disabledAs("read-only") }
    );
  }

  // A key the version holds that the content type no longer has.
  const known = new Set(formFields.map(field => field.name));
  for (const key of Object.keys(input.snapshot)) {
    if (known.has(key) || !isEditedKey(key)) continue;
    rows.push({
      name: key,
      label: key,
      replacesUnsaved: false,
      shared: false,
      ...disabledAs("removed"),
    });
  }
  return rows;
}

function disabledAs(disabled: RestoreRowDisabled): {
  chosen: false;
  disabled: RestoreRowDisabled;
  reason: string;
} {
  return { chosen: false, disabled, reason: REASONS[disabled] };
}

function labelOf(field: FieldConfig): string {
  const label = (field as { label?: unknown }).label;
  return typeof label === "string" && label.length > 0 ? label : field.name;
}

/**
 * Whether two form values are the same value: structural, key order aside,
 * array order kept. An absent value and null are the same empty value, as the
 * form renders both blank.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}
