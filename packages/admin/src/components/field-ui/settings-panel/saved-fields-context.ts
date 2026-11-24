/**
 * The fields as last saved, for the parts of the settings panel that judge a field against its saved
 * definition: a condition comparing a saved dropdown with one of its options is broken once that
 * dropdown is another type (`brokenConditionOf`). A surface that keeps a saved definition (the
 * Schema Builder) provides it; elsewhere it is empty, and only the fields as they stand are judged.
 *
 * @module components/field-ui/settings-panel/saved-fields-context
 */
import { createContext, useContext, useMemo } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { savedPlaceOf } from "@admin/lib/builder/condition-identity";
import type { FieldPlacement } from "@admin/lib/builder/field-placement";

const NO_SAVED_FIELDS: readonly BuilderField[] = [];

const SavedFieldsContext =
  createContext<readonly BuilderField[]>(NO_SAVED_FIELDS);

/** Provides the fields as last saved. */
export const SavedFieldsProvider = SavedFieldsContext.Provider;

/** The fields as last saved: none outside a provider. */
export function useSavedFields(): readonly BuilderField[] {
  return useContext(SavedFieldsContext);
}

/**
 * Where the field `fieldId` stands in the fields as last saved, with the containers above it as they
 * are now (`savedPlaceOf`): undefined where it was not saved, or its place is not one to tell.
 */
export function useSavedPlaceOf(
  fieldId: string,
  ancestors: readonly BuilderField[]
): FieldPlacement | undefined {
  const saved = useSavedFields();
  return useMemo(
    () => savedPlaceOf(saved, fieldId, ancestors),
    [saved, fieldId, ancestors]
  );
}
