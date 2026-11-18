"use client";

/**
 * Whether the admin would draw one contribution at a place for a document:
 * the read a plugin asks when it draws the same thing somewhere else, so it
 * shows there exactly where the admin's own page would, and never keeps a
 * copy of the rule that could go stale.
 *
 * The answer is the one the place's own page reaches, by the same functions:
 * the contribution must be delivered to this reader (the server has already
 * left out what they may not see, and narrowed a contribution to the types
 * it is offered on), it must be drawable for the document (`entriesDrawnHere`:
 * its collections or Singles, and its `visibleWhen` rule against the entry),
 * and a tab that edits fields of the document must find every one of them
 * among the document's top-level fields (`tabsFittingDocument`), as an edit
 * page's row of tabs does.
 *
 * @module components/shared/target-slot/useContributionApplies
 */
import type { AdminPlaceId } from "nextly/config";

import { useOptionalEntryFormContext } from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import {
  entriesDrawnHere,
  tabsFittingDocument,
} from "@admin/lib/plugins/place-entries";

/**
 * @experimental The document a contribution is asked about: a collection's
 * entry or a Single, by the slug the admin serves it under.
 */
export interface ContributionDocument {
  kind: "collection" | "single";
  /** The collection's or the Single's slug, as the admin serves it. */
  slug: string;
  /** The entry as read, which a contribution's `visibleWhen` rule is judged on. */
  entry?: Record<string, unknown>;
  /**
   * The document's top-level field names, which decide where a tab that
   * edits fields of the document is drawn. Left out, the fields of the
   * document form around the caller are used where it edits this document,
   * as its edit page judges them (less any a plugin's switch keeps off the
   * type); with neither, such a tab answers no, as an edit page that names
   * no fields draws none.
   */
  fieldNames?: readonly string[];
}

/** The place's context an edit page of the document has, as a page names it. */
function contextOf(
  document: ContributionDocument
): { collection: string } | { single: string } {
  return document.kind === "collection"
    ? { collection: document.slug }
    : { single: document.slug };
}

/**
 * The document's field names from the form around the caller, where that
 * form edits the same document; otherwise none.
 */
function useFormFieldNames(
  document: ContributionDocument
): readonly string[] | undefined {
  const form = useOptionalEntryFormContext();
  if (form === null || form.fields === undefined) return undefined;
  if (form.kind !== document.kind || form.collectionSlug !== document.slug) {
    return undefined;
  }
  return form.fields.flatMap(field =>
    typeof field.name === "string" ? [field.name] : []
  );
}

/**
 * @experimental Whether the admin would draw the contribution `id` at `place`
 * for `document`, for this reader, now: `true` exactly where the place's own
 * page draws it. A contribution not delivered (its plugin is absent, the
 * reader may not see it, or it is offered on no type) answers `false`.
 *
 * Read again as the delivered contributions or the document's form change,
 * so it never disagrees with the page drawn from the same answers.
 */
export function useContributionApplies(
  place: AdminPlaceId,
  id: string,
  document: ContributionDocument
): boolean {
  const { contributions } = useBranding();
  const formFieldNames = useFormFieldNames(document);
  const lists = contributions?.[place];
  if (lists === undefined) return false;
  const view = {
    context: contextOf(document),
    ...(document.entry === undefined ? {} : { entry: document.entry }),
  };
  const fieldNames = document.fieldNames ?? formFieldNames;
  return Object.values(lists).some(
    delivered =>
      delivered !== undefined &&
      entriesDrawnHere(delivered, view).some(
        item =>
          !("builtIn" in item) &&
          item.id === id &&
          // A tab only where it fits the document, as an edit page's row of
          // tabs keeps it; every other kind wherever it can be drawn.
          (item.kind !== "tab" ||
            tabsFittingDocument([item], fieldNames).length === 1)
      )
  );
}
