/**
 * The SEO section's Pages: every public page the site knows of, with the
 * title and description search is given for it and how it stands, in one
 * list. View mode lists them, each with its actions (Edit SEO, Inspect what
 * search engines receive, Add a redirect, and Open entry or View page); Edit
 * mode turns the titles and descriptions into boxes typed straight into.
 *
 * A page's status is read from the shared problem list, the one the
 * Problems screen and the Overview show, never worked out again here. Drawn
 * from the admin's own parts (`PageFrame`, `PageHeader`, `SegmentedChoice`,
 * `ListView`, `Select`, `Badge`, `Button`), so it looks like the admin's
 * other lists.
 *
 * Everything a person chooses or types is kept in the screen's own state,
 * never in the address: the admin mounts a plugin's page again when its
 * address changes, which would throw away unsaved edits.
 *
 * @module admin/SeoPagesPage
 */
import {
  apiErrorMessage,
  Badge,
  Button,
  ListView,
  navigateTo,
  PageFrame,
  PageHeader,
  SegmentedChoice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  usePluginRoute,
  type BadgeProps,
  type ListSearch,
  type NextlyColumn,
  type RowAction,
} from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useRef, useState, type JSX, type ReactNode } from "react";

import { ADDRESSES_ROUTE_PATH, type SiteAddress } from "../code-pages/contract";
import { IMPORT_PAGE_HREF } from "../overview/contract";
import { receivedHrefFor } from "../received/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { CodePagePanel } from "./code-page-panel";
import { useLeaveWarning } from "./leave-warning";
import type { PageEdits } from "./pages-edit";
import { PagesEditor } from "./pages-editor";
import {
  entryHref,
  newRedirectHref,
  problemsByPage,
  shownPages,
  statusOf,
  STATUS_ORDER,
  STATUS_TEXT,
  titleSourceText,
  typeChoices,
  type PagesFilter,
  type PageStatus,
  type ProblemsByPage,
  type TypeChoice,
} from "./pages-view";
import { useCheckedProblemList } from "./problem-list";
import { AdminLink } from "./section";

/** The list the addresses route answers with. */
interface AddressesBody {
  items: SiteAddress[];
}

/** The screen's two modes. */
type Mode = "view" | "edit";

/** The query an address opens Edit mode with: `?mode=edit`. */
export const EDIT_MODE_QUERY = "mode=edit";

/** The mode the screen's own address asks for. */
function modeInAddress(): Mode {
  if (typeof window === "undefined") return "view";
  return new URLSearchParams(window.location.search).get("mode") === "edit"
    ? "edit"
    : "view";
}

const MODES = [
  { value: "view", label: "View" },
  { value: "edit", label: "Edit titles and descriptions" },
] as const;

/** What the header says under the title, in each mode. */
const DESCRIPTION: Record<Mode, string> = {
  view: "Every public page, with the title and description search shows for it.",
  edit: "Type straight into a row. Empty means the automatic value fills it; the grey text shows what it would be.",
};

/** How each status's badge is drawn. */
const STATUS_BADGE: Record<PageStatus, BadgeProps["variant"]> = {
  good: "success",
  error: "destructive",
  warning: "warning",
  notice: "info",
  "not-connected": "warning",
  hidden: "outline",
};

