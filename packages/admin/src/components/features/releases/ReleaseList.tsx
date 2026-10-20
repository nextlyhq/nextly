"use client";

/**
 * The release list: one table, four tabs.
 *
 * Upcoming, Needs attention, Drafts and Done, each with its count, and every
 * release in exactly one of them. Which tab a release is in is the server's
 * rule (`?tab=`), applied with the search and the single-document filter
 * before paging and counting, so each count is the number its tab pages
 * through and every page is a true page of it.
 *
 * Built from the admin's shared list parts — the tab strip, `ListView` with
 * its toolbar, empty states and pager, and the table's row menu — so it reads
 * and behaves like every other list in the admin.
 *
 * The tab lives in the address (`?tab=attention`), and so does an optional
 * narrowing of Needs attention to one of its parts (`?reason=overdue`), so a
 * count shown elsewhere can link to exactly the releases it counted.
 *
 * @module components/features/releases/ReleaseList
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  CalendarClock,
  CheckCircle2,
  History,
  Pencil,
  Plus,
  Search,
} from "@admin/components/icons";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import type { PaginationProps } from "@admin/components/shared/pagination/types";
import {
  Button,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@admin/components/ui";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import { ListView, type ListEmpty } from "@admin/components/ui/table/list-view";
import { PAGINATION } from "@admin/constants/pagination";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useReleaseListPage,
  useReleasesReadiness,
  useReleaseTabCounts,
} from "@admin/hooks/queries/useReleases";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { navigateTo, setSearchParams } from "@admin/lib/navigation";
import { getSearchParam } from "@admin/lib/search-params";
import { cn } from "@admin/lib/utils";
import {
  RELEASE_LIST_TABS,
  type Release,
  type ReleaseListParams,
  type ReleaseAttentionReason,
  type ReleaseListTab,
} from "@admin/types/releases";

import {
  RELEASE_TAB_LABEL,
  RELEASE_WHEN_HEADER,
  releaseRowStatus,
} from "./release-list";
import { readerZone } from "./release-timezone";
import {
  ReleaseDocumentsCell,
  type ReleaseRowReadiness,
  ReleaseOwnerCell,
  ReleaseStatusBadge,
  ReleaseTitleCell,
  ReleaseWhenCell,
} from "./ReleaseListCells";
import {
  ReleaseRowActionDialog,
  type ReleaseRowAction,
} from "./ReleaseRowActionDialog";
import { ScheduleReleaseDialog } from "./ScheduleReleaseDialog";
import { useTabStripOverflow } from "./useTabStripOverflow";

/**
 * Rows per page: the sizes every admin table offers, starting at the middle
 * one, which holds a busy month of launches without scrolling past the pager.
 * The largest is also the most releases one readiness read answers for.
 */
const RELEASE_PAGE_SIZE: number = PAGINATION.TABLE_PAGE_SIZE_OPTIONS[1];
const RELEASE_PAGE_SIZE_OPTIONS = PAGINATION.TABLE_PAGE_SIZE_OPTIONS;

/** How often relative times ("in 3 minutes") are brought up to date. */
const CLOCK_TICK_MS = 60_000;

function isListTab(value: string | null): value is ReleaseListTab {
  return (
    value !== null && (RELEASE_LIST_TABS as readonly string[]).includes(value)
  );
}

function isAttentionReason(
  value: string | null
): value is ReleaseAttentionReason {
  return value === "stopped" || value === "overdue";
}

/** The current time, moved on once a minute so relative times stay true. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** The dialog a row's menu opened, and for which release. */
interface OpenDialog {
  release: Release;
  action: ReleaseRowAction | "schedule";
}

/** One entry of the row menu: when it is offered, and what it is called. */
interface RowMenuEntry {
  id: ReleaseRowAction | "schedule";
  offered: (release: Release) => boolean;
  label: (release: Release) => string;
  destructive?: boolean;
}

const isDraft = (release: Release) => release.state === "draft";

/**
 * The row menu's entries after "Open", in order, each offered from the
 * capabilities the server sent with the release. Nothing here decides what is
 * permitted; it decides only what to call each action and when two would
 * offer the same thing.
 */
