/**
 * The Shared styles tab's list and what is said around it: the filter bar,
 * the note above the list, the notes while pages are counted, the styles
 * withheld from removal, the list of rows, and the rows not yet read.
 *
 * @module shared-styles-list
 */

import { Button } from "@nextlyhq/ui";
import * as React from "react";

import {
  inSharedStyleFilter,
  sharedStyleFilterEmpty,
  SHARED_STYLE_FILTERS,
  SHARED_STYLE_COUNTING_NOTE,
  SHARED_STYLE_UNCOUNTABLE_NOTE,
  SHARED_STYLE_UNUSED_UNCERTAIN,
  SHARED_STYLES_WORD,
  type SharedStyleFilter,
  type SharedStyleRow,
} from "./shared-style-library";
import type { Issue } from "./shared-styles-usage";
import {
  BackgroundJobsLink,
  CountedByJobs,
  countNowWords,
  type CountNow,
} from "./usage-reads";

/**
 * All · Used · Unused · Locked, each with how many styles it holds. Used and
 * Unused are counted only once every count is exact: while some pages are
 * still being counted, or some usage is still being read, a number there
 * would be a guess.
 */
export function FilterBar({
  rows,
  filter,
  onFilter,
  usageOf,
  exact,
}: {
  rows: readonly SharedStyleRow[];
  filter: SharedStyleFilter;
  onFilter: (filter: SharedStyleFilter) => void;
  usageOf: (row: SharedStyleRow) => "used" | "unused" | undefined;
  exact: boolean;
}): React.JSX.Element {
  const countOf = (candidate: SharedStyleFilter): number | undefined => {
    if ((candidate === "used" || candidate === "unused") && !exact) {
      return undefined;
    }
    return rows.filter(row => inSharedStyleFilter(row, candidate, usageOf(row)))
      .length;
  };
  return (
    <div className="nx-shared-styles__filters" role="group" aria-label="Show">
      <div className="nx-vars__seg">
        {SHARED_STYLE_FILTERS.map(({ filter: candidate, word }) => {
          const count = countOf(candidate);
          return (
            <button
              key={candidate}
              type="button"
              className="nx-shared-styles__filter"
              aria-pressed={filter === candidate}
              aria-label={
                count === undefined ? word : `${word} ${String(count)}`
              }
              onClick={() => onFilter(candidate)}
            >
              {word}
              {count === undefined ? null : (
                <span
                  className="nx-shared-styles__filter-count"
                  aria-hidden="true"
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A rename refused for this style, shown in its details. */
export function issueOf(issue: Issue | null, id: string): string | null {
  return issue?.id === id ? issue.reason : null;
}

/** A refused rename whose details are closed, shown above the list instead. */
export function issueBesideList(
  issue: Issue | null,
  openId: string | null
): string | null {
  return issue === null || issue.id === openId ? null : issue.reason;
}

/**
 * The one note while counts are floors, at the top of the list, and while
 * pages are still being counted, what counts them, with Count now. Carries
 * the id Remove unused points at when it says why that waits.
 */
export function TopNote({
  note,
  says,
  jobs,
  counter,
}: {
  note: string | undefined;
  /** Whether it says why Remove unused waits. */
  says: boolean;
  jobs: boolean;
  counter: CountNow | undefined;
}): React.JSX.Element | null {
  if (note === undefined) return null;
  return (
    <div className="nx-shared-styles__counting">
      <p
        className="nx-vars__note"
        id={says ? "nx-shared-styles-withheld" : undefined}
      >
        {note}
      </p>
      {jobs ? <CountedBy counter={counter} /> : null}
    </div>
  );
}

/**
 * Who counts the pages, beside a note that some are not counted yet. The
 * counts are filled in by one of the site's background jobs, which nothing
 * runs on a site with no scheduler, so there the counts never finish; this
 * says so, and links to how the jobs are run, rather than promising a wait.
 */
function CountedBy({
  counter,
}: {
  /** Counting the pages now, when this author may and the host can. */
  counter: CountNow | undefined;
}): React.JSX.Element {
  if (counter === undefined) return <CountedByJobs />;
  // One line under the note: the count, what it found, and how the jobs
  // that would have counted run. A button, since it does work; the docs are
  // a link, since they go somewhere.
  return (
    <div className="nx-shared-styles__count-row">
      {/* None once a count said another cannot get further. */}
      {counter.final ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-shared-styles__count-now"
          disabled={counter.busy}
          onClick={counter.run}
        >
          {countNowWords(counter)}
        </Button>
      )}
      {/* What the last count found, said as it changes. */}
      <span className="nx-vars__note" role="status">
        {counter.said ?? ""}
      </span>
      <BackgroundJobsLink />
    </div>
  );
}

/** The read-only line, a usage read that failed, and a refused rename. */
export function PanelNotes({
  readOnly,
  usageFailed,
  issue,
}: {
  readOnly: boolean;
  usageFailed: boolean;
  issue: string | null;
}): React.JSX.Element {
  return (
    <>
      {readOnly ? (
        <p className="nx-vars__note">
          {`You can view the site’s ${SHARED_STYLES_WORD} but not change them.`}
        </p>
      ) : null}
      {usageFailed ? (
        <p className="nx-vars__alert" role="alert">
          {`Where these ${SHARED_STYLES_WORD} are used could not be read.`}
        </p>
      ) : null}
      {issue === null ? null : (
        <p className="nx-vars__alert" role="alert">
          {issue}
        </p>
      )}
    </>
  );
}

/**
 * Why the tab's counts are floors: the site is still being counted (or may
 * be), or it cannot be counted in full, so they stay floors. Undefined while
 * every page is counted, whatever one style's own count says.
 */
export type FloorReason = "counting" | "permanent" | undefined;

export function floorReason(
  whole: boolean | undefined,
  counting: "yes" | "unknown" | "no"
): FloorReason {
  if (whole !== false) return undefined;
  return counting === "no" ? "permanent" : "counting";
}

/**
 * Which notes the tab says about floors. While counts are floors, ONE note
 * says why, at the top of the list, where the counts first read as
 * minimums. It covers the minimums, the rows Unused holds back and Remove
 * unused waiting, so neither the head nor the list says it again. Rows held back while every page is counted (one
 * style's count cut short) get their own line in the list: nothing is
 * waiting, and the proven rows are listed.
 */
export function countingNotes(
  withheld: boolean,
  reason: FloorReason
): {
  withheld: boolean;
  /** Whether the top note says why Remove unused waits. */
  one: boolean;
  /** The top note's words, while counts are floors. */
  top: string | undefined;
  /** Whether that note says pages are not counted yet, so who counts them. */
  jobs: boolean;
} {
  return {
    withheld,
    one: reason !== undefined,
    top:
      reason === "counting"
        ? SHARED_STYLE_COUNTING_NOTE
        : reason === "permanent"
          ? SHARED_STYLE_UNCOUNTABLE_NOTE
          : undefined,
    jobs: reason === "counting",
  };
}

/**
 * Whether Unused is holding back a row the search found: one whose zero is
 * not counted in full yet, so it is neither used nor certainly unused.
 */
export function unusedWithheld(
  filter: SharedStyleFilter,
  found: readonly SharedStyleRow[],
  usageOf: (row: SharedStyleRow) => "used" | "unused" | undefined
): boolean {
  return filter === "unused" && found.some(row => usageOf(row) === undefined);
}

/**
 * Unused while it holds rows back: the rows proven unused, and, when the top
 * note does not already say why (every page counted, but one style's count
 * cut short), a line that says so.
 */
function WithheldList({
  covered,
  listed,
  children,
}: {
  covered: boolean;
  listed: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {covered ? null : (
        <p className="nx-vars__empty">{SHARED_STYLE_UNUSED_UNCERTAIN}</p>
      )}
      {listed ? <ul className="nx-vars__list">{children}</ul> : null}
    </>
  );
}

/** The rows, or what to say when there are none or none match. */
export function StyleList({
  rows,
  found,
  filter,
  query,
  withheld,
  covered,
  children,
}: {
  rows: readonly SharedStyleRow[];
  /** The rows the search and the filter leave. */
  found: readonly SharedStyleRow[];
  filter: SharedStyleFilter;
  query: string;
  /**
   * Unused is holding back rows whose zero is not counted in full yet. The
   * rows proven unused are still listed, each judged on its own.
   */
  withheld: boolean;
  /** Whether the top note already says why rows are held back. */
  covered: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  // Whenever Unused holds a row back it says so, beside the rows it lists.
  if (withheld && rows.length > 0) {
    return (
      <WithheldList covered={covered} listed={found.length > 0}>
        {children}
      </WithheldList>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="nx-vars__empty">
        {`No ${SHARED_STYLES_WORD} yet. Select a block and choose Save as shared style…`}
      </p>
    );
  }
  if (found.length === 0) {
    return (
      <p className="nx-vars__empty">
        {filter === "all"
          ? `No ${SHARED_STYLES_WORD} match “${query}”.`
          : sharedStyleFilterEmpty(filter, query)}
      </p>
    );
  }
  return <ul className="nx-vars__list">{children}</ul>;
}

/** What shows while the library is being read, or after a read failed. */
export function Unread({
  absence,
}: {
  absence: "pending" | "failed";
}): React.JSX.Element {
  const failed = absence === "failed";
  return (
    <div className="nx-vars nx-shared-styles">
      <div className="nx-vars__body">
        <p
          className={failed ? "nx-vars__alert" : "nx-vars__note"}
          role={failed ? "alert" : "status"}
        >
          {failed
            ? `This site’s ${SHARED_STYLES_WORD} could not be read, so none can be shown or changed. Reload to try again.`
            : `Reading this site’s ${SHARED_STYLES_WORD}…`}
        </p>
      </div>
    </div>
  );
}