/** The Pages screen, as the admin mounts it. */
export function SeoPagesPage(): JSX.Element {
  const addresses = usePluginRoute<AddressesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: ADDRESSES_ROUTE_PATH,
    // Entries and routes change elsewhere: read afresh each visit.
    staleTime: 0,
  });
  const problems = useCheckedProblemList();
  const [mode, setMode] = useState<Mode>(modeInAddress);
  const [filter, setFilter] = useState<PagesFilter>({
    query: "",
    type: "all",
    status: "all",
  });
  // Kept here, not in Edit mode, so a look at View mode and back keeps them.
  const [edits, setEdits] = useState<PageEdits>({});
  useLeaveWarning(Object.keys(edits).length > 0);

  const items = addresses.data?.items;
  const byPage = useMemo(
    () => problemsByPage(problems.list?.problems ?? []),
    [problems.list]
  );
  const statusFor = (item: SiteAddress) => statusOf(item, byPage);
  const shown = useMemo(
    () => shownPages(items ?? [], filter, item => statusOf(item, byPage)),
    [items, filter, byPage]
  );
  const failure =
    addresses.error === null || addresses.error === undefined
      ? null
      : `The site's pages could not be read. ${apiErrorMessage(addresses.error)}`;

  return (
    <PageFrame type="list">
      <PageHeader
        title="Pages"
        description={DESCRIPTION[mode]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Import is reached from Pages, as its one way in. */}
            {mode === "view" ? (
              <Button variant="outline" asChild>
                <AdminLink href={IMPORT_PAGE_HREF}>Import</AdminLink>
              </Button>
            ) : null}
            <SegmentedChoice
              aria-label="Mode"
              size="bordered"
              options={MODES}
              value={mode}
              onSelect={next => setMode(next === "edit" ? "edit" : "view")}
            />
          </div>
        }
      />
      {mode === "view" ? (
        <PagesList
          shown={shown}
          search={{
            value: filter.query,
            onChange: query => setFilter({ ...filter, query }),
            placeholder: "Search pages",
          }}
          filters={
            <TypeAndStatus
              items={items ?? []}
              filter={filter}
              onFilter={setFilter}
            />
          }
          loading={items === undefined && failure === null}
          failure={failure}
          filtered={
            filter.query !== "" ||
            filter.type !== "all" ||
            filter.status !== "all"
          }
          statusFor={statusFor}
        />
      ) : (
        <PagesEditor
          shown={shown}
          filters={
            <TypeAndStatus
              items={items ?? []}
              filter={filter}
              onFilter={setFilter}
            />
          }
          loading={items === undefined && failure === null}
          failure={failure}
          byPage={byPage}
          edits={edits}
          onEdits={setEdits}
          onSaved={() => {
            addresses.refetch();
            problems.check(false);
          }}
        />
      )}
    </PageFrame>
  );
}

/** The Type and Status filters, over `items`. */
function TypeAndStatus({
  items,
  filter,
  onFilter,
}: {
  items: readonly SiteAddress[];
  filter: PagesFilter;
  onFilter: (filter: PagesFilter) => void;
}): JSX.Element {
  const types = useMemo(() => typeChoices(items), [items]);
  return (
    <>
      <FilterSelect
        name="Type"
        value={filter.type}
        choices={types}
        onChange={type => onFilter({ ...filter, type })}
      />
      <FilterSelect
        name="Status"
        value={filter.status}
        choices={STATUS_ORDER.map(status => ({
          value: status,
          label: STATUS_TEXT[status],
        }))}
        onChange={status =>
          onFilter({
            ...filter,
            status: STATUS_ORDER.find(each => each === status) ?? "all",
          })
        }
      />
    </>
  );
}