const ROW_MENU: readonly RowMenuEntry[] = [
  {
    id: "schedule",
    offered: release => release.can?.schedule === true,
    label: release => (isDraft(release) ? "Schedule…" : "Reschedule…"),
  },
  {
    id: "publish",
    offered: release => release.can?.publishNow === true,
    label: () => "Publish now…",
  },
  {
    // A draft that may be deleted is offered Delete and not Discard: both end
    // with nothing going live, and two ways of getting rid of one draft is a
    // choice with no difference the reader can see from here.
    id: "cancel",
    offered: release =>
      release.can?.cancel === true && !(isDraft(release) && release.can.delete),
    label: release => (isDraft(release) ? "Discard…" : "Cancel release…"),
  },
  {
    id: "delete",
    offered: release => release.can?.delete === true,
    label: () => "Delete…",
    destructive: true,
  },
];

/** The actions a reader may take on a release, for its row menu. */
function rowActionsFor(
  release: Release,
  open: (dialog: OpenDialog) => void
): RowAction<Release>[] {
  const openRelease: RowAction<Release> = {
    id: "open",
    label: "Open",
    onSelect: () =>
      navigateTo(buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })),
  };
  const offered = ROW_MENU.filter(entry => entry.offered(release)).map(
    (entry): RowAction<Release> => ({
      id: entry.id,
      label: entry.label(release),
      destructive: entry.destructive,
      onSelect: () => open({ release, action: entry.id }),
    })
  );
  return [openRelease, ...offered];
}

function releaseColumns(
  tab: ReleaseListTab,
  zone: string,
  now: number,
  readinessOf: (releaseId: string) => ReleaseRowReadiness
): NextlyColumn<Release>[] {
  return [
    {
      name: "title",
      header: "Release",
      hideLabelOnMobile: true,
      cell: ({ row }) => <ReleaseTitleCell release={row} />,
    },
    {
      name: "when",
      header: RELEASE_WHEN_HEADER[tab],
      cell: ({ row }) => (
        <ReleaseWhenCell release={row} tab={tab} readerZone={zone} now={now} />
      ),
    },
    {
      name: "documents",
      header: "Documents",
      cell: ({ row }) => (
        <ReleaseDocumentsCell
          release={row}
          tab={tab}
          readiness={readinessOf(row.id)}
        />
      ),
    },
    {
      name: "state",
      header: "State",
      cell: ({ row }) => (
        <ReleaseStatusBadge status={releaseRowStatus(row, tab)} />
      ),
    },
    {
      name: "owner",
      header: "Owner",
      cell: ({ row }) => <ReleaseOwnerCell release={row} />,
    },
  ];
}

/**
 * What an empty tab says, and the next step it offers.
 *
 * With no release anywhere, every tab explains what a release is instead:
 * "nothing is scheduled" tells someone who has never made one nothing they can
 * act on.
 */
function emptyStateFor(
  tab: ReleaseListTab,
  {
    anyRelease,
    drafts,
    onCreate,
    onShowDrafts,
  }: {
    anyRelease: boolean;
    drafts: number;
    onCreate?: () => void;
    onShowDrafts: () => void;
  }
): ListEmpty {
  const create = onCreate ? (
    <Button onClick={onCreate}>
      <Plus className="size-4" aria-hidden />
      New release
    </Button>
  ) : undefined;

  if (!anyRelease) {
    return {
      icon: <CalendarClock className="size-5" aria-hidden />,
      title: "Plan your first release",
      description:
        "A release groups documents that should change together at one moment: a launch, an embargo lifting, a price change. Add the documents, pick the time, and they all go live at once.",
      action: create,
    };
  }
  switch (tab) {
    case "upcoming":
      return {
        icon: <CalendarClock className="size-5" aria-hidden />,
        title: "Nothing is scheduled",
        description:
          drafts > 0
            ? "Scheduled releases appear here, the next to go live first. Schedule a draft to put it here."
            : "Scheduled releases appear here, the next to go live first.",
        action:
          drafts > 0 ? (
            <Button variant="outline" onClick={onShowDrafts}>
              View drafts
            </Button>
          ) : (
            create
          ),
      };
    case "attention":
      return {
        icon: <CheckCircle2 className="size-5" aria-hidden />,
        title: "Nothing needs attention",
        description:
          "A release that stops on a problem, or is still waiting ten minutes after its time, appears here so someone can act on it.",
      };
    case "drafts":
      return {
        icon: <Pencil className="size-5" aria-hidden />,
        title: "No drafts",
        description:
          "A new release starts here, and stays here until it is scheduled.",
        action: create,
      };
    case "done":
      return {
        icon: <History className="size-5" aria-hidden />,
        title: "Nothing has run yet",
        description:
          "Releases that went live or were cancelled are kept here, the most recent first.",
      };
  }
}

