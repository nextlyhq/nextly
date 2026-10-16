/**
 * The plugin view a document's address names, mounted for the form.
 *
 * One function for the entry page and the Single page, so the two cannot come
 * to differ about which view an address draws or where leaving it goes.
 *
 * @module components/features/entries/EntryForm/document-view-mount
 */
import { navigateTo, withCurrentQuery } from "@admin/lib/navigation";
import {
  routedDocumentView,
  type DocumentKind,
} from "@admin/lib/plugins/document-view-registry";

import type { DocumentViewMount } from "./DocumentViewBody";

/**
 * The view at `view` on this document, or `undefined` on its plain edit
 * address. Read through the lookup the resolver used to let the address
 * through, so a view it found is the view drawn. Leaving it returns to
 * `editPath`, the document's own form — where the same page, and so the same
 * form, answers — in the same language: the view's own field choice is the
 * only part of the address the form does not read.
 */
export function documentViewMount(
  kind: DocumentKind,
  slug: string | undefined,
  view: string | undefined,
  editPath: string | undefined
): DocumentViewMount | undefined {
  const routed = routedDocumentView(kind, slug, view);
  if (routed === undefined || editPath === undefined) return undefined;
  return {
    component: routed.component,
    onExit: () => navigateTo(withCurrentQuery(editPath, ["field"])),
    ...("fieldType" in routed ? { fieldType: routed.fieldType } : {}),
  };
}
