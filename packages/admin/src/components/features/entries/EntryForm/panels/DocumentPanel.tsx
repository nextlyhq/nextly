"use client";

import type { FieldConfig } from "@revnixhq/nextly/config";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { Pencil } from "@admin/components/icons";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";

import type { EntryData, EntryFormMode } from "../useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface DocumentPanelProps {
  /** Form mode. Slug is editable in both create and edit; ID/timestamps
   *  are only shown in edit mode (they don't exist before save). */
  mode: EntryFormMode;
  /** Entry data with id and timestamps. */
  entry?: EntryData | null;
  /** Slug field config — when present, slug renders as the first row with
   *  inline editing. Q-D5=iv in the redesign spec. */
  slugField?: FieldConfig;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Rail panel for system metadata: Slug, ID, Created, Updated. Slug is
 * inline-editable via the pencil icon (PR 6 of the redesign). ID and
 * timestamps are read-only and only render in edit mode.
 */
export function DocumentPanel({
  mode,
  entry,
  slugField,
}: DocumentPanelProps): React.ReactElement | null {
  const isCreate = mode === "create";

  // Hide entirely if there's nothing to show: no slug field, and no entry yet.
  if (!slugField && isCreate) return null;

  return (
    <div className="px-5 py-4 border-b border-primary/5">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-2">
        Document
      </p>
      <dl className="space-y-2.5">
        {slugField && <SlugRow slugField={slugField} />}
        {!isCreate && <DocumentMetaRows entry={entry} />}
      </dl>
    </div>
  );
}

// ============================================================================
// Slug row (inline-editable)
// ============================================================================

function SlugRow({ slugField }: { slugField: FieldConfig }) {
  const form = useFormContext();
  const slugName = "name" in slugField ? (slugField.name as string) : "slug";
  const liveValue = form.watch(slugName) as string | undefined;
  const errorMsg = (
    form.formState.errors[slugName] as { message?: string } | undefined
  )?.message;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(liveValue ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input the moment we enter edit mode.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-xs text-muted-foreground shrink-0">Slug</dt>
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
            className="text-xs font-mono text-foreground bg-background border border-primary/20 rounded px-1.5 py-0.5 min-w-0 w-full"
            aria-label="Slug"
            aria-invalid={!!errorMsg}
          />
        </div>
        {errorMsg && (
          <p className="text-[10px] text-red-600 ml-auto" role="alert">
            {errorMsg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 group">
      <dt className="text-xs text-muted-foreground shrink-0">Slug</dt>
      <dd className="flex items-center gap-1 min-w-0">
        <span
          className="text-xs font-mono text-foreground truncate"
          title={liveValue || ""}
        >
          {liveValue || "—"}
        </span>
        <button
          type="button"
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 hover:bg-primary/5 rounded p-0.5 transition-opacity"
          aria-label="Edit slug"
        >
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </button>
      </dd>
    </div>
  );
}

// ============================================================================
// ID / Created / Updated rows (edit mode only)
// ============================================================================

function DocumentMetaRows({ entry }: { entry?: EntryData | null }) {
  const { formatDate } = useAdminDateFormatter();

  const createdAt =
    entry?.createdAt ?? (entry?.created_at as string | undefined) ?? undefined;
  const updatedAt =
    entry?.updatedAt ?? (entry?.updated_at as string | undefined) ?? undefined;

  const formatRowDate = (dateString: string | undefined) => {
    if (!dateString) return "—";
    return formatDate(
      dateString,
      { dateStyle: "medium", timeStyle: "short" },
      dateString
    );
  };

  return (
    <>
      <Row label="ID" value={entry?.id ?? "—"} mono />
      <Row label="Created" value={formatRowDate(createdAt)} />
      <Row label="Updated" value={formatRowDate(updatedAt)} />
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd
        className={
          mono
            ? "text-xs font-mono text-foreground truncate"
            : "text-xs text-foreground"
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