/**
 * What a tab says when the search or a filter left nothing in it.
 *
 * It names what narrowed the list, so the reader knows the releases are not
 * gone, and offers to undo exactly that.
 */
function filteredEmptyFor(
  tab: ReleaseListTab,
  {
    search,
    reason,
    onClear,
  }: {
    search: string;
    reason: ReleaseAttentionReason | undefined;
    onClear: () => void;
  }
): ListEmpty {
  const label = RELEASE_TAB_LABEL[tab];
  let description: string;
  let clear: string;
  if (search) {
    description = `Nothing in ${label} has “${search}” in its title or description.`;
    clear = "Clear search";
  } else if (reason) {
    description = `No release in ${label} is ${reason} right now.`;
    clear = "Show everything that needs attention";
  } else {
    description =
      "Single-document releases are hidden, and there is nothing else here.";
    clear = "Show single documents";
  }
  return {
    icon: <Search className="size-5" aria-hidden />,
    title: `No ${label.toLowerCase()} releases match`,
    description,
    action: (
      <Button variant="outline" onClick={onClear}>
        {clear}
      </Button>
    ),
  };
}

/**
 * A tab's label with its count drawn as a pill. The pill is hidden from
 * assistive technology, which reads the trigger's own name instead, so the
 * count is announced as "Drafts (2)" rather than run into the word.
 */
function TabLabel({
  tab,
  count,
}: {
  tab: ReleaseListTab;
  count: number | undefined;
}) {
  // Needs attention draws its count in the warning tone only while there is
  // something in it: an alarm-coloured zero would ask for attention it does
  // not need.
  const urgent = tab === "attention" && (count ?? 0) > 0;
  return (
    <>
      {RELEASE_TAB_LABEL[tab]}
      {count === undefined ? null : (
        <>
          <span
            aria-hidden
            className={cn(
              "ml-2 inline-flex min-w-5 justify-center rounded-full px-1.5 text-xs font-medium tabular-nums leading-5",
              urgent
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            )}
          >
            {count}
          </span>
        </>
      )}
    </>
  );
}

/** A tab's accessible name: its label, and its count once known. */
function tabName(tab: ReleaseListTab, count: number | undefined): string {
  return count === undefined
    ? RELEASE_TAB_LABEL[tab]
    : `${RELEASE_TAB_LABEL[tab]} (${count})`;
}

/** The note above a Needs attention list narrowed to one of its parts. */
function reasonNotice(reason: ReleaseAttentionReason | undefined): ReactNode {
  if (!reason) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      Showing only {reason} releases.
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        onClick={() => setSearchParams({ reason: null })}
      >
        Show everything that needs attention
      </Button>
    </p>
  );
}

/**
 * A read that failed, said as a failure, with a way to try again.
 *
 * The admin's own section error state, so it reads like every other failed
 * section. Which read failed decides the words: a failed list is no list at
 * all, while failed counts leave the rows true but the tab totals unknown.
 */
function ReleaseReadFailure({
  listFailed,
  onRetry,
}: {
  listFailed: boolean;
  onRetry: () => void;
}) {
  return (
    <SectionErrorFallback
      title={
        listFailed
          ? "Releases could not be loaded"
          : "Release counts could not be loaded"
      }
      description={
        listFailed
          ? "This is a failed request, not an empty list. Try again in a moment."
          : "The number of releases in each tab is unknown, so a tab that looks empty may not be. Try again in a moment."
      }
      reset={onRetry}
    />
  );
}

