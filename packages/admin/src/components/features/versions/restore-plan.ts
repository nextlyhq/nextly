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

import { sameFormValue } from "./same-form-value";
import {
  formFieldsOf,
  snapshotToFormValues,
  type NamedField,
} from "./snapshot-to-form-values";
import type { VersionChanges } from "./version-changes";

/** Why a field is listed but cannot be restored. */
export type RestoreRowDisabled =
  | "hidden"
  | "read-only"
  | "removed"
  | "no-language";

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
  /** The fields the comparison names as no longer in the content type. */
  removed?: ReadonlySet<string>;
  /**
   * The language the version holds: null for one that holds none. On a
   * translated document such a version's translated values belong to no
   * language, so only its shared fields are restored, as the server's own
   * restore of it does.
   */
  versionLocale?: string | null;
}

/** The reasons R-8 gives the person, as they read them. */
const REASONS: Record<RestoreRowDisabled, string> = {
  hidden: "Hidden: you can't read this field",
  "read-only": "You can't edit this field",
  removed: "No longer in this content type",
  "no-language": "This version holds no language for this field",
};

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
    // A value the version cleared stays cleared: the form reads an empty
    // stored value as no value, and an undefined one would be dropped by
    // the save rather than clear the field.
    const value = Object.hasOwn(versionValues, name)
      ? versionValues[name]
      : storedEmpty(input.snapshot[name]);
    if (sameFormValue(value, input.current[name])) continue;
    // A translated value of a version that holds no language belongs to no
    // language, so it is never put into the language being edited.
    if (
      input.versionLocale === null &&
      input.translatable?.has(name) === true
    ) {
      rows.push({ ...base, ...disabledAs("no-language") });
      continue;
    }
    rows.push(
      input.canEdit(name)
        ? { ...base, chosen: true, value }
        : { ...base, ...disabledAs("read-only") }
    );
  }

  // A field the version holds that the content type no longer has, as the
  // comparison names it: a key the snapshot carries that is not a field may
  // just as well be a column the system keeps, which no one restores.
  const known = new Set(formFields.map(field => field.name));
  for (const key of input.removed ?? []) {
    if (known.has(key) || !Object.hasOwn(input.snapshot, key)) continue;
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

/** An empty value as the version stored it: its own "" or [], else null. */
function storedEmpty(stored: unknown): unknown {
  if (stored === "" || (Array.isArray(stored) && stored.length === 0)) {
    return stored;
  }
  return null;
}

function disabledAs(disabled: RestoreRowDisabled): {
  chosen: false;
  disabled: RestoreRowDisabled;
  reason: string;
} {
  return { chosen: false, disabled, reason: REASONS[disabled] };
}

function labelOf(field: NamedField): string {
  const label = (field as { label?: unknown }).label;
  return typeof label === "string" && label.length > 0 ? label : field.name;
}

/**
 * Whether a version can be restored into this editor: one of the language
 * being edited, or one that holds no language. Another language's version
 * would put its translated values into this language's fields, so it is
 * restored from that language's editor instead.
 */
export function restoresInEditor(
  versionLocale: string | null | undefined,
  editorLocale: string | undefined
): boolean {
  return !versionLocale || !editorLocale || versionLocale === editorLocale;
}

/**
 * The fields a comparison names as no longer in the content type: the server
 * tells them apart from the columns it keeps, which are named "system".
 */
export function removedFieldsOf(
  changes: VersionChanges | null
): ReadonlySet<string> {
  const removed = new Set<string>();
  for (const [name, node] of changes?.byField ?? []) {
    if (node.kind === "unknown" && node.reason === "removed") removed.add(name);
  }
  return removed;
}