/** One filter: its name and choice on its button, every choice in its list. */
function FilterSelect({
  name,
  value,
  choices,
  onChange,
}: {
  name: string;
  value: string;
  choices: readonly TypeChoice[];
  onChange: (value: string) => void;
}): JSX.Element {
  const chosen = choices.find(choice => choice.value === value)?.label ?? "All";
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={name} className="w-full sm:w-auto">
        <span>
          {name}: {chosen}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {choices.map(choice => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Where a page built in code is seen: on the site, at its address. */
function liveHref(item: SiteAddress): string {
  try {
    return item.canonical === undefined
      ? item.path
      : new URL(item.path, item.canonical).href;
  } catch {
    return item.path;
  }
}

/** A row's actions, in the order the list offers them. */
function actionsFor(
  item: SiteAddress,
  openPanel: (item: SiteAddress) => void
): RowAction<SiteAddress>[] {
  const { entry } = item;
  return [
    {
      id: "edit-seo",
      label: "Edit SEO",
      isVisible: () => entry !== undefined || item.seo !== undefined,
      onSelect: () =>
        entry === undefined
          ? openPanel(item)
          : navigateTo(entryHref(entry, "seo")),
    },
    {
      id: "inspect",
      label: "Inspect what search engines receive",
      onSelect: () => navigateTo(receivedHrefFor(item.path)),
    },
    {
      id: "redirect",
      label: "Add a redirect",
      onSelect: () => navigateTo(newRedirectHref(item.path)),
    },
    entry === undefined
      ? {
          id: "view-page",
          label: "View page",
          onSelect: () => {
            window.open(liveHref(item), "_blank", "noopener,noreferrer");
          },
        }
      : {
          id: "open-entry",
          label: "Open entry",
          onSelect: () => navigateTo(entryHref(entry)),
        },
  ];
}

/** View mode: the list, and the panel of a page built in code being edited. */
function PagesList({
  shown,
  search,
  filters,
  loading,
  failure,
  filtered,
  statusFor,
}: {
  shown: SiteAddress[];
  search: ListSearch;
  filters: ReactNode;
  loading: boolean;
  failure: string | null;
  filtered: boolean;
  statusFor: (item: SiteAddress) => PageStatus;
}): JSX.Element {
  const [open, setOpen] = useState<SiteAddress | null>(null);
  // Closes the panel of `path`, and only it: a save that finishes after
  // another page's panel was opened leaves that one open.
  const openNow = useRef(open);
  openNow.current = open;
  const columns = useMemo(() => pageColumns(statusFor), [statusFor]);
  const host =
    shown
      .map(item => {
        try {
          return item.canonical === undefined
            ? undefined
            : new URL(item.canonical).host;
        } catch {
          return undefined;
        }
      })
      .find(Boolean) ??
    (typeof window === "undefined" ? "the site" : window.location.host);
  return (
    <>
      <ListView<SiteAddress>
        columns={columns}
        rows={shown}
        getRowId={item => item.path}
        rowActions={item => actionsFor(item, setOpen)}
        loading={loading}
        error={failure}
        ariaLabel="Pages"
        search={search}
        inlineFilters={filters}
        toolbarActions={
          loading ? null : (
            <span className="text-sm text-muted-foreground">
              {shown.length} {shown.length === 1 ? "page" : "pages"}
            </span>
          )
        }
        empty={{
          title: "No public pages yet",
          description:
            "Pages appear here once an entry is published at an address, or a route is built.",
        }}
        emptyFiltered={{
          title: "No pages match",
          description:
            "Try part of the address, like /blog, or another filter.",
        }}
        hasActiveFilters={filtered}
      />
      {open?.seo !== undefined ? (
        <CodePagePanel
          key={open.path}
          item={open}
          host={host}
          onClose={() => {
            if (openNow.current?.path === open.path) setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The list's columns: the page, its title and description, its status. */
function pageColumns(
  statusFor: (item: SiteAddress) => PageStatus
): NextlyColumn<SiteAddress>[] {
  return [
    {
      name: "page",
      header: "Page",
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {row.path}
          </span>
        </div>
      ),
    },
    {
      name: "title",
      header: "Title in search",
      cell: ({ row }) => (
        <div className="flex min-w-0 max-w-[260px] flex-col gap-0.5">
          <span className="truncate" title={row.title}>
            {row.title ?? "—"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {titleSourceText(row)}
          </span>
        </div>
      ),
    },
    {
      name: "description",
      header: "Description",
      hideOnMobile: true,
      cell: ({ row }) => (
        <span
          className="block max-w-[300px] truncate text-muted-foreground"
          title={row.description}
        >
          {row.description ?? "—"}
        </span>
      ),
    },
    {
      name: "status",
      header: "Status",
      width: 120,
      cell: ({ row }) => {
        const status = statusFor(row);
        return (
          <Badge variant={STATUS_BADGE[status]}>{STATUS_TEXT[status]}</Badge>
        );
      },
    },
  ];
}