/** The pager under a tab, or none for a tab with nothing in it. */
function pagerFor({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}): PaginationProps | undefined {
  if (total === 0) return undefined;
  return {
    currentPage: page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    totalItems: total,
    pageSize,
    pageSizeOptions: RELEASE_PAGE_SIZE_OPTIONS,
    onPageChange,
    onPageSizeChange,
    itemLabel: total === 1 ? "release" : "releases",
    ariaLabel: "Release pages",
  };
}

/**
 * What the list is being asked, held in one place: the tab and its narrowing
 * from the address, the search, the single-document filter, and the page.
 *
 * The page belongs to one question. Held with the question it was chosen for,
 * so a new tab, search, filter or page size starts on its first page in the
 * same render, rather than fetching the old page number of a different list
 * first and resetting after.
 */
function useReleaseListQuestion() {
  const params = useSearchParams();
  const linkedTab = getSearchParam(params, "tab");
  const linkedReason = getSearchParam(params, "reason");
  const tab: ReleaseListTab = isListTab(linkedTab) ? linkedTab : "upcoming";
  // Only Needs attention has parts to narrow to, so a reason carried onto any
  // other tab is ignored rather than sent and refused.
  const reason =
    tab === "attention" && isAttentionReason(linkedReason)
      ? linkedReason
      : undefined;

  const [search, setSearch] = useState("");
  const [hideSingles, setHideSingles] = useState(false);
  const [pageSize, setPageSize] = useState(RELEASE_PAGE_SIZE);
  const kind = hideSingles ? ("release" as const) : undefined;

  const question = [tab, reason, search, kind, pageSize].join("|");
  const [paging, setPaging] = useState({ question, page: 0 });
  const page = paging.question === question ? paging.page : 0;

  return {
    tab,
    reason,
    search,
    setSearch,
    hideSingles,
    setHideSingles,
    kind,
    pageSize,
    setPageSize,
    page,
    setPage: (next: number) => setPaging({ question, page: next }),
    clearFilters: () => {
      setSearch("");
      setHideSingles(false);
      if (reason) setSearchParams({ reason: null });
    },
  };
}

function goToTab(next: ReleaseListTab) {
  setSearchParams({ tab: next === "upcoming" ? null : next, reason: null });
}

/** The switch that hides single-document releases. */
function HideSinglesSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        id="release-hide-singles"
        checked={checked}
        onCheckedChange={onChange}
      />
      <Label
        htmlFor="release-hide-singles"
        className="cursor-pointer whitespace-nowrap text-sm font-normal text-muted-foreground"
      >
        Hide single documents
      </Label>
    </div>
  );
}

