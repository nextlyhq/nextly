"use client";

/**
 * The panel's Details, in this order: the document's ID (shortened, copied
 * whole), the API address "View API response" reads (copied whole), and when
 * it was made and last changed, each with who did it where that is known.
 *
 * Who is named as the server answers it: a person by the name their account
 * gives now, never by email, "a former user" once the account is gone, and
 * anything else by its kind. Where nobody is recorded, the date stands alone.
 *
 * @module components/features/entries/EntryForm/panels/DetailsSection
 */

import type React from "react";

import { Check, Clock, Copy, Hash, Link } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { useCopyToClipboard } from "@admin/hooks/useCopyToClipboard";

import { DocumentIdCopy, formatId } from "../DocumentIdCopy";
import { changerWords, type EntryChanger } from "../entry-details-read";
import type { EntryData } from "../useEntryForm";

import { PanelSection } from "./PanelSection";

export interface DetailsSectionProps {
  entry?: EntryData | null;
  /** The address "View API response" reads; absent draws no API line. */
  apiAddress?: string | undefined;
  /** Who made the document, where it is known. */
  createdBy?: EntryChanger | null | undefined;
  /** Who changed it last, where it is known. */
  updatedBy?: EntryChanger | null | undefined;
  /**
   * When that last recorded change was made, so who and when are one
   * change's; absent, the entry's own update time.
   */
  changedAt?: string | null | undefined;
}

export function DetailsSection({
  entry,
  apiAddress,
  createdBy,
  updatedBy,
  changedAt,
}: DetailsSectionProps): React.ReactElement {
  const createdAt =
    entry?.createdAt ?? (entry?.created_at as string | undefined) ?? undefined;
  const updatedAt =
    changedAt ??
    entry?.updatedAt ??
    (entry?.updated_at as string | undefined) ??
    undefined;
  return (
    <PanelSection title="Details">
      <dl className="space-y-3">
        <DetailRow icon={Hash} label="ID">
          <DocumentIdCopy id={entry?.id} />
        </DetailRow>
        {apiAddress === undefined ? null : (
          <DetailRow icon={Link} label="API">
            <ApiAddressCopy address={apiAddress} id={entry?.id} />
          </DetailRow>
        )}
        <WhenRow label="Created" at={createdAt} by={createdBy} />
        <WhenRow label="Updated" at={updatedAt} by={updatedBy} />
      </dl>
    </PanelSection>
  );
}

/** One labelled line of a panel section's list, its value at the end. */
export function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Hash;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span>{label}</span>
      </dt>
      <dd className="flex min-w-0 items-center justify-end gap-1">
        {children}
      </dd>
    </div>
  );
}

/** "<when> · <who>", or the date alone where nobody is recorded. */
function WhenRow({
  label,
  at,
  by,
}: {
  label: string;
  at: string | undefined;
  by: EntryChanger | null | undefined;
}) {
  const { formatDate } = useAdminDateFormatter();
  const when = at
    ? formatDate(at, { dateStyle: "medium", timeStyle: "short" }, at)
    : "—";
  const who = changerWords(by);
  const value = who === null ? when : `${when} · ${who}`;
  return (
    <DetailRow icon={Clock} label={label}>
      <span className="truncate text-xs text-foreground" title={value}>
        {value}
      </span>
    </DetailRow>
  );
}

/**
 * The API address, cut short to fit, and a control that copies it whole, as
 * a URL on this admin's own site, which is where it is read.
 */
export function ApiAddressCopy({
  address,
  id,
}: {
  address: string;
  id: string | null | undefined;
}) {
  const full =
    typeof window === "undefined"
      ? address
      : `${window.location.origin}${address}`;
  const { copied, copy } = useCopyToClipboard(full, () =>
    toast.error("Couldn't copy the API address", { description: full })
  );
  return (
    <>
      <span
        className="min-w-0 truncate font-mono text-xs text-foreground"
        title={address}
      >
        {/* The id in it shortened as the ID line shortens it, so the line
          fits the panel and still ends with what tells documents apart. */}
        {id && address.endsWith(id)
          ? `${address.slice(0, -id.length)}${formatId(id)}`
          : address}
      </span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded p-0.5 transition-colors hover:bg-primary/5"
        aria-label={copied ? "API address copied" : "Copy API address"}
      >
        {copied ? (
          <Check className="h-3 w-3 text-success" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </>
  );
}
