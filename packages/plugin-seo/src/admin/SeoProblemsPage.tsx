/**
 * The problem list's screen: one row for each kind of problem the checks
 * found, most serious first, saying how serious it is, where it is and on
 * how many pages, with the way to its fix. A row that names pages opens on
 * them, each with its own fix. No score, and nothing here stops anyone
 * publishing.
 *
 * Opening it rechecks the whole site where the last full check is over a
 * day old or there has been none, and "Check again" does at any time. The
 * counts are the ones the Overview and the SEO menu count by
 * (`severityCounts`), so the three always agree.
 *
 * Drawn only from the admin's own parts (`PageFrame`, `PageHeader`,
 * `ListView`, `SegmentedChoice`, `Badge`, `Button`, `Alert`).
 *
 * @module admin/SeoProblemsPage
 */
import {
  Alert,
  AlertDescription,
  apiErrorMessage,
  Badge,
  Button,
  ListView,
  PageFrame,
  PageHeader,
  SegmentedChoice,
  type BadgeProps,
  type NextlyColumn,
} from "@nextlyhq/plugin-sdk/admin";
import { useState, type JSX } from "react";

import {
  fixHref,
  KIND_SEVERITY,
  problemTotal,
  severityCounts,
  severityIn,
  SEVERITY_ORDER,
  type Problem,
  type ProblemListBody,
  type ProblemSeverity,
  WHOLE_SITE,
} from "../problems/contract";

import { copyNote } from "./copy-note";
import { useCheckedProblemList } from "./problem-list";
import { checkedWords, groupsOf, type ProblemGroup } from "./problem-view";
import { AdminLink, SeoTrail } from "./section";
import { useListWidth } from "./use-list-width";

/** `n pages`, `1 page`. */
const pageCount = (count: number) =>
  `${count} ${count === 1 ? "page" : "pages"}`;

/** Each severity's name, as one problem's badge and as the filter says it. */
const SEVERITY_TEXT: Record<
  ProblemSeverity,
  { one: string; many: string; badge: BadgeProps["variant"] }
> = {
  error: { one: "Error", many: "Errors", badge: "destructive" },
  warning: { one: "Warning", many: "Warnings", badge: "warning" },
  notice: { one: "Notice", many: "Notices", badge: "default" },
};

/** The filter's choice: every severity, or one. */
type Shown = ProblemSeverity | "all";

/** A link to where a problem is fixed, or the button that copies a note. */
function FixButton({ problem }: { problem: Problem }): JSX.Element {
  const href = fixHref(problem);
  if (href !== undefined) {
    return (
      <Button asChild variant="link" size="sm">
        <AdminLink href={href}>{problem.action}</AdminLink>
      </Button>
    );
  }
  const note = problem.fix.place === "developer" ? problem.fix.note : "";
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      onClick={() => copyNote(note)}
    >
      {problem.action}
    </Button>
  );
}

/**
 * Whether a kind's row opens on the pages or things it names: any with
 * several problems, and one whose problem names more than the whole site,
 * such as a content type or a connection, so what to fix is always seen.
 */
function namesSeveral(group: ProblemGroup): boolean {
  return (
    group.problems.length > 1 ||
    group.problems.some(problem => problem.subject.label !== WHOLE_SITE.label)
  );
}

/** How many pages a kind is found on, counted as the Overview counts them. */
function pagesOf(group: ProblemGroup): number {
  return problemTotal(group.problems);
}

