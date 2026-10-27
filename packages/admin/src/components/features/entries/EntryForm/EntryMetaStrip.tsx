"use client";

import type { FieldConfig } from "nextly/config";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { Pencil } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { DocumentIdCopy } from "./DocumentIdCopy";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";

// Why: thin metadata strip below the system header. Carries the slug (with
// inline pencil-to-edit) and, wherever the rail is not on screen, the
// Draft/Published status pill and the document's id. Where the rail is
// expanded both render inside the Document panel instead, so this strip stays
// quiet.

export interface EntryMetaStripProps {
  /** Slug field config from the Builder schema. When present, slug renders
   *  with inline edit; when absent, the slug area is hidden. */
  slugField?: FieldConfig;
  /** Whether this collection has the Draft/Published feature enabled. */
  hasStatus: boolean;
  /** Current entry status ("draft" | "published" | other). Used for the pill. */
  status?: string | null;
  /** Whether a pending working draft exists over a published entry
   *  (draft/published split). When true the pill reads "Changed" instead of
   *  "Published", mirroring the Document panel. Defaults to false. */
  hasWorkingDraft?: boolean;
  /** Whether the rail is currently collapsed. Pill only renders when true,
   *  since DocumentPanel takes over that role when the rail is expanded. */
  isRailCollapsed: boolean;
  /** When true (Singles), the slug is fixed by the single's config: render it
   *  as read-only text with no inline-edit affordance. Defaults to false so
   *  collection entry forms keep the editable slug. */
  lockSlug?: boolean;
  /** Whether this entry's slug is already a public address, so editing it retires a live URL.
   *  Resolved by the form via `useHasPublicAddress`, which knows about per-locale publishing and
   *  collections that have no draft lifecycle at all. */
  hasPublicAddress?: boolean;
  /** The document's id, offered to copy wherever the Document panel is not
   *  on screen. Absent before the document exists. */
  documentId?: string | null | undefined;
}

export function EntryMetaStrip({
  slugField,
  hasStatus,
  status,
  hasWorkingDraft = false,
  isRailCollapsed,
  lockSlug = false,
  hasPublicAddress = false,
  documentId,
}: EntryMetaStripProps): JSX.Element | null {
  const showStatusPill = hasStatus && !!status;
  const showSlug = !!slugField;
  const showId = !!documentId;

  if (!showStatusPill && !showSlug && !showId) return null;

  /*
   * The status and the id say themselves in the document panel where that
   * panel is on screen and open, so they step aside there and only there: at
   * the width the panel appears from (`@4xl/content`), while it is expanded.
   * Below that width the panel is not drawn at all, so this strip is the only
   * place they are said, whatever the panel's setting.
   */
  const besidePanel = isRailCollapsed ? undefined : "@4xl/content:hidden";

  return (
    <div
      className={cn(
        "px-6 py-2 border-b border-border flex items-center gap-3 text-xs text-muted-foreground",
        // With nothing else in it, the strip steps aside with the pill and
        // the id rather than standing empty.
        !showSlug && besidePanel
      )}
    >
      {showStatusPill && (
        <StatusPill
          status={status}
          hasWorkingDraft={hasWorkingDraft}
          className={besidePanel}
        />
      )}
      {showId && (
        <div className={cn("flex items-center gap-1 shrink-0", besidePanel)}>
          <span className="text-muted-foreground">ID:</span>
          <DocumentIdCopy id={documentId} />
        </div>
      )}
      {showSlug && (
        <SlugInlineEditor
          slugField={slugField}
          readOnly={lockSlug}
          warnOnChange={hasPublicAddress}
        />
      )}
    </div>
  );
}

function StatusPill({
  status,
  hasWorkingDraft,
  className,
}: {
  status: string;
  hasWorkingDraft: boolean;
  className?: string | undefined;
}) {
  const isPublished = status === "published";
  // A published entry with a pending working draft is Payload's "Changed"
  // state — the live row stays published while newer edits wait to be promoted.
  const isChanged = isPublished && hasWorkingDraft;
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 text-xs font-bold tracking-[0.1em] uppercase rounded shrink-0",
        // Why: Mobeen's request — neutral admin palette, not saturated. Use
        // muted bg + foreground/muted-foreground to blend with the rest of
        // the chrome instead of standing out as candy-colour AI styling. The
        // Changed state reuses the muted amber `warning` token (both modes) to
        // match the Document panel's pending-changes pill.
        isChanged
          ? "bg-warning-100 text-warning-800 dark:bg-warning-950/40 dark:text-warning-200"
          : isPublished
            ? "bg-muted text-foreground"
            : "bg-muted text-muted-foreground",
        className
      )}
    >
      {isChanged ? "Changed" : isPublished ? "Published" : "Draft"}
    </span>
  );
}

function SlugInlineEditor({
  slugField,
  readOnly = false,
  warnOnChange = false,
}: {
  slugField: FieldConfig;
  readOnly?: boolean;
  /** Whether this entry's slug is a live public address, so an edit here retires a URL. */
  warnOnChange?: boolean;
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

  // Singles: slug is fixed by the single's config. Render it as plain
  // read-only text with no pencil-to-edit affordance.
  if (readOnly) {
    return (
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="text-muted-foreground shrink-0">slug:</span>
        <code className="text-foreground/80 font-mono text-xs whitespace-nowrap truncate">
          {liveValue || "(unset)"}
        </code>
      </div>
    );
  }

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
    <div className="flex items-center gap-1.5 group min-w-0 flex-1">
      <span className="text-muted-foreground shrink-0">slug:</span>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {editing ? (
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
            className="text-xs font-mono text-foreground bg-background border border-input rounded px-1.5 py-0 w-full focus:border-primary focus:outline-none transition-colors"
            aria-label="Slug"
            aria-invalid={!!errorMsg}
          />
        ) : (
          <code className="text-foreground/80 font-mono text-xs whitespace-nowrap truncate">
            {liveValue || "(unset)"}
          </code>
        )}
        <button
          type="button"
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 hover:bg-primary/5 rounded p-0.5 transition-opacity shrink-0"
          aria-label="Edit slug"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {errorMsg && (
        <span className="text-xs text-destructive-600 shrink-0" role="alert">
          {errorMsg}
        </span>
      )}
      {!errorMsg && (
        <PublicUrlChangeNotice
          slugName={slugName}
          active={warnOnChange}
          className="shrink-0"
        />
      )}
    </div>
  );
}
