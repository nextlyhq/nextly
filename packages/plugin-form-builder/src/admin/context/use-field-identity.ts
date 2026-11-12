"use client";

/**
 * A field's identity while it is edited, held by the form editor's provider
 * so it outlasts the list that shows it.
 *
 * A form stores no field ids: a field is known by its name, and the name is
 * the one thing a rename rewrites on every keystroke. So each field gets a key
 * here that follows it through renames (the list's React key and the settings
 * panel's id), and a rename that clears the Name input first still moves the
 * references from the name the rest of the form knows the field by.
 *
 * Held here rather than in the list: the list is not drawn while another page
 * of the editor is open, and what it held would be lost on the way back.
 *
 * @module admin/context/use-field-identity
 */
import { useCallback, useRef } from "react";

import type { AnyFormField } from "../../types";

import { generateFieldName } from "./field-names";

export interface FieldIdentity {
  /** The key a field is known by while edited, whatever its name becomes. */
  fieldKey: (name: string) => string;
  /**
   * Replace `field` with its edited definition. A new name another field
   * already has is made unique, and the references to the field move from
   * the name the form knows it by, even through an empty one.
   */
  editField: (
    field: AnyFormField,
    next: AnyFormField,
    fields: readonly AnyFormField[]
  ) => void;
}

/** `next`, with a name no other field has. */
function uniquelyNamed(
  field: AnyFormField,
  next: AnyFormField,
  fields: readonly AnyFormField[]
): AnyFormField {
  if (next.name === "" || next.name === field.name) return next;
  // A name is the key its answers are stored under, so two fields never
  // share one: a rename onto another field's name is made unique the way
  // the picker makes a new name unique.
  const others = fields.filter(each => each !== field).map(each => each.name);
  return others.includes(next.name)
    ? { ...next, name: generateFieldName(next.name, others) }
    : next;
}

/**
 * @param replaceField - the provider's own replace, which moves the
 *   references from the name it is given
 */
export function useFieldIdentity(
  replaceField: (
    fieldName: string,
    next: AnyFormField,
    referencesFrom?: string
  ) => void
): FieldIdentity {
  const keys = useRef(new Map<string, string>());
  const nextKey = useRef(0);
  // The name a field had before its Name was cleared, by key.
  const clearedFrom = useRef(new Map<string, string>());

  const fieldKey = useCallback((name: string): string => {
    let key = keys.current.get(name);
    if (key === undefined) {
      nextKey.current += 1;
      key = `field-${nextKey.current}`;
      keys.current.set(name, key);
    }
    return key;
  }, []);

  const editField = useCallback(
    (
      field: AnyFormField,
      next: AnyFormField,
      fields: readonly AnyFormField[]
    ) => {
      const updated = uniquelyNamed(field, next, fields);
      const key = fieldKey(field.name);
      if (updated.name !== field.name) {
        // The key moves to the incoming name before the state update
        // re-renders, so the renamed field keeps its row and its panel.
        keys.current.delete(field.name);
        keys.current.set(updated.name, key);
      }
      // The name the rest of the form refers to the field by.
      const referencedAs =
        field.name !== "" ? field.name : clearedFrom.current.get(key);
      if (updated.name === "" && referencedAs !== undefined) {
        clearedFrom.current.set(key, referencedAs);
      } else if (updated.name !== "") {
        clearedFrom.current.delete(key);
      }
      replaceField(field.name, updated, referencedAs);
    },
    [fieldKey, replaceField]
  );

  return { fieldKey, editField };
}