/** One row's opened region: each page or thing it names, with its own fix. */
function Named({ group }: { group: ProblemGroup }): JSX.Element {
  return (
    <ul className="flex max-w-2xl flex-col gap-1 text-sm">
      {group.problems.map((problem, index) => (
        <li key={index} className="flex flex-wrap items-center gap-x-2.5">
          <span className="font-medium">{problem.subject.label}</span>
          {problem.subject.detail === undefined ? null : (
            <span className="font-mono text-muted-foreground">
              {problem.subject.detail}
            </span>
          )}
          {group.problems.length > 1 ? (
            <span className="text-muted-foreground">{problem.what}</span>
          ) : null}
          <FixButton problem={problem} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A row's way to its fix: the one problem's own fix, or, where it names
 * several pages, the button that opens them, each with its fix.
 */
function RowFix({
  row,
  open,
}: {
  row: ProblemGroup;
  open: (kind: string) => void;
}): JSX.Element {
  const [only] = row.problems;
  if (row.problems.length === 1 && only !== undefined) {
    return <FixButton problem={only} />;
  }
  // Several pages: their fixes are listed under the row.
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      onClick={() => open(row.kind)}
    >
      {row.siteWide
        ? `Review ${row.problems.length}`
        : `Review ${pageCount(pagesOf(row))}`}
    </Button>
  );
}

/**
 * Below the table's own 28rem the list is drawn as cards, which name every
 * column; from 64rem the table has room for every column beside a problem's
 * words. Between the two, the table keeps Severity and Problem, and each
 * problem says where it is and its fix under its words, so no column is
 * cut off at the card's edge. In pixels, as the list's width is measured.
 */
const CARDS_BELOW = 448;
const EVERY_COLUMN_FROM = 1024;

/** How the list is drawn at a width: as cards, as the folded table, or with every column. */
type ListLayout = "cards" | "folded" | "every";

/**
 * The layout of a list `width` pixels wide. Unmeasured, it is the table
 * with every column, as it was drawn before the list read its width.
 */
function layoutAt(width: number | undefined): ListLayout {
  if (width === undefined || width >= EVERY_COLUMN_FROM) return "every";
  return width < CARDS_BELOW ? "cards" : "folded";
}

/**
 * The longest a problem's words run before they wrap: a readable 28rem, or
 * less where the columns beside it need the room. The table is as wide as
 * its cells' text, so this measure is what keeps it within its card; the
 * room the other columns take is reserved from the list's width (`cqw`, the
 * table's own container). Folded, that is the Details toggle and Severity;
 * with every column, also Where, Pages and the longest fix. A card holds
 * one column's words to a row, so it reserves nothing.
 */
const PROBLEM_MEASURE: Record<ListLayout, string> = {
  cards: "max-w-md",
  folded: "max-w-[min(28rem,calc(100cqw_-_12rem))]",
  every: "max-w-[min(28rem,calc(100cqw_-_38rem))]",
};

/** The list's columns: Severity, Problem, Where, Pages, and the fix. */
function columnsFor(
  open: (kind: string) => void,
  layout: ListLayout
): NextlyColumn<ProblemGroup>[] {
  const folded = layout === "folded";
  return [
    {
      name: "severity",
      header: "Severity",
      cell: ({ row }) => {
        const text = SEVERITY_TEXT[KIND_SEVERITY[row.kind]];
        // The first cell names the row and its opened region, so it says
        // the problem too, to a screen reader.
        return (
          <>
            <Badge variant={text.badge}>{text.one}</Badge>
            <span className="sr-only">: {row.title}</span>
          </>
        );
      },
    },
    {
      name: "problem",
      header: "Problem",
      cell: ({ row }) => {
        const [only] = row.problems;
        return (
          // A long sentence is held to a measure that leaves the other
          // columns their room, and wraps within it.
          <div className={`flex flex-col gap-0.5 ${PROBLEM_MEASURE[layout]}`}>
            <span className="font-semibold">{row.title}</span>
            {/* A long word, such as an environment variable a message
                names, breaks inside itself rather than running past a
                phone's card. */}
            <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {/* One problem says what is wrong; several, what they share. */}
              {row.problems.length === 1 && only !== undefined
                ? only.what
                : row.explain}
            </span>
            {folded ? (
              // Where it is, and the way to its fix, as the wide table's
              // Where, Pages and fix columns say them.
              <div className="flex flex-wrap items-center gap-x-2.5 text-sm">
                <span className="text-muted-foreground">
                  {row.siteWide ? "Whole site" : pageCount(pagesOf(row))}
                </span>
                <RowFix row={row} open={open} />
              </div>
            ) : null}
          </div>
        );
      },
    },
    ...(folded ? [] : wideColumns(open)),
  ];
}

/** The columns the table draws only where it has room for them all. */
function wideColumns(
  open: (kind: string) => void
): NextlyColumn<ProblemGroup>[] {
  return [
    {
      name: "where",
      header: "Where",
      cell: ({ row }) => (row.siteWide ? "Whole site" : "Pages"),
    },
    {
      name: "pages",
      header: "Pages",
      cell: ({ row }) =>
        row.siteWide ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="font-semibold">{pagesOf(row)}</span>
        ),
    },
    {
      name: "fix",
      header: <span className="sr-only">Fix</span>,
      cell: ({ row }) => <RowFix row={row} open={open} />,
    },
  ];
}

/** When the list was checked, or what is checking it now. */
function checkedLine(
  list: ProblemListBody | undefined,
  checking: boolean
): string {
  if (checking) {
    return list !== undefined && list.pagesChecked > 0
      ? `Checking ${pageCount(list.pagesChecked)}…`
      : "Checking pages…";
  }
  if (list?.checkedAt === undefined) return "Not checked yet";
  const when = checkedWords(list.checkedAt, Date.now());
  return list.outOfDate
    ? `Checked ${when}, and pages have changed since`
    : `Checked ${when}, and after every save`;
}

/** The filter's choices, each with its count, as the Overview counts. */
function filterOptions(problems: readonly Problem[]) {
  const counts = severityCounts(problems);
  return [
    { value: "all", label: `All ${problemTotal(problems)}` },
    ...SEVERITY_ORDER.map(severity => ({
      value: severity,
      label: `${SEVERITY_TEXT[severity].many} ${counts[severity]}`,
    })),
  ];
}

/** The problem list's screen, as the admin mounts it. */
export function SeoProblemsPage(): JSX.Element {
  const { list, checking, failed, check } = useCheckedProblemList();
  // A link from the Overview's counts narrows the list to one severity; the
  // address is read once, as the admin remounts the page when it changes.
  const [shown, setShown] = useState<Shown>(() =>
    typeof window === "undefined"
      ? "all"
      : (severityIn(window.location.search) ?? "all")
  );
  const [opened, setOpened] = useState<string[]>([]);
  const open = (kind: string) =>
    setOpened(current =>
      current.includes(kind) ? current : [...current, kind]
    );

  const problems = list?.problems ?? [];
  const groups = groupsOf(
    shown === "all"
      ? problems
      : problems.filter(problem => KIND_SEVERITY[problem.kind] === shown)
  );
  const pagesChecked = list?.pagesChecked ?? 0;
  // The list's own width chooses its columns (`layoutAt`).
  const [listRef, listWidth] = useListWidth();

  return (
    <PageFrame type="list">
      <PageHeader
        title="Problems"
        description="Grouped by what to fix. The same checks run on each page's SEO tab, so the two always agree."
        breadcrumbs={<SeoTrail steps={[{ label: "Problems" }]} />}
      />
      <div ref={listRef} className="w-full">
        <ListView<ProblemGroup>
          ariaLabel="Problems"
          columns={columnsFor(open, layoutAt(listWidth))}
          rows={groups}
          getRowId={group => group.kind}
          rowDetail={{
            render: group => <Named group={group} />,
            hasDetail: namesSeveral,
            toggleLabel: group => `Pages with: ${group.title}`,
            expandedIds: opened,
            onExpandedChange: setOpened,
          }}
          loading={list === undefined && failed === null}
          error={
            list === undefined && failed !== null
              ? apiErrorMessage(failed)
              : null
          }
          hasActiveFilters={shown !== "all"}
          empty={{
            title: "No problems found",
            description:
              list?.checkedAt === undefined
                ? "None so far. The whole site hasn't been checked yet."
                : `Checked ${pageCount(pagesChecked)}.`,
          }}
          emptyFiltered={{
            title: `No ${shown === "all" ? "problems" : SEVERITY_TEXT[shown].many.toLowerCase()} found`,
            description: `Checked ${pageCount(pagesChecked)}.`,
            action: (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShown("all")}
              >
                Show all problems
              </Button>
            ),
          }}
          slots={{
            beforeList: (
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedChoice
                  aria-label="Show problems"
                  size="bordered"
                  options={filterOptions(problems)}
                  value={shown}
                  onSelect={next => setShown(next as Shown)}
                />
                {/* When the list was checked and the button that checks it
                  again wrap as one, so on a narrower screen the button
                  stays beside its line rather than starting a row alone. */}
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
                  <span role="status" className="text-sm text-muted-foreground">
                    {checkedLine(list, checking)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={checking}
                    onClick={() => check()}
                  >
                    Check again
                  </Button>
                </div>
              </div>
            ),
            beforeTable:
              // A check or read that failed over a list already shown: the
              // list stays, with why it may be out of date above it.
              failed !== null && list !== undefined ? (
                <Alert variant="destructive">
                  <AlertDescription>{apiErrorMessage(failed)}</AlertDescription>
                </Alert>
              ) : null,
          }}
        />
      </div>
    </PageFrame>
  );
}
