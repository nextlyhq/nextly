"use client";

/**
 * The edit page's tabs, as both editors draw them over the field column.
 *
 * With no tab contributed the column is drawn as it is. With one, a strip
 * heads the column, its first tab the page's own content (the title, the
 * languages and the fields), and a plugin's tab is shown in the column's
 * place while the document bar and the side panel stay: Save, and what the
 * panel says about the document, hold whichever tab is open.
 *
 * A plugin's tab is handed the document's form `control` and the lock a
 * side panel section is told (`DocumentTabProps`), on a saved entry, a new
 * one and a Single alike, so what it writes through the form is kept across
 * tabs and stored by the bar's Save and Publish. The open tab is kept in the
 * address (`document-tab-address`).
 *
 * The strip and a plugin's panel take the column's own top space and inset,
 * so they line up with the title the content opens with.
 *
 * @module components/entries/EntryForm/DocumentPlaceTabs
 */
import { useMemo, type ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import { PlaceTabs } from "@admin/components/shared/target-slot";
import { useT } from "@admin/lib/i18n/I18nProvider";

import type { DocumentLockGates } from "./document-lock-affordances";
import type { DocumentPlace } from "./document-place";
import { useDocumentTabAddress } from "./document-tab-address";
import { DOCUMENT_COLUMN_INSET } from "./DocumentEditorLayout";

export function DocumentPlaceTabs({
  place,
  control,
  documentLock,
  children,
}: {
  /** The edit page's place, whose tabs this draws. */
  place: DocumentPlace;
  /** The document form's control, which a plugin's tab writes through. */
  control: Control<FieldValues>;
  /** What holds the document, as a side panel section is told it. */
  documentLock: DocumentLockGates;
  /** The field column's own content. */
  children: ReactNode;
}): ReactNode {
  const t = useT();
  const { openTab, openTabChange } = useDocumentTabAddress();
  const { readOnly, actionsDisabled } = documentLock;
  // One object while nothing in it changes, so a tab is not drawn again on
  // every render of the editor around it.
  const tabProps = useMemo(
    () => ({ control, documentLock: { readOnly, actionsDisabled } }),
    [control, readOnly, actionsDisabled]
  );
  return (
    <PlaceTabs
      {...place}
      tabProps={tabProps}
      openTab={openTab}
      onOpenTabChange={openTabChange}
      contentLabel={t("nextly.places.document.content")}
      className={`pt-6 @4xl/content:pt-8 ${DOCUMENT_COLUMN_INSET}`}
    >
      {children}
    </PlaceTabs>
  );
}
