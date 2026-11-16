"use client";

/**
 * Previewing as a visitor: the strip above the canvas while the author's
 * "Preview as visitor" is on, what it says the conditions did, and why that
 * view can't be turned on where it can't.
 *
 * The view itself is turned on in the top bar's Preview menu. While it is
 * on, the canvas hides the blocks whose conditions don't match, as the
 * published page would, and this strip says so, with Stop to turn it off.
 * On a template the strip sits under the Previewing row, and checks against
 * the entry being previewed; on a page, against the page as a visitor reads
 * it. It is the author's own, for this session: it never changes what is
 * stored.
 *
 * @module conditions-strip
 */

import type { DocumentKind } from "@nextlyhq/blocks-engine";
import type { AppliedConditions } from "@nextlyhq/builder/shell";
import { Eye } from "lucide-react";

/** Why "Preview as visitor" can't be used where no block has conditions. */
const NO_CONDITIONS = "No block on this page has conditions";

/** Why it can't on a component: a Layout's header and footer are ones too. */
const PLACED_WHY =
  "No entry to check here. The published page checks them where it’s placed.";

/**
 * Why it can't where the conditions have nothing to be checked against: a
 * Single, which is no entry of a collection, or a template with no entry
 * previewed.
 */
const NEEDS_ENTRY = "Needs an entry to check its conditions against.";

/**
 * Why "Preview as visitor" can't be turned on, or undefined where it can.
 *
 * `conditioned` is whether the document holds a conditioned block at all,
 * its placed components' included; `entryToCheck` whether there is an entry
 * to check them against (the page itself, or a template's previewed entry).
 */
export function visitorUnavailable(
  kind: DocumentKind,
  conditioned: boolean,
  entryToCheck: boolean
): string | undefined {
  // Placed elsewhere and checked there, whether it holds conditions yet or
  // not: no entry is ever checked here.
  if (kind === "component") return PLACED_WHY;
  if (!conditioned) return NO_CONDITIONS;
  return entryToCheck ? undefined : NEEDS_ENTRY;
}

/**
 * What the conditions did for the entry: how many of the blocks that read
 * it are hidden, or that every one shows. Nothing while nothing is applied.
 */
export function conditionsCountWords(
  applied: AppliedConditions | undefined,
  noun: string
): string {
  if (applied === undefined) return "";
  const hidden = applied.hidden.length;
  if (hidden === 0) return nothingHiddenWords(applied, noun);
  return `${String(hidden)} block${hidden === 1 ? "" : "s"} hidden for this ${noun}`;
}

/**
 * What the count says while no block reading the entry is hidden. A block a
 * list's entry decides is checked for each entry drawn, and marked there,
 * which the count claims nothing of; one inside a placed component or a
 * region of the Layout, left unchecked, is said to be, so no words pass
 * over it.
 */
function nothingHiddenWords(applied: AppliedConditions, noun: string): string {
  if (applied.byEntry) {
    if (applied.unjudged) {
      return "Conditions checked for each entry in the list; some blocks aren’t checked";
    }
    return applied.shown.size === 0
      ? "Conditions checked for each entry in the list"
      : `Every conditioned block shows on this ${noun}`;
  }
  return applied.unjudged
    ? `Every block checked shows for this ${noun}`
    : `Every conditioned block shows for this ${noun}`;
}

/** What the strip says when what it checks against could not be read. */
const FAILED_WORDS = "Couldn’t check this page. Stop, then try again.";

/**
 * What the visitor strip says the conditions did: what was hidden, that the
 * entry is still being read as a visitor reads it, or that it couldn't be.
 */
export function visitorStripWords({
  applied,
  noun,
  failed = false,
}: {
  readonly applied: AppliedConditions | undefined;
  /** What the entry is called in words, lower case: "post". */
  readonly noun: string;
  /** Whether what is checked could not be read, so nothing is applied. */
  readonly failed?: boolean;
}): string {
  if (failed) return FAILED_WORDS;
  return applied === undefined
    ? "Checking…"
    : conditionsCountWords(applied, noun);
}

/**
 * The strip while the canvas shows the page as a visitor gets it: that it
 * does, what was hidden, and Stop. What was hidden is a live region, so each
 * change of it is announced.
 */
export function VisitorStrip({
  said,
  onStop,
}: {
  /** What the conditions did, from {@link visitorStripWords}. */
  readonly said: string;
  readonly onStop: () => void;
}): React.JSX.Element {
  return (
    <div className="nx-preview-strip" data-visitor-preview="">
      <span className="nx-preview-strip__mode">
        <Eye aria-hidden="true" size={14} />
        Previewing as a visitor
      </span>
      <span className="nx-preview-strip__sep" aria-hidden="true" />
      <span className="nx-preview-strip__count" role="status" title={said}>
        {said}
      </span>
      <button type="button" className="nx-preview-strip__stop" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
