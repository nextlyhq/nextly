"use client";

/**
 * A field's address in its document, for a way into a view of it.
 *
 * A field is rendered with its form path, and inside a repeater's row that
 * path names the row by its position (`sections.1.body`). A position names
 * another row once the rows are reordered, so an address to the field names
 * the row by its saved id instead (`sections.<rowId>.body`): the address a
 * document view resolves, by the same walk, wherever the row has moved.
 *
 * @module components/features/entries/EntryForm/useFieldAddress
 */
import {
  useFormState,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { rowFieldAddress } from "@admin/lib/plugins/document-view-registry";
import type { RowPathRefusal } from "@admin/lib/plugins/field-address";

import { useOptionalEntryFormContext } from "./EntryFormContext";

/**
 * A field's address from the document's root, or why it has none yet:
 *
 * - `unsavedRow`: a row on its path has not been saved, so its id would not
 *   be found after a reload; saving the entry once gives it one;
 * - `ownIds`: a repeater on its path has rows that set their own `id` field,
 *   so its rows have no saved identity;
 * - `unaddressable`: the path runs through a row this form cannot name by id.
 *
 * @experimental
 */
export type FieldAddress =
  | {
      address: string;
      /**
       * Set for a field inside a repeater's row, whose address names the row
       * by its saved id. Said outright rather than inferred from the address
       * differing from the form path: a row whose saved id is the same as its
       * position spells both the same.
       */
      throughRow?: true;
    }
  | { unavailable: RowPathRefusal };

/** Whether a form path steps through a repeater's row, which it numbers. */
function throughRow(formPath: string): boolean {
  return formPath.split(".").some(part => /^\d+$/.test(part));
}

/**
 * The address of the field at `formPath` in the form `control` drives.
 *
 * Outside repeaters the address is the form path itself. Inside a row, it
 * names each row by the id the row was last saved with; a row added since the
 * last save has no address yet. Only the top-level field holding the row is
 * watched, so the address follows the row as it moves.
 *
 * @experimental
 */
export function useFieldAddress<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>,
  formPath: string
): FieldAddress {
  const inRow = throughRow(formPath);
  const root = formPath.split(".")[0] ?? formPath;
  const fields = useOptionalEntryFormContext()?.fields;
  // The form path is a field's own, so its first step names a field of the
  // form; the cast only restates that for the generic form type.
  const held: unknown = useWatch({
    control,
    name: root as Path<TFieldValues>,
    disabled: !inRow,
  });
  const { defaultValues } = useFormState({ control, disabled: !inRow });
  if (!inRow) return { address: formPath };
  const found = rowFieldAddress(
    fields,
    formPath,
    { [root]: held },
    defaultValues as Record<string, unknown> | undefined
  );
  if (found === undefined) return { unavailable: "unaddressable" };
  return found.kind === "address"
    ? { address: found.address, throughRow: true }
    : { unavailable: found.reason };
}
