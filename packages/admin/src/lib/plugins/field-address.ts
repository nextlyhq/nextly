/**
 * A field's address in a document, and where it sits in the document's form.
 *
 * A document view names the field it edits by its path from the document's
 * root (`?field=`). A group adds its name to that path. A repeater adds its
 * name and then the ROW, and a row is named by its saved id rather than its
 * position: `sections.<rowId>.body`. The form names the same field by position
 * (`sections.1.body`), since that is how its rows are held, and a position
 * names another row as soon as the rows are reordered, so it is never what an
 * address carries.
 *
 * Both directions are answered here, from one description of the path (its
 * steps): an address to the form path it names now, for the view, and a form
 * path to its address, for the way in from the form. Neither falls back to a
 * row's position: an address whose row is gone is refused, never pointed at
 * the row that now stands where it stood.
 *
 * @module lib/plugins/field-address
 */
import { declaresOwnId } from "nextly/field-catalog";

import { repeaterRowTitle } from "@admin/components/features/entries/fields/structured/repeater-row-title";
import { fieldLabel } from "@admin/lib/field-label";

/**
 * One step of a field's path from the document's root: a field's name, or the
 * row of the repeater named by the step before it.
 */
export type AddressStep<F extends object> =
  | { kind: "name"; name: string }
  | { kind: "row"; repeater: F };

/** A row an address passes through, as it stands in the values read. */
export interface AddressedRow<F extends object> {
  repeater: F;
  /** The row's saved id: the address's step. */
  id: string;
  /** Where the row stands in its list now: the form path's step. */
  index: number;
  row: Record<string, unknown>;
}

/**
 * Why an address does not open a field it names the steps of:
 *
 * - `rowGone`: no row of that repeater has the id the address names;
 * - `position`: the address names a row by its position, which opens another
 *   row once the rows are reordered;
 * - `ownIds`: the repeater's rows declare their own `id` field, so they have
 *   no saved id to be addressed by.
 */
export type RowAddressRefusal = "rowGone" | "position" | "ownIds";

/**
 * Why a field in the form has no address yet:
 *
 * - `unsavedRow`: a row on its path has not been saved with its id, so a
 *   reload would not find it;
 * - `ownIds`: a repeater on its path keeps its own `id` field;
 * - `unaddressable`: a row's saved id cannot be one step of a dotted path.
 */
export type RowPathRefusal = "unsavedRow" | "ownIds" | "unaddressable";

/** An address resolved against one copy of the document's values. */
export type AddressResolution<F extends object> =
  | {
      kind: "found";
      /** The form path the address names in those values. */
      formPath: string;
      /** The rows on the way, outermost first. */
      rows: AddressedRow<F>[];
    }
  | { kind: "refused"; reason: RowAddressRefusal };

/** A form path as an address, or why it has none. */
export type FormPathAddress =
  | { kind: "address"; address: string }
  | { kind: "refused"; reason: RowPathRefusal };

