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
 * The strip and a plugin's panel take the column's own top space and inset,
 * so they line up with the title the content opens with.
 *
 * @module components/entries/EntryForm/DocumentPlaceTabs
 */
import type { ReactNode } from "react";

import { PlaceTabs } from "@admin/components/shared/target-slot";
import { useT } from "@admin/lib/i18n/I18nProvider";

import type { DocumentPlace } from "./document-place";
import { DOCUMENT_COLUMN_INSET } from "./DocumentEditorLayout";

export function DocumentPlaceTabs({
  place,
  children,
}: {
  /** The edit page's place, whose tabs this draws. */
  place: DocumentPlace;
  /** The field column's own content. */
  children: ReactNode;
}): ReactNode {
  const t = useT();
  return (
    <PlaceTabs
      {...place}
      contentLabel={t("nextly.places.document.content")}
      className={`pt-6 @4xl/content:pt-8 ${DOCUMENT_COLUMN_INSET}`}
    >
      {children}
    </PlaceTabs>
  );
}
