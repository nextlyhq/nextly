"use client";

/**
 * The sections only a Single's panel draws: what the Single is, when it was
 * last changed and by whom, and how a developer reaches it.
 *
 * A Single is the one entry of its kind (Homepage, Contact details), and it
 * usually has no drafts or languages, so without these its panel said only an
 * ID and two dates. "For developers" stands in Details' place, so a section a
 * plugin anchors to Details stays beside it.
 *
 * @module components/features/entries/EntryForm/panels/SinglePanelSections
 */

import type React from "react";

import { Hash, Link } from "@admin/components/icons";
import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";

import { DocumentIdCopy } from "../DocumentIdCopy";
import { changerWords, type EntryChanger } from "../entry-details-read";
import { formatTimeAgo } from "../time-ago";

import { ApiAddressCopy, DetailRow } from "./DetailsSection";
import { PanelSection } from "./PanelSection";

/** What a Single's panel is told about the Single itself. */
export interface SinglePanelFacts {
  /** The Single's name, as the admin shows it. */
  label: string;
  /** What its declaration says it is; absent, the fixed sentence says it. */
  description?: string | undefined;
  /**
   * Opens the Single's history. Absent where it keeps none, or where the
   * person may not read it, so "History" is not offered.
   */
  onOpenHistory?: (() => void) | undefined;
}

/** What this Single is: its own description, else what a Single is. */
export function WhatThisIsSection({
  label,
  description,
}: Pick<SinglePanelFacts, "label" | "description">): React.ReactElement {
  const said = description?.trim();
  return (
    <PanelSection title="What this is">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {said ||
          `One entry the site uses in one place. There's only ever one ${label}.`}
      </p>
    </PanelSection>
  );
}

/**
 * "<when> by <who>", and History where the Single keeps it. When is said as
 * long ago, the full date on hover; who by the rule Details names people by,
 * and left out where nobody is recorded.
 */
export function LastChangedSection({
  at,
  by,
  onOpenHistory,
}: {
  /** When the last recorded change was made. */
  at: string | undefined;
  by: EntryChanger | null | undefined;
  onOpenHistory?: (() => void) | undefined;
}): React.ReactElement {
  const { formatDate } = useAdminDateFormatter();
  const parsed = at === undefined ? null : new Date(at);
  const when =
    parsed === null || Number.isNaN(parsed.getTime()) ? null : parsed;
  const who = changerWords(by);
  return (
    <PanelSection title="Last changed">
      <p className="text-sm leading-relaxed text-foreground">
        {when === null ? (
          "—"
        ) : (
          <time
            dateTime={at}
            title={formatDate(when, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          >
            {formatTimeAgo(when)}
          </time>
        )}
        {who === null ? null : ` by ${who}`}
        {onOpenHistory === undefined ? null : (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {" · "}
            </span>
            {/* In the panel's text colour, as its other links are: the
                primary token is a fill a brand may set to any colour, and
                text drawn in it can fall under AA on the panel. */}
            <button
              type="button"
              onClick={onOpenHistory}
              className="rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              History
            </button>
          </>
        )}
      </p>
    </PanelSection>
  );
}

/**
 * How a developer reaches the Single: the API address "View API response"
 * reads, then its ID, each with a copy.
 */
export function ForDevelopersSection({
  apiAddress,
  id,
}: {
  apiAddress: string | undefined;
  id: string | null | undefined;
}): React.ReactElement {
  return (
    <PanelSection title="For developers">
      <dl className="space-y-3">
        {apiAddress === undefined ? null : (
          <DetailRow icon={Link} label="API">
            <ApiAddressCopy address={apiAddress} id={undefined} />
          </DetailRow>
        )}
        <DetailRow icon={Hash} label="ID">
          <DocumentIdCopy id={id} />
        </DetailRow>
      </dl>
    </PanelSection>
  );
}
