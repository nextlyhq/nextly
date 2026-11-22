"use client";

/**
 * The Page checks list: the page's findings by group, each saying what is
 * wrong, on which block, why it matters and what to do, with a press taking
 * the author to the fix. Drawn from the groups handed in, which the editor
 * derives from the draft on screen, so an item fixed while the list is open
 * leaves it at once.
 *
 * The list is the same wherever it opens from; the editor's entry point
 * holds it (`page-checks-chip`).
 *
 * @module page-checks/page-checks-list
 */
import { ChevronRight, ExternalLink } from "lucide-react";
import * as React from "react";

import type { PageCheckGroupView, PageFinding } from "./page-checks";

export interface PageChecksListProps {
  /** The groups to draw, in order, from `pageCheckGroups`. */
  readonly groups: readonly PageCheckGroupView[];
  /** The checks that couldn't run. */
  readonly notRun: readonly string[];
  /** Take the author to an item's fix. */
  readonly onFix: (finding: PageFinding) => void;
}

/** How many items need attention, in words. */
function attentionWords(count: number): string {
  if (count === 0) return "Nothing needs attention";
  return count === 1
    ? "1 item needs attention"
    : `${String(count)} items need attention`;
}

/** Up, Down, Home and End move between the list's items, as one list. */
function moveBetweenItems(event: React.KeyboardEvent<HTMLElement>): void {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      ".nx-page-checks__item"
    ),
  ];
  const at = items.indexOf(event.target as HTMLElement);
  if (at === -1) return;
  const to: Partial<Record<string, number>> = {
    ArrowDown: Math.min(at + 1, items.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: items.length - 1,
  };
  const next = to[event.key];
  if (next === undefined) return;
  event.preventDefault();
  items[next]?.focus();
}

/**
 * One item: the whole row takes the author to the fix.
 *
 * Named with every word it draws, in the order drawn: what is wrong, the
 * block, why it matters and what to do, so a speech-input user who says
 * what they see reaches it (WCAG 2.5.3). Each drawn part is a word apart
 * from the next, by a space between them that the layout doesn't draw.
 */
function FindingItem({
  finding,
  onFix,
}: {
  finding: PageFinding;
  onFix: (finding: PageFinding) => void;
}): React.JSX.Element {
  const what =
    finding.block === undefined
      ? finding.what
      : `${finding.what}: ${finding.block}`;
  const detail = (
    <span className="nx-page-checks__detail">
      <span className="nx-page-checks__why">{finding.why}</span>{" "}
      <span className="nx-page-checks__todo">{finding.todo}</span>
    </span>
  );
  const said = `${finding.why} ${finding.todo}`;
  // A fix outside this editor (a header's block, changed in its own
  // editor): the item is a link there, opened beside the page, as the
  // data meter offers it.
  if (finding.opens !== undefined) {
    return (
      <li>
        <a
          className="nx-page-checks__item"
          href={finding.opens.href}
          target="_blank"
          rel="noopener noreferrer"
          // Where it goes last, in parentheses: said, and not drawn.
          aria-label={`${what}. ${finding.opens.text}. ${said} (${finding.opens.name})`}
        >
          <span className="nx-page-checks__what">
            <span className="nx-page-checks__title">{finding.what}</span>{" "}
            <span className="nx-page-checks__block">{finding.opens.text}</span>
          </span>{" "}
          {detail}
          <ExternalLink aria-hidden="true" className="nx-page-checks__go" />
        </a>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className="nx-page-checks__item"
        aria-label={`${what}. ${said}`}
        onClick={() => onFix(finding)}
      >
        <span className="nx-page-checks__what">
          <span className="nx-page-checks__title">{finding.what}</span>
          {finding.block === undefined ? null : (
            <>
              {" "}
              <span className="nx-page-checks__block">{finding.block}</span>
            </>
          )}
        </span>{" "}
        {detail}
        <ChevronRight aria-hidden="true" className="nx-page-checks__go" />
      </button>
    </li>
  );
}

/** One group: its name and count, then its items or that none were found. */
function GroupSection({
  group,
  onFix,
}: {
  group: PageCheckGroupView;
  onFix: (finding: PageFinding) => void;
}): React.JSX.Element {
  // Named by the group alone; its heading also carries the count.
  return (
    <section className="nx-page-checks__group" aria-label={group.label}>
      <h3 className="nx-page-checks__group-name">
        {group.label}
        <span
          className="nx-page-checks__group-count"
          data-empty={group.findings.length === 0 ? "" : undefined}
        >
          {group.findings.length}
        </span>
      </h3>
      {/* Its standing lines first, which are read whatever is found. */}
      {group.notes.map(note => (
        <p key={note} className="nx-page-checks__note">
          {note}
        </p>
      ))}
      {group.findings.length === 0 ? (
        <p className="nx-page-checks__none">Nothing found.</p>
      ) : (
        <ul className="nx-page-checks__items">
          {group.findings.map(finding => (
            <FindingItem key={finding.key} finding={finding} onFix={onFix} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The list, with its heading, its groups and the note under them. */
export function PageChecksList({
  groups,
  notRun,
  onFix,
}: PageChecksListProps): React.JSX.Element {
  const count = groups.reduce((sum, group) => sum + group.findings.length, 0);
  return (
    <div className="nx-page-checks">
      <div className="nx-page-checks__head">
        <h2 className="nx-page-checks__heading">Page checks</h2>
        <p className="nx-page-checks__count">{attentionWords(count)}</p>
      </div>
      <div className="nx-page-checks__groups" onKeyDown={moveBetweenItems}>
        {groups.map(group => (
          <GroupSection key={group.group} group={group} onFix={onFix} />
        ))}
      </div>
      <div className="nx-page-checks__foot">
        {notRun.length === 0 ? null : (
          <p className="nx-page-checks__not-run">
            {notRun.length === 1
              ? "1 check couldn’t run, so this list may be missing problems."
              : `${String(notRun.length)} checks couldn’t run, so this list may be missing problems.`}
          </p>
        )}
        <p className="nx-page-checks__note">
          Automatic checks catch common problems. They don’t replace an
          accessibility review.
        </p>
      </div>
    </div>
  );
}
