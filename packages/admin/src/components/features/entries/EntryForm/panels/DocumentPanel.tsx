"use client";

import type React from "react";

import { Clock, Hash } from "@admin/components/icons";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";

import { DocumentLanguagePanel } from "../../LanguagePanel";
import { DocumentIdCopy } from "../DocumentIdCopy";
import type { EntryData, EntryFormMode } from "../useEntryForm";

// "heavy" polish pass on top of that — neutral monochrome lucide icons
// in front of each row label, a thin separator above the timestamps,
// the entry ID rendered as a `first5…last3` shortcode with a persistent
// copy button (not hover-gated). The document's status is not repeated
// here: the document bar's pill says it, read from the language being edited.

export interface DocumentPanelProps {
  /** Form mode. The ID and timestamps only render in edit mode. */
  mode: EntryFormMode;
  /** Entry data with id, status, and timestamps. */
  entry?: EntryData | null;
  /** Whether the collection has the Draft/Published feature enabled, which
   *  the language panel reads to say each language's publish state. */
  hasStatus: boolean;
  /** The active editing locale, forwarded to the language panel. */
  locale?: string;
  /** Switch the editor to a language, forwarded to the language panel. */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /** Withholds the panel's mutating actions (reading a past version). */
  actionsDisabled?: boolean;
  /** Withholds opening another language; the same as `actionsDisabled` unless given. */
  navigationDisabled?: boolean;
  /** Withholds publishing every language; the same as `actionsDisabled` unless given. */
  publishAllDisabled?: boolean;
}

/**
 * Derive the displayed pill state from the persisted status, the form dirty
 * flag, and whether a working draft is pending.
 *
 * - "Changed" — a published entry with a persisted working draft waiting to be
 *   promoted (Payload's model). This is the authoritative divergence from live,
 *   so it wins over "Modified": the enabled Save button already signals any
 *   extra unsaved local edits.
 * - "Modified" — a published entry with local edits not yet saved. Drafts never
 *   show Modified (they are inherently work-in-progress).
 */
export type PillState = "draft" | "modified" | "changed" | "published";

/**
 * What each state is CALLED, in one place.
 *
 * Exported because the page builder covers this panel and has to report the
 * same document in the same words. Two maps of four strings agree on the day
 * they are written and drift the first time one of them is reworded, and the
 * result is one editor calling a document "Changed" while another calls it
 * "Modified" — a distinction `pillStateFromForm` is careful to make.
 */
export const PILL_LABEL: Record<PillState, string> = {
  draft: "Draft",
  modified: "Modified",
  changed: "Changed",
  published: "Published",
};
export function pillStateFromForm(
  status: string | undefined,
  isDirty: boolean,
  hasWorkingDraft = false
): PillState {
  if (status === "published" && hasWorkingDraft) return "changed";
  if (status === "published" && isDirty) return "modified";
  return status === "published" ? "published" : "draft";
}

export function DocumentPanel({
  mode,
  entry,
  hasStatus,
  locale,
  onLocaleChange,
  actionsDisabled = false,
  navigationDisabled = actionsDisabled,
  publishAllDisabled = actionsDisabled,
}: DocumentPanelProps): React.ReactElement | null {
  const isCreate = mode === "create";

  // Hide entirely on create — nothing to show until the entry exists.
  if (isCreate) return null;

  // Per-language translation-status pills. Present only when the entry was
  // fetched with `?translation-status=1` on a localized collection; inert otherwise.
  const translations = entry?._translations as
    | Record<string, { translated: boolean; status?: string }>
    | undefined;

  return (
    <div className="px-5 py-4 border-b border-border">
      <p className="text-xs font-bold tracking-[0.1em] uppercase text-muted-foreground mb-3">
        Document
      </p>
      <dl className="space-y-3">
        {/* No status row: the document bar's pill says where the document
            stands, read from the language being edited, and a second pill
            here read the main row and could disagree with it. */}
        <IdRow id={entry?.id} />
        <Separator />
        <TimestampRows entry={entry} />
      </dl>
      <TranslationsRow
        translations={translations}
        hasStatus={hasStatus}
        {...(locale === undefined ? {} : { locale })}
        {...(onLocaleChange === undefined ? {} : { onLocaleChange })}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
        publishAllDisabled={publishAllDisabled}
      />
    </div>
  );
}

/**
 * Per-language translation-status pills row. Renders nothing when localization is off
 * or the entry has no `_translations` map, so non-localized documents are unchanged.
 */
function TranslationsRow({
  translations,
  hasStatus,
  locale,
  onLocaleChange,
  actionsDisabled = false,
  navigationDisabled = actionsDisabled,
  publishAllDisabled = actionsDisabled,
}: {
  translations?: Record<string, { translated: boolean; status?: string }>;
  hasStatus?: boolean;
  locale?: string;
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  actionsDisabled?: boolean;
  navigationDisabled?: boolean;
  publishAllDisabled?: boolean;
}) {
  // The panel self-hides when localization is off, so an absent map is not a
  // reason to withhold it: a localized entry fetched without
  // `?translation-status=1` still has languages to switch between and act on.
  return (
    <div className="mt-4 pt-4 border-t border-border">
      {/* The language panel, which replaced the two loose action buttons that
          used to sit here. They offered the actions without the state they act
          on, so an author had to read one panel to decide and another to act.
          The panel carries both, and the same component renders inline where
          this rail is hidden — so neither the state nor the actions can be the
          surface that disappears. */}
      <DocumentLanguagePanel
        translations={translations}
        locale={locale}
        onLocaleChange={onLocaleChange}
        hasStatus={hasStatus}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
        publishAllDisabled={publishAllDisabled}
      />
    </div>
  );
}

function Separator() {
  return <div className="border-t border-border -mx-5" aria-hidden="true" />;
}

function RowIcon({ icon: Icon }: { icon: typeof Hash }) {
  return (
    <Icon
      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
      aria-hidden="true"
    />
  );
}

function IdRow({ id }: { id?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <RowIcon icon={Hash} />
        <span>ID</span>
      </dt>
      <dd className="flex items-center gap-1 min-w-0">
        <DocumentIdCopy id={id} />
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
