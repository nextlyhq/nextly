"use client";

import type React from "react";

import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";

import type { EntryData, EntryFormMode } from "../useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface DocumentPanelProps {
  /** Form mode — DocumentPanel is hidden in create mode (no id/timestamps yet). */
  mode: EntryFormMode;
  /** Entry data with id and timestamps. */
  entry?: EntryData | null;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Rail panel showing system metadata: ID, Created, Updated. Hidden in create
 * mode since none of these exist before the document is saved.
 *
 * PR 6 of the redesign threads the slug field into this panel (above ID) with
 * an inline edit affordance. This PR keeps slug in its existing header card.
 */
export function DocumentPanel({
  mode,
  entry,
}: DocumentPanelProps): React.ReactElement | null {
  const { formatDate } = useAdminDateFormatter();

  if (mode === "create") return null;

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
    <div className="px-5 py-4 border-b border-primary/5">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-2">
        Document
      </p>
      <dl className="space-y-2.5">
        <Row label="ID" value={entry?.id ?? "—"} mono />
        <Row label="Created" value={formatRowDate(createdAt)} />
        <Row label="Updated" value={formatRowDate(updatedAt)} />
      </dl>
    </div>
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
