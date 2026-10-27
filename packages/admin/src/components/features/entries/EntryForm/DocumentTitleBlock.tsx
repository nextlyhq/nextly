"use client";

/**
 * The document's title, the editor's first and largest element, with an
 * entry's URL slug on the line under it.
 *
 * Drawn at the top of the editor's column, under the document bar and its
 * banners, so no action ever takes the title's width. A Single passes no slug:
 * its slug is fixed by its configuration and is not part of its address on
 * most sites, so it has no line here.
 *
 * @module components/features/entries/EntryForm/DocumentTitleBlock
 */

import { isFieldLocalized, type FieldConfig } from "nextly/config";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import { Pencil } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { useEntryLocale } from "../EntryLocaleContext";

import { EntryTitleInput } from "./EntryTitleInput";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";
import type { EntryFormMode } from "./useEntryForm";

/** The slug line's field, and what decides whether it may be edited. */
export interface DocumentSlug {
  /** The slug field's config, which names the form field. */
  field: FieldConfig;
  /** Whether the slug is held read-only (a colleague's claim, a reader). */
  locked?: boolean;
  /**
   * Whether this entry's slug is already a public address, so editing it
   * retires a live URL and the line says so.
   */
  hasPublicAddress?: boolean;
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
  /** An entry's slug line; absent draws none, as for a Single. */
  slug?: DocumentSlug | undefined;
}

export function DocumentTitleBlock({
  mode,
  titleField,
  lockIdentity = false,
  documentLocked = false,
  isSubmitting = false,
  slug,
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
    <div className="pt-6 @4xl/content:px-8 @4xl/content:pt-8">
      {/* The title is part of the document, so reading a past version locks
        it with everything else, as a colleague's claim does. Left editable it
        would change the LIVE document while the version on screen cannot be
        edited. A size smaller on a phone, where the larger one cut short a
        title of a few ordinary words. */}
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
      {slug ? (
        <DocumentSlugLine
          slugField={slug.field}
          readOnly={slug.locked === true}
          warnOnChange={slug.hasPublicAddress === true}
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

/**
 * The slug, under the title: a pencil opens it for editing, Enter saves the
 * edit into the form and Esc puts it back. Read-only, it is drawn as text with
 * no pencil.
 */
function DocumentSlugLine({
  slugField,
  readOnly,
  warnOnChange,
}: {
  slugField: FieldConfig;
  readOnly: boolean;
  /** Whether this entry's slug is a live public address, so an edit here retires a URL. */
  warnOnChange: boolean;
}) {
  const form = useFormContext();
  const slugName = "name" in slugField ? (slugField.name as string) : "slug";
  const liveValue = form?.watch(slugName) as string | undefined;
  const errorMsg = (
    form?.formState.errors[slugName] as { message?: string } | undefined
  )?.message;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(liveValue ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!form) return null;

  const startEdit = () => {
    setDraft(liveValue ?? "");
    setEditing(true);
  };

  const commit = () => {
    form.setValue(slugName, draft, { shouldDirty: true, shouldValidate: true });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(liveValue ?? "");
    setEditing(false);
  };

  return (
    <div className="group mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs text-muted-foreground">
      <span className="shrink-0 font-sans">slug:</span>
      {/* A claim arriving mid-edit closes the input: read-only wins. */}
      {editing && !readOnly ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="h-6 w-64 max-w-full rounded border border-input bg-background px-1.5 font-mono text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
          aria-label="Slug"
          aria-invalid={!!errorMsg}
        />
      ) : (
        <code className="min-w-0 truncate whitespace-nowrap text-foreground/80">
          {liveValue || "(unset)"}
        </code>
      )}
      {readOnly ? null : (
        <button
          type="button"
          onClick={startEdit}
          // Shown on hover, and whenever it has keyboard focus, so a keyboard
          // user can see what they reached.
          className={cn(
            "shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-primary/5",
            "group-hover:opacity-100 focus-visible:opacity-100"
          )}
          aria-label="Edit slug"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      {errorMsg ? (
        <span
          className="shrink-0 font-sans text-xs text-destructive-600"
          role="alert"
        >
          {errorMsg}
        </span>
      ) : readOnly ? null : (
        <PublicUrlChangeNotice
          slugName={slugName}
          active={warnOnChange}
          className="shrink-0 font-sans"
        />
      )}
    </div>
  );
}
