"use client";

/**
 * The document's title, the editor's first and largest element, with its
 * status pill beside it and, on an entry, its address in a chip under it.
 *
 * Drawn at the top of the editor's column, under the document bar and its
 * banners, so no action ever takes the title's width. The pill is drawn here
 * while the title is on screen, and the bar takes it over once the title
 * scrolls away (`title-in-view`), so the status shows once. A Single passes no
 * slug and no status: its slug is fixed by its configuration and is not part
 * of its address on most sites, so it has no address line here.
 *
 * @module components/features/entries/EntryForm/DocumentTitleBlock
 */

import { isFieldLocalized, type FieldConfig } from "nextly/config";
import type { JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";

import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import { cn } from "@admin/lib/utils";

import { useEntryLocale } from "../EntryLocaleContext";

import { DocumentAddressChip, type DocumentSlug } from "./DocumentAddressChip";
import { DOCUMENT_COLUMN_INSET } from "./DocumentEditorLayout";
import { DocumentStatusPill } from "./DocumentStatusPill";
import type { EntryAddress } from "./entry-details-read";
import { EntryTitleInput } from "./EntryTitleInput";
import { useTitleMayCarryPill, useTitlePillRef } from "./title-in-view";
import type { EntryFormMode } from "./useEntryForm";

export type { DocumentSlug } from "./DocumentAddressChip";

/** The status the pill beside the title says, in the language being edited. */
export interface DocumentTitleStatus {
  status: string;
  hasWorkingDraft: boolean;
}

export interface DocumentTitleBlockProps {
  /** Form mode: the title takes focus when a document is being created. */
  mode: EntryFormMode;
  /** The title field's config: its name, label and required rule. */
  titleField?: FieldConfig | undefined;
  /**
   * Whether the title is fixed by configuration — a Single's — and so drawn
   * read-only without its required rule.
   */
  lockIdentity?: boolean;
  /** Whether a colleague's claim or a reader's access withholds writing. */
  documentLocked?: boolean;
  /** Whether the form is mid-submit. */
  isSubmitting?: boolean;
  /** An entry's slug; absent, with no address, draws no address line, as for a Single. */
  slug?: DocumentSlug | undefined;
  /**
   * Where the site serves the entry, as the server resolves it: null where
   * its type has no public address, undefined while that is not known.
   */
  address?: EntryAddress | null | undefined;
  /**
   * The document's status, for the pill beside the title; absent draws none
   * and leaves the pill to the bar.
   */
  status?: DocumentTitleStatus | undefined;
}

export function DocumentTitleBlock({
  mode,
  titleField,
  lockIdentity = false,
  documentLocked = false,
  isSubmitting = false,
  slug,
  address,
  status,
}: DocumentTitleBlockProps): JSX.Element | null {
  const form = useFormContext();
  const entryLocale = useEntryLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // True while the document area is showing a past version rather than the
  // live document.
  const { viewing } = useDocumentHistory();
  const isReadingHistory = viewing !== null;

  // Autofocus the title on create so the cursor is ready for typing. Not in
  // edit mode, where focusing a populated title interrupts reading.
  useEffect(() => {
    if (mode === "create") inputRef.current?.focus();
  }, [mode]);

  if (!form) return null;

  const title = titleFacts(titleField, entryLocale);

  return (
    <div className={cn("pt-6 @4xl/content:pt-8", DOCUMENT_COLUMN_INSET)}>
      {/* The title is part of the document, so reading a past version locks
        it with everything else, as a colleague's claim does. Left editable it
        would change the LIVE document while the version on screen cannot be
        edited. A size smaller on a phone, where the larger one cut short a
        title of a few ordinary words. */}
      <TitleRow status={status}>
        <EntryTitleInput
          className="text-2xl font-bold leading-8 @2xl/content:text-3xl @2xl/content:leading-9"
          name={title.name}
          control={form.control}
          label={title.label}
          required={title.required && !isReadingHistory}
          locked={lockIdentity || isReadingHistory || documentLocked}
          submitting={isSubmitting}
          rtl={title.rtl}
          inputRef={(element: HTMLInputElement | null) => {
            inputRef.current = element;
          }}
        />
      </TitleRow>
      <DocumentAddressChip
        slug={slug}
        address={address}
        published={status === undefined || status.status === "published"}
      />
    </div>
  );
}

/**
 * The title and, beside it, the status pill: drawn here only where the
 * editor hands the bar's pill over (`TitlePillProvider`), so a bar on its own
 * never loses it. The row is what the bar watches to know the title has
 * scrolled away.
 */
function TitleRow({
  status,
  children,
}: {
  status: DocumentTitleStatus | undefined;
  children: ReactNode;
}) {
  const shown = useTitleMayCarryPill() ? status : undefined;
  const rowRef = useTitlePillRef(shown !== undefined);
  return (
    <div ref={rowRef} className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      {shown ? (
        <DocumentStatusPill
          status={shown.status}
          hasWorkingDraft={shown.hasWorkingDraft}
        />
      ) : null}
    </div>
  );
}

/**
 * What the title field says about itself: its form name, its label, whether it
 * is required, and whether it is written right to left here. The title input
 * bypasses FieldWrapper, so it applies the same per-field RTL rule: right to
 * left only when the title is a translatable field AND the active language is
 * RTL (a shared title stays LTR).
 */
function titleFacts(
  titleField: FieldConfig | undefined,
  entryLocale: ReturnType<typeof useEntryLocale>
): { name: string; label: string; required: boolean; rtl: boolean } {
  const field = titleField as
    | {
        name?: string;
        label?: string;
        required?: boolean;
        type?: string;
        localized?: boolean;
      }
    | undefined;
  const name = field?.name ?? "title";
  const rtl =
    entryLocale.rtl &&
    field !== undefined &&
    isFieldLocalized(
      { type: field.type ?? "text", name, localized: field.localized },
      entryLocale.collectionLocalized
    );
  return {
    name,
    label: field?.label ?? "Title",
    required: field?.required === true,
    rtl,
  };
}
