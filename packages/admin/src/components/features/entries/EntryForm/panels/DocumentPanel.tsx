"use client";

import type React from "react";
import { useState } from "react";

import { Check, Copy } from "@admin/components/icons";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { cn } from "@admin/lib/utils";

import type { EntryData, EntryFormMode } from "../useEntryForm";

// Why: Task 5 PR 4 simplifies the rail to a single panel. DocumentPanel now
// shows Status (when the collection has hasStatus enabled and the entry has
// been saved), the entry ID with a one-click copy button, and Created /
// Updated timestamps. Slug moves to EntryMetaStrip below the system header.

export interface DocumentPanelProps {
  /** Form mode. ID/timestamps/status only render in edit mode. */
  mode: EntryFormMode;
  /** Entry data with id, status, and timestamps. */
  entry?: EntryData | null;
  /** Whether the collection has the Draft/Published feature enabled. */
  hasStatus: boolean;
}

export function DocumentPanel({
  mode,
  entry,
  hasStatus,
}: DocumentPanelProps): React.ReactElement | null {
  const isCreate = mode === "create";

  // Hide entirely on create — there's nothing to show until the entry exists.
  if (isCreate) return null;

  return (
    <div className="px-5 py-4 border-b border-primary/5">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-2">
        Document
      </p>
      <dl className="space-y-2.5">
        {hasStatus && (
          <StatusRow
            status={(entry?.status as string | undefined) ?? "draft"}
          />
        )}
        <IdRow id={entry?.id} />
        <TimestampRows entry={entry} />
      </dl>
    </div>
  );
}

function StatusRow({ status }: { status: string }) {
  const isPublished = status === "published";
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted-foreground shrink-0">Status</dt>
      <dd>
        <span
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase rounded",
            // Why: neutral admin palette per Mobeen's "no AI-ish color scheme"
            // — muted bg + foreground/muted-foreground.
            isPublished
              ? "bg-muted text-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {isPublished ? "Published" : "Draft"}
        </span>
      </dd>
    </div>
  );
}

function IdRow({ id }: { id?: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!id) return;
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 group">
      <dt className="text-xs text-muted-foreground shrink-0">ID</dt>
      <dd className="flex items-center gap-1 min-w-0">
        <span
          className="text-xs font-mono text-foreground truncate"
          title={id ?? ""}
        >
          {id ?? "—"}
        </span>
        {id && (
          <button
            type="button"
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 hover:bg-primary/5 rounded p-0.5 transition-opacity"
            aria-label={copied ? "ID copied" : "Copy ID to clipboard"}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-600" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}

function TimestampRows({ entry }: { entry?: EntryData | null }) {
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
      <Row label="Created" value={formatRowDate(createdAt)} />
      <Row label="Updated" value={formatRowDate(updatedAt)} />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-xs text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}
