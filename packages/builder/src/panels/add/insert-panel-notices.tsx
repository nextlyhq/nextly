"use client";

/**
 * What the Add panel says about its libraries: a list cut short, a list that
 * may be out of date, and a list that could not be read, each with its retry.
 *
 * @module insert-panel-notices
 */

import * as React from "react";

import type { InsertPanelProps, LibraryTierState } from "./insert-panel-types";

/**
 * That a tier of the library was cut, or could not be read, said where an
 * author looks for what is missing.
 *
 * `status` regions rather than alerts: each is a standing fact about this
 * read, present from the moment the panel opens, and an alert would interrupt
 * a screen reader mid-sentence to announce something that is not an event.
 * Drawn above the tiles so they are read BEFORE an author searches in vain —
 * a note at the end of a long list is one they reach after giving up.
 *
 * Named per tier, because the remedy the author reaches for differs: a pattern
 * left out is one they cannot insert, while a component left out is also one
 * already on the page drawing as could-not-be-loaded, and that second half is
 * the sentence nothing else says. A tier that could not be read at all gets
 * its own sentence and the retry, because that is a state with a remedy the
 * author can reach from here — and a tier that could not be RE-read gets a
 * third, since beside the tiles it left standing the second would be false.
 */
export function LibraryNotices({
  library,
  tier,
}: {
  library: InsertPanelProps["library"];
  /** The tier the surface offers: patterns as sections, or components. */
  tier: LibraryTier;
}): React.JSX.Element {
  return (
    <>
      <CutNotice tiers={tiersIn(library, "cut", tier)} />
      <StaleNotice
        tiers={tiersIn(library, "stale", tier)}
        retry={library?.retry}
      />
      <UnavailableNotice
        tiers={tiersIn(library, "unavailable", tier)}
        retry={library?.retry}
      />
    </>
  );
}

/** A tier of the host's library, as a notice names it. */
export type LibraryTier = "patterns" | "components";

/** The tiers a ceiling cut, and what a cut component means for the page. */
function CutNotice({
  tiers,
}: {
  tiers: string | undefined;
}): React.JSX.Element | null {
  if (tiers === undefined) return null;
  return (
    <p role="status" className="nx-insert-panel__note nx-insert-panel__cut">
      The library is larger than the editor can load at once, so some {tiers}{" "}
      are not offered here.
      {tiers.includes("components")
        ? " A component left out shows as “could not be loaded” on the page."
        : null}
    </p>
  );
}

/**
 * The tiers whose last answer could not be refreshed. The tiles stand, so
 * what is said of them is that they may be out of date — and of a component
 * on the page, that it draws as it was.
 */
function StaleNotice({
  tiers,
  retry,
}: {
  tiers: string | undefined;
  retry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (tiers === undefined) return null;
  return (
    <p role="status" className="nx-insert-panel__note nx-insert-panel__cut">
      The site’s {tiers} could not be reloaded, so those offered may be out of
      date.
      {tiers.includes("components")
        ? " A component already on the page draws as it was."
        : null}{" "}
      <RetryButton retry={retry} />
    </p>
  );
}

/** The tiers that could not be read at all, and what that means for the page. */
function UnavailableNotice({
  tiers,
  retry,
}: {
  tiers: string | undefined;
  retry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (tiers === undefined) return null;
  return (
    <p role="status" className="nx-insert-panel__note nx-insert-panel__cut">
      The site’s {tiers} could not be loaded, so none are offered here.
      {tiers.includes("components")
        ? " A component already on the page shows as “could not be loaded”."
        : null}{" "}
      <RetryButton retry={retry} />
    </p>
  );
}

/** The one remedy a failed read has, when the host supplied it. */
function RetryButton({
  retry,
}: {
  retry: (() => void) | undefined;
}): React.JSX.Element | null {
  if (retry === undefined) return null;
  return (
    <button type="button" className="nx-insert-panel__retry" onClick={retry}>
      Try again
    </button>
  );
}

/**
 * The surface's own tier when it is in one state, as the word a sentence
 * names it with — or nothing. Each surface reports only the tier it offers,
 * so it never reports content that could not appear in it.
 */
function tiersIn(
  library: InsertPanelProps["library"],
  state: LibraryTierState,
  tier: LibraryTier
): LibraryTier | undefined {
  return library?.[tier] === state ? tier : undefined;
}
