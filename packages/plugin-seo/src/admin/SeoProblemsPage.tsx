/**
 * The problem list's screen: the problems the checks found, grouped by kind,
 * each with a button that goes straight to its fix. No score, and nothing
 * here stops anyone publishing.
 *
 * Opening it rechecks the whole site where the last full check is over a
 * day old or there has been none, and "Check now" does at any time.
 *
 * @module admin/SeoProblemsPage
 */
import {
  apiErrorMessage,
  Button,
  navigateTo,
  toastMutationResult,
} from "@nextlyhq/plugin-sdk/admin";
import type { JSX } from "react";

import {
  fixHref,
  type Problem,
  type ProblemListBody,
} from "../problems/contract";

import { useCheckedProblemList } from "./problem-list";
import { checkedWords, groupsOf, type ProblemGroup } from "./problem-view";
import { Icon, ROOT, SeoStyles } from "./styles";

/** `n problems`, `1 problem`. */
const problemCount = (count: number) =>
  `${count} ${count === 1 ? "problem" : "problems"}`;

/** `n pages`, `1 page`. */
const pageCount = (count: number) =>
  `${count} ${count === 1 ? "page" : "pages"}`;

/** A link to where a problem is fixed, or the button that copies a note. */
function FixButton({ problem }: { problem: Problem }): JSX.Element {
  const href = fixHref(problem);
  const label = (
    <>
      {problem.action} <Icon name="arrow" />
    </>
  );
  if (href !== undefined) {
    return (
      <Button asChild variant="outline" size="sm" className="nx-seo-sbtn">
        <a
          href={href}
          onClick={event => {
            // Within the admin, so the page is not loaded again from scratch.
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            navigateTo(href);
          }}
        >
          {label}
        </a>
      </Button>
    );
  }
  const note = problem.fix.place === "developer" ? problem.fix.note : "";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="nx-seo-sbtn"
      onClick={() => {
        // Where the clipboard can't be written (an address that is not
        // secure, or a policy refusing it), the note is shown to copy by hand.
        const clipboard =
          typeof navigator === "undefined" ? undefined : navigator.clipboard;
        if (clipboard === undefined) {
          toastMutationResult(note, []);
          return;
        }
        void clipboard.writeText(note).then(
          () => toastMutationResult(`Copied: “${note}”`, []),
          () => toastMutationResult(note, [])
        );
      }}
    >
      {label}
    </Button>
  );
}

/** One kind's problems: explained once, then one row per problem. */
function Group({ group }: { group: ProblemGroup }): JSX.Element {
  const headingId = `nx-seo-pg-${group.kind}`;
  return (
    <section className="nx-seo-pgroup" aria-labelledby={headingId}>
      <div className="nx-seo-pg-h">
        <span className="nx-seo-warnc">
          <Icon name="warn" />
        </span>
        <div className="nx-seo-grow">
          <h2 id={headingId}>
            {group.title}
            {group.problems.length > 1 ? (
              <>
                {" "}
                <span className="nx-seo-cnt n">{group.problems.length}</span>
              </>
            ) : null}
          </h2>
          <p>{group.explain}</p>
        </div>
        {group.siteWide ? <span className="nx-seo-chip">Site-wide</span> : null}
      </div>
      <ul className="nx-seo-prows">
        {group.problems.map((problem, index) => (
          <li className="nx-seo-prow" key={index}>
            <div className="nx-seo-where">
              <b>{problem.subject.label}</b>
              {problem.subject.detail === undefined ? null : (
                <span className="nx-seo-mono">{problem.subject.detail}</span>
              )}
            </div>
            <div className="nx-seo-what">{problem.what}</div>
            <div className="nx-seo-fixes">
              <FixButton problem={problem} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The heading's line: how many problems, and when the site was last checked. */
function Meta({
  list,
  checking,
  check,
}: {
  list: ProblemListBody | undefined;
  checking: boolean;
  check: () => void;
}): JSX.Element {
  let when: string;
  if (checking) {
    when =
      list !== undefined && list.pagesChecked > 0
        ? `Checking ${pageCount(list.pagesChecked)}…`
        : "Checking pages…";
  } else if (list?.checkedAt === undefined) {
    when = "Not checked yet";
  } else {
    when = `Last checked ${checkedWords(list.checkedAt, Date.now())}${
      list.outOfDate ? ", and pages have changed since" : ""
    }`;
  }
  return (
    <div className="nx-seo-pmeta">
      {list === undefined ? null : (
        <>
          <span>{problemCount(list.problems.length)}</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span role="status">{when}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="nx-seo-sbtn"
        disabled={checking}
        onClick={check}
      >
        <Icon name="refresh" /> Check now
      </Button>
    </div>
  );
}

/** The list's body: its groups, or what to say where there are none. */
function Body({
  list,
  failed,
}: {
  list: ProblemListBody | undefined;
  failed: Error | null;
}): JSX.Element {
  if (list === undefined) {
    return (
      <p className="nx-seo-state">
        {failed === null
          ? "Reading the problem list…"
          : apiErrorMessage(failed)}
      </p>
    );
  }
  if (list.problems.length === 0) {
    return (
      <p className="nx-seo-state">
        {list.checkedAt === undefined
          ? "No problems found so far."
          : `No problems found in ${pageCount(list.pagesChecked)}.`}
      </p>
    );
  }
  return (
    <div className="nx-seo-pgroups">
      {groupsOf(list.problems).map(group => (
        <Group key={group.kind} group={group} />
      ))}
    </div>
  );
}

/** The problem list's screen, as the admin mounts it. */
export function SeoProblemsPage(): JSX.Element {
  const { list, checking, failed, check } = useCheckedProblemList();
  const site = list?.site ?? "the site";
  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      <div className="nx-seo-head nx-seo-phead">
        <div>
          <h1>Problems</h1>
          <p>
            Things that affect how {site} shows up in search and when shared.
            Each one links to its fix. Nothing here stops anyone publishing.
          </p>
        </div>
        <Meta list={list} checking={checking} check={() => check()} />
      </div>
      {failed !== null && list !== undefined ? (
        <p className="nx-seo-alert" role="alert">
          {apiErrorMessage(failed)}
        </p>
      ) : null}
      <div className="nx-seo-body">
        <Body list={list} failed={failed} />
      </div>
    </div>
  );
}
