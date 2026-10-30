"use client";

/**
 * The panel's Status section: where the document stands, said as a sentence.
 *
 * Read from the status the document bar's pill reads, for the language being
 * edited, and through the same helper (`savedPillState`), so the sentence and
 * the pill cannot disagree. On a localized document it names the language, so
 * a translation that lags its default language is not described as if it were
 * the whole document.
 *
 * @module components/features/entries/EntryForm/panels/StatusSection
 */

import type { JSX } from "react";

import { useLocalization } from "@admin/hooks/useLocalization";

import { useEntryLocale } from "../../EntryLocaleContext";

import { PanelSection } from "./PanelSection";
import { savedPillState, type SavedPillState } from "./pill-state";

export interface PanelDocumentStatus {
  /** The status in the language being edited ("draft", "published", ...). */
  status: string;
  /** Whether a published document has a working draft pending. */
  hasWorkingDraft: boolean;
}

/** What each of the pill's states means, after the subject that has it. */
const STANDING: Record<SavedPillState, string> = {
  draft: "is a draft, not published yet.",
  published: "is published and up to date.",
  changed: "is published. Changes saved since then are not live yet.",
};

export function StatusSection({
  documentStatus,
}: {
  documentStatus: PanelDocumentStatus;
}): JSX.Element {
  // The pill's own answer, from the one helper both draw.
  const state = savedPillState(
    documentStatus.status,
    documentStatus.hasWorkingDraft
  );
  const standing = STANDING[state];
  return (
    <PanelSection title="Status">
      <p
        className="text-sm leading-relaxed text-foreground"
        data-status={state}
      >
        <StatusSubject /> {standing}
      </p>
    </PanelSection>
  );
}

/**
 * Which document the sentence is about: the language being edited on a
 * localized document, this document otherwise.
 */
function StatusSubject() {
  const { enabled, defaultLocale, getLocale } = useLocalization();
  const entryLocale = useEntryLocale();
  if (!enabled || !entryLocale.collectionLocalized) {
    return <>This document</>;
  }
  const code = entryLocale.locale ?? defaultLocale;
  const label = getLocale(code)?.label ?? code;
  return (
    <>
      The <span className="font-medium">{label}</span> version
    </>
  );
}
