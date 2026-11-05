"use client";

import type { JSX } from "react";

import type { ReleaseDocumentRef } from "@admin/types/releases";

import { DocumentPanel } from "./panels";
import type { PanelDocumentStatus } from "./panels/StatusSection";
import type { EntryFormMode, EntryData } from "./useEntryForm";

// What the document panel says, for both editors: its sections in order. The
// frame it is drawn in, docked, floating or a sheet, is `DocumentSidePanel`'s.

export interface EntryFormSidebarProps {
  /** Form mode — nothing is drawn in create mode, before the document exists. */
  mode: EntryFormMode;
  /** Entry data — the Details section reads id and timestamps. */
  entry?: EntryData | null;
  /** Whether sidebar should be hidden (embedded mode or rail collapsed). */
  hidden?: boolean;
  /** Whether this collection has Draft/Published status enabled, which the
   *  Status and Publishing sections and the language section read. */
  hasStatus?: boolean;
  /** The status in the language being edited, as the bar's pill reads it. */
  documentStatus?: PanelDocumentStatus;
  /** The document as releases address it, for the Publishing section. */
  releaseDocument?: ReleaseDocumentRef;
  /** The active editing locale, forwarded to the language panel. */
  locale?: string;
  /** Switch the editor to a language, forwarded to the language panel. */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /** Withholds the language panel's mutating actions (reading a past version). */
  actionsDisabled?: boolean;
  /** Withholds opening another language; the same as `actionsDisabled` unless given. */
  navigationDisabled?: boolean;
  /** Withholds publishing every language; the same as `actionsDisabled` unless given. */
  publishAllDisabled?: boolean;
}

export function EntryFormSidebar({
  mode,
  entry,
  hidden = false,
  hasStatus = false,
  documentStatus,
  releaseDocument,
  locale,
  onLocaleChange,
  actionsDisabled = false,
  navigationDisabled = actionsDisabled,
  publishAllDisabled = actionsDisabled,
}: EntryFormSidebarProps): JSX.Element | null {
  if (hidden) return null;

  return (
    <div className="flex flex-col bg-background">
      <DocumentPanel
        mode={mode}
        entry={entry}
        hasStatus={hasStatus}
        {...(documentStatus === undefined ? {} : { documentStatus })}
        {...(releaseDocument === undefined ? {} : { releaseDocument })}
        {...(locale === undefined ? {} : { locale })}
        {...(onLocaleChange === undefined ? {} : { onLocaleChange })}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
        publishAllDisabled={publishAllDisabled}
      />
    </div>
  );
}
