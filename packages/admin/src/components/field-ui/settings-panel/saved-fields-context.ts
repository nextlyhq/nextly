/**
 * The fields as last saved, by id, for the parts of the settings panel that judge a field against
 * its saved definition: a condition comparing a saved dropdown with one of its options is broken
 * once that dropdown is another type (`brokenConditionOf`). A surface that keeps a saved definition
 * (the Schema Builder) provides it; elsewhere it is empty, and only the fields as they stand are
 * judged.
 *
 * @module components/field-ui/settings-panel/saved-fields-context
 */
import { createContext, useContext, useMemo } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { fieldsById } from "@admin/lib/builder/condition-identity";

const NO_SAVED_FIELDS: readonly BuilderField[] = [];

const SavedFieldsContext =
  createContext<readonly BuilderField[]>(NO_SAVED_FIELDS);

/** Provides the fields as last saved. */
export const SavedFieldsProvider = SavedFieldsContext.Provider;

/** The fields as last saved: none outside a provider. */
export function useSavedFields(): readonly BuilderField[] {
  return useContext(SavedFieldsContext);
}

/** The fields as last saved, by id, at any depth (`fieldsById`). */
export function useSavedFieldsById(): ReadonlyMap<string, BuilderField> {
  const saved = useSavedFields();
  return useMemo(() => fieldsById(saved), [saved]);
}
