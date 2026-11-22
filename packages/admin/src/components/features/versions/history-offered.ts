"use client";

/**
 * Whether a document offers its history: the one rule every control that
 * opens it asks (the document bar's History, a Single's side panel), so no
 * two can disagree about whether the same history opens.
 *
 * A document only has history once it has been saved, and drawing a version
 * needs the schema's fields, so both are required. The history is read in
 * every language, as the server judges it, so a person who may read only
 * some of it is not offered it.
 *
 * @module components/features/versions/history-offered
 */

import { useCanRequest } from "@admin/hooks/useCanRequest";

/** What the rule reads of the document and its type. */
export interface HistoryOfferFacts {
  /** Create mode has nothing saved to show the history of. */
  mode: "create" | "edit";
  /** The saved document's id; absent before its first save. */
  documentId: unknown;
  /** The type's fields, which draw a version; absent until they are known. */
  fields: readonly unknown[] | undefined;
  /** Whether the type keeps versions (`historyEnabledFrom`); undefined where it does not say. */
  enabled: boolean | undefined;
}

/** Whether the document of the collection or Single `slug` offers its history. */
export function useHistoryOffered(
  slug: string,
  facts: HistoryOfferFacts
): boolean {
  const mayReadHistory = useCanRequest(slug, "readHistory");
  return (
    facts.mode === "edit" &&
    Boolean(facts.documentId) &&
    facts.fields !== undefined &&
    facts.enabled !== false &&
    mayReadHistory
  );
}
