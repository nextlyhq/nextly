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
 * The column's own content is hidden while a plugin's tab is open, and a
 * hidden field stops listening to the form, so what the tab wrote would show
 * stale when the content came back, though Save would store it. What changes
 * while a plugin's tab is open is therefore set again, to the value it has,
 * as the content is shown (`useContentFieldsCatchUp`).
 *
 * The strip and a plugin's panel take the column's own top space and inset,
 * so they line up with the title the content opens with.
 *
 * @module components/entries/EntryForm/DocumentPlaceTabs
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import {
  PlaceTabs,
  type PlaceTabProps,
} from "@admin/components/shared/target-slot";
import { useT } from "@admin/lib/i18n/I18nProvider";
import type { DocumentTabProps } from "@admin/lib/plugins/component-registry";

import type { DocumentLockGates } from "./document-lock-affordances";
import type { DocumentPlace } from "./document-place";
import { useDocumentTabAddress } from "./document-tab-address";
import { DOCUMENT_COLUMN_INSET } from "./DocumentEditorLayout";

/** The parts of the document's form the tabs use. */
export type DocumentTabsForm = Pick<
  UseFormReturn<FieldValues>,
  "control" | "subscribe" | "getValues" | "setValue"
>;

/**
 * Brings the content's hidden fields up to date as it is shown again.
 *
 * Driven by the tab the strip actually shows (`onShownTabChange`), not the
 * one the address names: a tab that stops being delivered while open gives
 * the content back with the address unchanged. Only while a plugin's tab is
 * shown is a change recorded: by its field's name, or as the whole form when
 * the form is replaced (a save's answer, read back in, names no field). As
 * the content comes back, each recorded value is set to itself, which tells
 * the fields listening for it and changes nothing else: no field is marked
 * changed, touched or checked. The strip reports after the content's own
 * effects, which have subscribed again by then.
 */
function useContentFieldsCatchUp(
  form: DocumentTabsForm
): (shownTab: string | null) => void {
  const { subscribe, getValues, setValue } = form;
  const pluginTabShown = useRef(false);
  const changed = useRef<Set<string> | "all">(new Set());

  useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ name }) => {
          if (!pluginTabShown.current || changed.current === "all") return;
          if (name === undefined) changed.current = "all";
          else changed.current.add(name);
        },
      }),
    [subscribe]
  );

  return useCallback(
    (shownTab: string | null) => {
      const contentBack = shownTab === null && pluginTabShown.current;
      pluginTabShown.current = shownTab !== null;
      if (!contentBack) return;
      const names =
        changed.current === "all"
          ? Object.keys(getValues())
          : Array.from(changed.current);
      changed.current = new Set();
      for (const name of names) setValue(name, getValues(name));
    },
    [getValues, setValue]
  );
}

export function DocumentPlaceTabs({
  place,
  form,
  documentLock,
  children,
}: {
  /** The edit page's place, whose tabs this draws. */
  place: DocumentPlace;
  /** The document's form, whose `control` a plugin's tab writes through. */
  form: DocumentTabsForm;
  /** What holds the document, as a side panel section is told it. */
  documentLock: DocumentLockGates;
  /** The field column's own content. */
  children: ReactNode;
}): ReactNode {
  const t = useT();
  const { openTab, openTabChange } = useDocumentTabAddress();
  const { control } = form;
  const { readOnly, actionsDisabled } = documentLock;
  const shownTabChange = useContentFieldsCatchUp(form);
  // One object while nothing in it changes, so a tab is not drawn again on
  // every render of the editor around it. Checked against what a document's
  // tab is promised, besides what every place's tab is handed.
  const tabProps = useMemo(
    () =>
      ({
        control,
        documentLock: { readOnly, actionsDisabled },
      }) satisfies Omit<DocumentTabProps, keyof PlaceTabProps>,
    [control, readOnly, actionsDisabled]
  );
  return (
    <PlaceTabs
      {...place}
      tabProps={tabProps}
      openTab={openTab}
      onOpenTabChange={openTabChange}
      onShownTabChange={shownTabChange}
      contentLabel={t("nextly.places.document.content")}
      className={`pt-6 @4xl/content:pt-8 ${DOCUMENT_COLUMN_INSET}`}
    >
      {children}
    </PlaceTabs>
  );
}