/** Whether a path passes through a repeater's row. */
export function hasRowStep<F extends object>(
  steps: readonly AddressStep<F>[]
): boolean {
  return steps.some(step => step.kind === "row");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at a path of steps already in form spelling, if any. */
function valueAtParts(
  values: Record<string, unknown> | undefined,
  parts: readonly string[]
): unknown {
  let at: unknown = values;
  for (const part of parts) {
    if (Array.isArray(at)) {
      at = at[Number(part)];
    } else if (isRecord(at)) {
      at = at[part];
    } else {
      return undefined;
    }
  }
  return at;
}

/**
 * A row's id as an address step, or `undefined` when it cannot be one: absent,
 * empty, or holding a dot, which would split the step in two.
 */
function idOfRow(row: unknown): string | undefined {
  if (!isRecord(row)) return undefined;
  const { id } = row;
  return typeof id === "string" && id !== "" && !id.includes(".")
    ? id
    : undefined;
}

/**
 * Whether a repeater's rows carry the system's saved id: every repeater's do,
 * except one whose rows declare their own `id` field. Core's one rule.
 */
export function rowsCarryIds(repeater: object): boolean {
  const fields = (repeater as { fields?: unknown }).fields;
  return !declaresOwnId(Array.isArray(fields) ? fields : []);
}

/** Whether every name step of `steps` is the same part of `parts`. */
function namesMatch<F extends object>(
  steps: readonly AddressStep<F>[],
  parts: readonly string[]
): boolean {
  return (
    steps.length === parts.length &&
    steps.every(
      (step, index) => step.kind === "row" || step.name === parts[index]
    )
  );
}

/**
 * One row step of an address: the row of `repeater` whose saved id is `id`, in
 * the list at `listParts` of `values`, with where it stands now; or why there
 * is none. Kept apart from the walk over the steps so the one rule — a row is
 * found by its id and nothing else — reads in one place.
 *
 * Never by position: an `id` that matches no row's id refuses the step, even
 * when a row stands at that position, and one spelled as a position is said to
 * be one rather than taken for it.
 */
function rowById<F extends object>(
  repeater: F,
  id: string,
  values: Record<string, unknown> | undefined,
  listParts: readonly string[]
): AddressedRow<F> | RowAddressRefusal {
  if (!rowsCarryIds(repeater)) return "ownIds";
  const list = valueAtParts(values, listParts);
  const at = Array.isArray(list)
    ? list.findIndex(row => idOfRow(row) === id)
    : -1;
  const row: unknown = Array.isArray(list) ? list[at] : undefined;
  if (at === -1 || !isRecord(row)) {
    return /^\d+$/.test(id) ? "position" : "rowGone";
  }
  return { repeater, id, index: at, row };
}

/**
 * The form path `address` names in `values`, finding each row by its saved id
 * wherever it now stands (`rowById`); or why it names none. `null` when the
 * address is not a path of these steps at all.
 */
export function resolveAddress<F extends object>(
  steps: readonly AddressStep<F>[],
  address: string,
  values: Record<string, unknown> | undefined
): AddressResolution<F> | null {
  const parts = address.split(".");
  if (!namesMatch(steps, parts)) return null;
  const formParts: string[] = [];
  const rows: AddressedRow<F>[] = [];
  for (const [index, step] of steps.entries()) {
    if (step.kind === "name") {
      formParts.push(step.name);
      continue;
    }
    const found = rowById(step.repeater, parts[index] ?? "", values, formParts);
    if (typeof found === "string") return { kind: "refused", reason: found };
    rows.push(found);
    formParts.push(String(found.index));
  }
  return { kind: "found", formPath: formParts.join("."), rows };
}

/**
 * Why a row in the form has no id an address can carry: one whose id holds a
 * dot cannot be one step of a dotted path; any other has not been saved with
 * an id yet.
 */
function missingIdReason(row: unknown): RowPathRefusal {
  const raw = isRecord(row) ? row.id : undefined;
  return typeof raw === "string" && raw.includes(".")
    ? "unaddressable"
    : "unsavedRow";
}

/**
 * One row step of a form path as an address step: the saved id of the row at
 * `rowParts` (the path down to and including its position), or why it has
 * none. `null` when the step is not a position, so the form path is not one
 * of these steps. Kept apart from the walk so each refusal reads in one place.
 */
function rowStepId<F extends object>(
  repeater: F,
  rowParts: readonly string[],
  values: Record<string, unknown> | undefined
): { id: string } | { refused: RowPathRefusal } | null {
  if (!/^\d+$/.test(rowParts[rowParts.length - 1] ?? "")) return null;
  if (!rowsCarryIds(repeater)) return { refused: "ownIds" };
  const row = valueAtParts(values, rowParts);
  const id = idOfRow(row);
  return id === undefined ? { refused: missingIdReason(row) } : { id };
}

/**
 * The address of the field at `formPath` in `values`: its rows named by their
 * saved ids. Refused where a row on the way has no id that is saved — found in
 * `saved`, the values as last loaded or stored — since an address to it would
 * not survive a reload. `null` when the form path is not one of these steps.
 */
export function addressOfFormPath<F extends object>(
  steps: readonly AddressStep<F>[],
  formPath: string,
  values: Record<string, unknown> | undefined,
  saved: Record<string, unknown> | undefined
): FormPathAddress | null {
  const formParts = formPath.split(".");
  if (!namesMatch(steps, formParts)) return null;
  const addressParts: string[] = [];
  for (const [index, step] of steps.entries()) {
    if (step.kind === "name") {
      addressParts.push(step.name);
      continue;
    }
    const found = rowStepId(
      step.repeater,
      formParts.slice(0, index + 1),
      values
    );
    if (found === null) return null;
    if ("refused" in found) return { kind: "refused", reason: found.refused };
    addressParts.push(found.id);
  }
  const address = addressParts.join(".");
  // The address must find the same rows in the saved document: a row added
  // since the last save has an id here and none there.
  const stored = resolveAddress(steps, address, saved);
  if (stored === null || stored.kind === "refused") {
    return { kind: "refused", reason: "unsavedRow" };
  }
  return { kind: "address", address };
}

/**
 * Every address these steps name in `values`: one for each combination of
 * rows that have an id an address can carry, outermost row first. A path
 * without rows names one address, its own.
 */
export function addressesIn<F extends object>(
  steps: readonly AddressStep<F>[],
  values: Record<string, unknown> | undefined
): string[] {
  const expand = (
    from: number,
    formParts: string[],
    addressParts: string[]
  ): string[] => {
    const step = steps[from];
    if (step === undefined) return [addressParts.join(".")];
    if (step.kind === "name") {
      return expand(
        from + 1,
        [...formParts, step.name],
        [...addressParts, step.name]
      );
    }
    if (!rowsCarryIds(step.repeater)) return [];
    const list = valueAtParts(values, formParts);
    if (!Array.isArray(list)) return [];
    return list.flatMap((row, index) => {
      const id = idOfRow(row);
      return id === undefined
        ? []
        : expand(
            from + 1,
            [...formParts, String(index)],
            [...addressParts, id]
          );
    });
  };
  return expand(0, [], []);
}

/**
 * Where a field sits, in words an author reads: each container's label, each
 * row's title as the form's own row header shows it, then the field's label —
 * `Sections · Hero banner · Body`. `named` are the named declarations along
 * the path, outermost first, ending with the field: one for each name step.
 */
export function locationLabel<F extends object>(
  steps: readonly AddressStep<F>[],
  named: readonly object[],
  rows: readonly AddressedRow<F>[]
): string {
  let nextName = 0;
  let nextRow = 0;
  return steps
    .map(step => {
      if (step.kind === "row") {
        const row = rows[nextRow++];
        return row === undefined
          ? ""
          : repeaterRowTitle(row.repeater, row.row, row.index).title;
      }
      const declaration = named[nextName++];
      const label =
        declaration !== undefined &&
        "label" in declaration &&
        typeof declaration.label === "string"
          ? declaration.label
          : undefined;
      return fieldLabel({ name: step.name, label });
    })
    .filter(part => part !== "")
    .join(" · ");
}
