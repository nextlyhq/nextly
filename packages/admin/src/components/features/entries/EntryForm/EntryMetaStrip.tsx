"use client";

import type { FieldConfig } from "nextly/config";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { Pencil } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

// Why: thin metadata strip below the system header. Carries the slug (with
// inline pencil-to-edit) and, when the rail is collapsed, the Draft/Published
// status pill. When the rail is expanded the status pill renders inside the
// Document panel instead, so this strip stays quiet.

export interface EntryMetaStripProps {
  /** Slug field config from the Builder schema. When present, slug renders
   *  with inline edit; when absent, the slug area is hidden. */
  slugField?: FieldConfig;
  /** Whether this collection has the Draft/Published feature enabled. */
  hasStatus: boolean;
  /** Current entry status ("draft" | "published" | other). Used for the pill. */
  status?: string | null;
  /** Whether the rail is currently collapsed. Pill only renders when true,
   *  since DocumentPanel takes over that role when the rail is expanded. */
  isRailCollapsed: boolean;
  /** When true (Singles), the slug is fixed by the single's config: render it
   *  as read-only text with no inline-edit affordance. Defaults to false so
   *  collection entry forms keep the editable slug. */
  lockSlug?: boolean;
}

export function EntryMetaStrip({
  slugField,
  hasStatus,
  status,
  isRailCollapsed,
  lockSlug = false,
}: EntryMetaStripProps) {
  const showStatusPill = hasStatus && isRailCollapsed && !!status;
  const showSlug = !!slugField;

  if (!showStatusPill && !showSlug) return null;

  return (
    <div className="px-6 py-2 border-b border-border flex items-center gap-3 text-xs text-muted-foreground">
      {showStatusPill && <StatusPill status={status} />}
      {showSlug && (
        <SlugInlineEditor slugField={slugField} readOnly={lockSlug} />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isPublished = status === "published";
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase rounded shrink-0",
        // Why: Mobeen's request — neutral admin palette, not saturated. Use
        // muted bg + foreground/muted-foreground to blend with the rest of
        // the chrome instead of standing out as candy-colour AI styling.
        isPublished
          ? "bg-muted text-foreground"
          : "bg-muted text-muted-foreground"
      )}
    >
      {isPublished ? "Published" : "Draft"}
    </span>
  );
}

function SlugInlineEditor({
  slugField,
  readOnly = false,
}: {
  slugField: FieldConfig;
  readOnly?: boolean;
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
        <span
          className="text-[10px] text-destructive-600 shrink-0"
          role="alert"
        >
          {errorMsg}
        </span>
      )}
    </div>
  );
}
