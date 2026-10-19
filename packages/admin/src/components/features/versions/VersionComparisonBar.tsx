"use client";

/**
 * The bar above a past version in the editor: which version is shown, what it
 * is compared with, how many fields changed, and a way through the changes.
 *
 * One bar rather than a banner plus controls in the panel: what is on screen,
 * against what, and how much differs are one question, and the reader asks it
 * where they are reading.
 *
 * @module components/features/versions/VersionComparisonBar
 */

import { ArrowDown, ArrowLeft, ArrowUp, History } from "lucide-react";

import { Button } from "@admin/components/ui";
import { formatDateTime } from "@admin/lib/dates/format";
import type { VersionMeta } from "@admin/services/versionApi";

import { versionAuthorLabel } from "./version-author";
import type { ChangesState } from "./version-changes";
import type { Predecessor } from "./version-pairing";

export interface VersionComparisonBarProps {
  versionNo: number;
  /** The version's name, time and author, once read. */
  about: VersionMeta | null;
  comparedWith: Predecessor;
  changes: ChangesState;
  /** Which change is current, counted from zero. */
  position: number;
  /** Moves to the previous (-1) or next (1) change. */
  onMove: (delta: -1 | 1) => void;
  /** Shows the history list again, where the panel stepped aside. */
  onBackToHistory?: () => void;
  /** Opens the full comparison with the version before, where offered. */
  onOpenComparison?: () => void;
  /** Opens the full comparison with the current version, where offered. */
  onCompareCurrent?: () => void;
}

/** How a version is named: its own name when it has one, else its number. */
function versionTitle(versionNo: number, about: VersionMeta | null): string {
  return about?.label ? `“${about.label}”` : `Version ${versionNo}`;
}

/** What the count says, in words a reader can act on. */
function countText(changes: ChangesState): string {
  switch (changes.kind) {
    case "reading":
      return "Reading what changed…";
    case "failed":
      return "What changed could not be read.";
    case "first":
      return "The first version, shown on its own.";
    case "ready":
      // Withheld fields may differ, so the count is said as a floor.
      return changes.incomplete
        ? `${changes.changed} of the ${changes.total} fields you can read changed`
        : `${changes.changed} of ${changes.total} fields changed`;
  }
}

/** What is shown: the version's title, then when, by whom, and its number. */
function ViewingLine({
  versionNo,
  about,
}: {
  versionNo: number;
  about: VersionMeta | null;
}) {
  // The number joins the detail where the title is a name rather than it.
  const detail = about
    ? [
        formatDateTime(about.createdAt),
        versionAuthorLabel(about),
        ...(about.label ? [`v${versionNo}`] : []),
      ].join(" · ")
    : null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <History
        className="h-4 w-4 shrink-0 self-center text-muted-foreground"
        aria-hidden="true"
      />
      <span className="text-foreground">
        Viewing{" "}
        <span className="font-semibold">{versionTitle(versionNo, about)}</span>
      </span>
      {detail ? (
        <span className="text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </p>
  );
}

/** What the version is compared with, in words. */
function baselineText(comparedWith: Predecessor): string {
  if (comparedWith.kind === "version") {
    return `the version before it (Version ${comparedWith.versionNo})`;
  }
  return comparedWith.kind === "first"
    ? "nothing before it"
    : "the version before it";
}

/**
 * Previous and next change, with where the reader is. Hidden on a phone,
 * where the same moves sit in the bottom bar under the thumb.
 */
function ChangeNav({
  changed,
  position,
  onMove,
}: {
  changed: number;
  position: number;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      <span className="text-muted-foreground" aria-hidden="true">
        Change {position + 1} of {changed}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Previous change"
        title="Previous change"
        disabled={changed < 2}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Next change"
        title="Next change"
        disabled={changed < 2}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * The full comparisons, offered here where the panel stepped aside and
 * cannot offer them itself.
 */
function FullComparisonLinks({
  onOpenComparison,
  onCompareCurrent,
}: {
  onOpenComparison?: () => void;
  onCompareCurrent?: () => void;
}) {
  if (!onOpenComparison && !onCompareCurrent) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {onOpenComparison ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenComparison}
        >
          Open full comparison
        </Button>
      ) : null}
      {onCompareCurrent ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCompareCurrent}
        >
          Compare with current
        </Button>
      ) : null}
    </div>
  );
}

export function VersionComparisonBar({
  versionNo,
  about,
  comparedWith,
  changes,
  position,
  onMove,
  onBackToHistory,
  onOpenComparison,
  onCompareCurrent,
}: VersionComparisonBarProps) {
  const changed = changes.kind === "ready" ? changes.changed : 0;
  return (
    <section
      aria-label="Comparison"
      className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm"
    >
      {onBackToHistory ? (
        // Where the panel stepped aside, the way back to the list leads.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 -mt-1 self-start"
          onClick={onBackToHistory}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          History
        </Button>
      ) : null}
      <ViewingLine versionNo={versionNo} about={about} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-muted-foreground">
          Compared with{" "}
          <span className="text-foreground">{baselineText(comparedWith)}</span>
        </p>
        <p
          role="status"
          className={
            changes.kind === "ready"
              ? "font-semibold text-foreground"
              : "text-muted-foreground"
          }
        >
          {countText(changes)}
        </p>
        {changes.kind === "failed" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={changes.retry}
          >
            Try again
          </Button>
        ) : null}
        {changed > 0 ? (
          <ChangeNav changed={changed} position={position} onMove={onMove} />
        ) : null}
      </div>
      {comparedWith.kind === "version" ? (
        <p className="text-xs text-muted-foreground">
          Changes from{" "}
          <span className="font-medium text-foreground">
            Version {comparedWith.versionNo}
          </span>{" "}
          to{" "}
          <span className="font-medium text-foreground">
            {versionTitle(versionNo, about)}
          </span>
          .
        </p>
      ) : null}
      <FullComparisonLinks
        onOpenComparison={onOpenComparison}
        onCompareCurrent={onCompareCurrent}
      />
    </section>
  );
}
