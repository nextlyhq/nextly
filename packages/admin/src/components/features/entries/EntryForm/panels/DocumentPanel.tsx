"use client";

import type React from "react";
import { useState } from "react";

import { Check, Circle, Clock, Copy, Hash } from "@admin/components/icons";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { cn } from "@admin/lib/utils";

import { CopyFromLanguageMenu } from "../../CopyFromLanguageMenu";
import { useEntryLocale } from "../../EntryLocaleContext";
import { LanguageStatusPills } from "../../LanguageStatusPills";
import { PublishAllLanguagesButton } from "../../PublishAllLanguagesButton";
import type { EntryData, EntryFormMode } from "../useEntryForm";

// "heavy" polish pass on top of that — neutral monochrome lucide icons
// in front of each row label, a thin separator above the timestamps,
// the entry ID rendered as a `first5…last3` shortcode with a persistent
// copy button (not hover-gated), and a slightly more prominent Status
// pill so the lifecycle state stands out from the surrounding metadata.

export interface DocumentPanelProps {
  /** Form mode. ID/timestamps/status only render in edit mode. */
  mode: EntryFormMode;
  /** Entry data with id, status, and timestamps. */
  entry?: EntryData | null;
  /** Whether the collection has the Draft/Published feature enabled. */
  hasStatus: boolean;
  /** Whether the form has unsaved local changes. When the entry is
   *  published and the form is dirty, the status pill renders as
   *  "Modified" (Strapi pattern) so the user sees both "what's live"
   *  and "what you've changed" in one place.
   *
   *  Default false. Optional so existing call sites that pass only the
   *  three required props keep working — they just won't see the
   *  Modified state. */
  isDirty?: boolean;
}

/**
 * Derive the displayed pill state from the persisted status + form dirty.
 * "Modified" only applies to published entries with local changes; drafts
 * stay drafts regardless of dirty (drafts are inherently work-in-progress).
 */
export type PillState = "draft" | "modified" | "published";
export function pillStateFromForm(
  status: string | undefined,
  isDirty: boolean
): PillState {
  if (status === "published" && isDirty) return "modified";
  return status === "published" ? "published" : "draft";
}

/**
 * Format an entry ID as `first5…last3` so the rail row stays a single line
 * even for long UUIDs. Returns the original string when it is short enough
 * that truncating would hide more than it reveals.
 *
 * @example
 * formatId("548e813c-8266-40c3-bd9c-ca1816f8")  // "548e8…6f8"
 * formatId("abc12345")                          // "abc12345"
 * formatId(undefined)                           // "—"
 */
export function formatId(id: string | null | undefined): string {
  if (!id) return "—";
  // Why: 9 chars or fewer fits in a single line at the rail width without
  // ellipsis, and `first5…last3` would be longer than the original at 8.
  if (id.length <= 9) return id;
  return `${id.slice(0, 5)}…${id.slice(-3)}`;
}

export function DocumentPanel({
  mode,
  entry,
  hasStatus,
  isDirty = false,
}: DocumentPanelProps): React.ReactElement | null {
  const isCreate = mode === "create";

  // Hide entirely on create — nothing to show until the entry exists.
  if (isCreate) return null;

  const pill = pillStateFromForm(entry?.status as string | undefined, isDirty);

  // i18n M7: per-language translation-status pills (spec §10). Present only when the entry was
  // fetched with `?translation-status=1` on a localized collection; inert otherwise.
  const translations = entry?._translations as
    | Record<string, { translated: boolean; status?: string }>
    | undefined;

  return (
    <div className="px-5 py-4 border-b border-primary/5">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-3">
        Document
      </p>
      <dl className="space-y-3">
        {hasStatus && <StatusRow state={pill} />}
        <IdRow id={entry?.id} />
        <Separator />
        <TimestampRows entry={entry} />
      </dl>
      <TranslationsRow translations={translations} hasStatus={hasStatus} />
    </div>
  );
}

/**
 * Per-language translation-status pills row (i18n M7). Renders nothing when localization is off
 * or the entry has no `_translations` map, so non-localized documents are unchanged.
 */
function TranslationsRow({
  translations,
  hasStatus,
}: {
  translations?: Record<string, { translated: boolean; status?: string }>;
  hasStatus?: boolean;
}) {
  const { locale, onLocaleChange } = useEntryLocale();
  if (!translations) return null;
  return (
    <div className="mt-4 pt-4 border-t border-primary/5">
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-2">
        Languages
      </p>
      <LanguageStatusPills
        translations={translations}
        activeLocale={locale}
        onSelect={onLocaleChange}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyFromLanguageMenu />
        <PublishAllLanguagesButton hasStatus={hasStatus} />
      </div>
    </div>
  );
}

function Separator() {
  return <div className="border-t border-primary/5 -mx-5" aria-hidden="true" />;
}

function RowIcon({ icon: Icon }: { icon: typeof Hash }) {
  return (
    <Icon
      className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0"
      aria-hidden="true"
    />
  );
}

function StatusRow({ state }: { state: PillState }) {
  // Why: heavier pill than the meta-strip variant — matched padding and
  // font weight so the lifecycle state reads as the most important row.
  // The Modified state uses amber-50/foreground (light) and amber-200
  // text on a transparent bg (dark) — distinct from Draft (neutral) and
  // Published (foreground/background). Avoids saturated AI-style hues.
  const PILL_CLASS: Record<PillState, string> = {
    draft: "bg-muted text-muted-foreground border border-primary/10",
    modified:
      "bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
    published: "bg-foreground text-background",
  };
  const PILL_LABEL: Record<PillState, string> = {
    draft: "Draft",
    modified: "Modified",
    published: "Published",
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <RowIcon icon={Circle} />
        <span>Status</span>
      </dt>
      <dd>
        <span
          data-pill-state={state}
          className={cn(
            "px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] uppercase rounded",
            PILL_CLASS[state]
          )}
        >
          {PILL_LABEL[state]}
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
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <RowIcon icon={Hash} />
        <span>ID</span>
      </dt>
      <dd className="flex items-center gap-1 min-w-0">
        <span className="text-xs font-mono text-foreground" title={id ?? ""}>
          {formatId(id)}
        </span>
        {id && (
          <button
            type="button"
            onClick={handleCopy}
            className="hover:bg-primary/5 rounded p-0.5 transition-colors"
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
      <TimestampRow label="Created" value={formatRowDate(createdAt)} />
      <TimestampRow label="Updated" value={formatRowDate(updatedAt)} />
    </>
  );
}

function TimestampRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <RowIcon icon={Clock} />
        <span>{label}</span>
      </dt>
      <dd className="text-xs text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}
