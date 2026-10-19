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

import { useEffect, useMemo, useState } from "react";

import {
  CalendarClock,
  CheckCircle2,
  History,
  Pencil,
  Plus,
  Search,
} from "@admin/components/icons";
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
import {
  ListView,
  type ListEmpty,
  type ListSlots,
} from "@admin/components/ui/table/list-view";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useReleaseListPage,
  useReleaseTabCounts,
} from "@admin/hooks/queries/useReleases";
import { useSearchParams } from "@admin/hooks/useSearchParams";
import { navigateTo, setSearchParams } from "@admin/lib/navigation";
import { getSearchParam } from "@admin/lib/search-params";
import { cn } from "@admin/lib/utils";
import {
  RELEASE_LIST_TABS,
  type Release,
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

/**
 * Rows per page, and the sizes offered.
 *
 * Twenty to start, as the list was designed: enough to see a busy week of
 * launches without scrolling past the pager. The choices bracket it rather
 * than the 10/25/50 most tables offer, which has no 20 in it.
 */
const RELEASE_PAGE_SIZE = 20;
const RELEASE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

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
  now: number
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
      cell: ({ row }) => <ReleaseDocumentsCell release={row} tab={tab} />,
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
function reasonNotice(
  reason: ReleaseAttentionReason | undefined
): ListSlots | undefined {
  if (!reason) return undefined;
  return {
    beforeTable: (
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
    ),
  };
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

export interface ReleaseListProps {
  /** Offered only to a caller who may assemble a release. */
  onCreate?: () => void;
}

export function ReleaseList({ onCreate }: ReleaseListProps) {
  const q = useReleaseListQuestion();
  const counts = useReleaseTabCounts({ search: q.search, kind: q.kind });
  const list = useReleaseListPage({
    tab: q.tab,
    page: q.page + 1,
    limit: q.pageSize,
    ...(q.reason ? { reason: q.reason } : {}),
    ...(q.search ? { search: q.search } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
  });

  const zone = useMemo(() => readerZone(), []);
  const now = useMinuteClock();
  const columns = useMemo(
    () => releaseColumns(q.tab, zone, now),
    [q.tab, zone, now]
  );

  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = (next: OpenDialog) => {
    setDialog(next);
    setDialogOpen(true);
  };

  // Known only once every count has answered with no search or filter in
  // force; until then the tabs' own empty states are the honest ones.
  const anyRelease =
    Boolean(q.search) ||
    q.hideSingles ||
    counts.isPending ||
    RELEASE_LIST_TABS.some(t => (counts.counts[t] ?? 0) > 0);
  const total = list.data?.meta.total ?? 0;

  const panel = (
    <ListView<Release>
      search={
        anyRelease
          ? {
              value: q.search,
              onChange: q.setSearch,
              placeholder: "Search by title or description",
              isLoading: list.isFetching && Boolean(q.search),
            }
          : undefined
      }
      inlineFilters={
        anyRelease ? (
          <HideSinglesSwitch
            checked={q.hideSingles}
            onChange={q.setHideSingles}
          />
        ) : undefined
      }
      hasActiveFilters={q.hideSingles || Boolean(q.reason)}
      columns={columns}
      rows={list.data?.items ?? []}
      getRowId={release => release.id}
      rowHref={release =>
        buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id })
      }
      primaryColumn="title"
      rowActions={release => rowActionsFor(release, openDialog)}
      registryKey="releases"
      ariaLabel={`${RELEASE_TAB_LABEL[q.tab]} releases`}
      loading={list.isPending}
      error={list.isError ? "Releases could not be loaded." : null}
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
      slots={reasonNotice(q.reason)}
      pagination={pagerFor({
        total,
        page: q.page,
        pageSize: q.pageSize,
        onPageChange: q.setPage,
        onPageSizeChange: q.setPageSize,
      })}
    />
  );

  return (
    <>
      <Tabs
        value={q.tab}
        onValueChange={next => isListTab(next) && goToTab(next)}
      >
        <TabsList
          scrollable
          aria-label="Releases by state"
          className="justify-start"
        >
          {RELEASE_LIST_TABS.map(t => (
            <TabsTrigger
              key={t}
              value={t}
              aria-label={tabName(t, counts.counts[t])}
            >
              <TabLabel tab={t} count={counts.counts[t]} />
            </TabsTrigger>
          ))}
        </TabsList>
        {/* One panel per tab for the tablist's own wiring; only the open
            tab's panel holds the list. */}
        {RELEASE_LIST_TABS.map(t => (
          <TabsContent key={t} value={t} className="mt-6">
            {t === q.tab ? panel : null}
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