/** The dialog the row menu opened, if any. */
function ReleaseRowDialogs({
  dialog,
  open,
  onOpenChange,
}: {
  dialog: OpenDialog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!dialog) return null;
  if (dialog.action === "schedule") {
    return (
      <ScheduleReleaseDialog
        // Keyed by release: the dialog seeds its zone from the release it
        // opens on, and must not carry one release's choice to the next.
        key={dialog.release.id}
        release={dialog.release}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }
  return (
    <ReleaseRowActionDialog
      key={`${dialog.release.id}:${dialog.action}`}
      release={dialog.release}
      action={dialog.action}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * Keep the page inside the tab it pages through.
 *
 * A tab shrinks under the reader: the only release on the last page is
 * published, cancelled or deleted, here or by the runner between two polls.
 * The server then answers a page past the end with no rows, and the list would
 * show its empty state with no pager to get back. So once an answer for this
 * page (not a placeholder from the last one) says the page is past the end,
 * the list moves to the last page, or the first when the tab is empty.
 */
function useClampedPage(
  q: { page: number; pageSize: number; setPage: (page: number) => void },
  total: number | undefined
): void {
  const { page, pageSize, setPage } = q;
  useEffect(() => {
    if (total === undefined) return;
    const last = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (page > last) setPage(last);
  }, [total, page, pageSize, setPage]);
}

/**
 * What the checks say about each release on the page, from ONE read.
 *
 * Asked only for the rows that have something to check: a release with no
 * documents has nothing to be ready, and in Done nothing is left to get
 * ready. The answer is looked up per row by id.
 */
function usePageReadiness(
  tab: ReleaseListTab,
  list: {
    rows: readonly Release[] | undefined;
    readAt: number;
    placeholder: boolean;
  }
): (releaseId: string) => ReleaseRowReadiness {
  // Not asked for a placeholder page: those rows are the last read's, and the
  // read that replaces them asks for its own.
  const rows = list.placeholder ? undefined : list.rows;
  const ids = useMemo(
    () =>
      tab === "done"
        ? []
        : (rows ?? [])
            .filter(row => (row.memberCounts?.total ?? 0) > 0)
            .map(row => row.id),
    [tab, rows]
  );
  // Asked again whenever the list is read again (its poll, or a refresh).
  const read = useReleasesReadiness(ids, list.readAt);
  return useMemo(() => {
    if (read.isError) return () => ({ status: "failed" });
    if (read.data === undefined) return () => ({ status: "pending" });
    const byId = new Map(
      read.data.items.map(entry => [entry.releaseId, entry])
    );
    return (releaseId: string) => ({
      status: "known",
      entry: byId.get(releaseId),
    });
  }, [read.isError, read.data]);
}

export interface ReleaseListProps {
  /** Offered only to a caller who may assemble a release. */
  onCreate?: () => void;
}

/** The list read one tab's question makes. */
function listParamsFor(
  q: ReturnType<typeof useReleaseListQuestion>
): ReleaseListParams {
  const params: ReleaseListParams = {
    tab: q.tab,
    page: q.page + 1,
    limit: q.pageSize,
  };
  if (q.reason) params.reason = q.reason;
  if (q.search) params.search = q.search;
  if (q.kind) params.kind = q.kind;
  return params;
}

/**
 * Whether any release may exist. "None at all" is said only when every count
 * answered zero with no search or filter in force and the page holds none
 * either: a count that has not answered, or failed, is unknown, never zero.
 */
function anyReleaseMayExist(
  q: ReturnType<typeof useReleaseListQuestion>,
  counts: ReturnType<typeof useReleaseTabCounts>,
  pageTotal: number
): boolean {
  if (q.search || q.hideSingles || pageTotal > 0) return true;
  if (counts.isPending || counts.isError) return true;
  return RELEASE_LIST_TABS.some(t => (counts.counts[t] ?? 0) > 0);
}

/**
 * What one tab of the list reads, and what follows from it: the page and its
 * total, the counts, whether any release exists, and a failure to show.
 */
function useReleaseListData(q: ReturnType<typeof useReleaseListQuestion>) {
  const counts = useReleaseTabCounts({ search: q.search, kind: q.kind });
  const list = useReleaseListPage(listParamsFor(q));
  useClampedPage(q, list.isPlaceholderData ? undefined : list.data?.meta.total);
  const readiness = usePageReadiness(q.tab, {
    rows: list.data?.items,
    readAt: list.dataUpdatedAt,
    placeholder: list.isPlaceholderData,
  });
  const total = list.data?.meta.total ?? 0;
  // A failed read is shown as a failure, with a retry, and never as an empty
  // tab: "Nothing needs attention" read from a request that failed tells an
  // editor a stopped release is fine.
  const failed = list.isError || counts.isError;
  return {
    counts,
    list,
    readiness,
    total,
    rows: list.data?.items ?? [],
    anyRelease: anyReleaseMayExist(q, counts, total),
    failure: failed ? (
      <ReleaseReadFailure
        listFailed={list.isError}
        onRetry={() => {
          void list.refetch();
          counts.refetch();
        }}
      />
    ) : null,
  };
}

/** The list toolbar's search and filter, offered once any release exists. */
function toolbarFor(
  q: ReturnType<typeof useReleaseListQuestion>,
  anyRelease: boolean,
  searching: boolean
) {
  if (!anyRelease) return { search: undefined, inlineFilters: undefined };
  return {
    search: {
      value: q.search,
      onChange: q.setSearch,
      placeholder: "Search by title or description",
      isLoading: searching,
    },
    inlineFilters: (
      <HideSinglesSwitch checked={q.hideSingles} onChange={q.setHideSingles} />
    ),
  };
}

/** The tab strip, its counts, and the fades where tabs run past its edge. */
function ReleaseTabStrip({
  tab,
  counts,
}: {
  tab: ReleaseListTab;
  counts: Record<ReleaseListTab, number | undefined>;
}) {
  const strip = useTabStripOverflow(tab);
  return (
    <div ref={strip.ref} className="relative">
      <TabsList
        scrollable
        aria-label="Releases by state"
        className="justify-start"
      >
        {RELEASE_LIST_TABS.map(t => (
          <TabsTrigger key={t} value={t} aria-label={tabName(t, counts[t])}>
            <TabLabel tab={t} count={counts[t]} />
          </TabsTrigger>
        ))}
      </TabsList>
      {/* A fade where tabs run past the edge, so a cut-off tab reads as more
          to scroll to rather than as the end of the strip. Stops a pixel short
          of the rail, which stays drawn the full width. */}
      {strip.edges.start ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 bottom-px left-0 w-10 bg-gradient-to-r from-background to-transparent"
        />
      ) : null}
      {strip.edges.end ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 bottom-px right-0 w-10 bg-gradient-to-l from-background to-transparent"
        />
      ) : null}
    </div>
  );
}

export function ReleaseList({ onCreate }: ReleaseListProps) {
  const q = useReleaseListQuestion();
  const data = useReleaseListData(q);
  const { counts, list, rows, total, anyRelease, failure } = data;
  const zone = useMemo(() => readerZone(), []);
  const now = useMinuteClock();
  const columns = useMemo(
    () => releaseColumns(q.tab, zone, now, data.readiness),
    [q.tab, zone, now, data.readiness]
  );

  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = (next: OpenDialog) => {
    setDialog(next);
    setDialogOpen(true);
  };

  const panel = (
    <ListView<Release>
      {...toolbarFor(q, anyRelease, list.isFetching && Boolean(q.search))}
      hasActiveFilters={q.hideSingles || Boolean(q.reason)}
      columns={columns}
      rows={rows}
      getRowId={release => release.id}
      rowHref={release =>
        buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })
      }
      primaryColumn="title"
      rowActions={release => rowActionsFor(release, openDialog)}
      registryKey="releases"
      ariaLabel={`${RELEASE_TAB_LABEL[q.tab]} releases`}
      loading={list.isPending}
      error={null}
      empty={emptyStateFor(q.tab, {
        anyRelease,
        drafts: counts.counts.drafts ?? 0,
        onCreate,
        onShowDrafts: () => goToTab("drafts"),
      })}
      emptyFiltered={filteredEmptyFor(q.tab, {
        search: q.search,
        reason: q.reason,
        onClear: q.clearFilters,
      })}
      slots={{
        beforeList: failure,
        beforeTable: reasonNotice(q.reason),
      }}
      pagination={pagerFor({
        total,
        page: q.page,
        pageSize: q.pageSize,
        onPageChange: q.setPage,
        onPageSizeChange: q.setPageSize,
      })}
    />
  );
  // With no rows to keep, a failure stands in the list's place rather than
  // above an empty state that would contradict it.
  const body = failure && rows.length === 0 ? failure : panel;

  return (
    <>
      <Tabs
        value={q.tab}
        onValueChange={next => isListTab(next) && goToTab(next)}
      >
        <ReleaseTabStrip tab={q.tab} counts={counts.counts} />
        {/* One panel per tab for the tablist's own wiring; only the open
            tab's panel holds the list. */}
        {RELEASE_LIST_TABS.map(t => (
          <TabsContent key={t} value={t} className="mt-6">
            {t === q.tab ? body : null}
          </TabsContent>
        ))}
      </Tabs>

      <ReleaseRowDialogs
        dialog={dialog}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
