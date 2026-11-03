"use client";

/**
 * The editor's Pages panel: the site's pages, grouped by the collection they
 * belong to, with search, and the ways to open, add, duplicate, rename and
 * delete them without leaving the editor.
 *
 * Reads and writes go through the plugin's page routes, which act as the
 * author asking, so what is listed and what may be changed are core's to
 * decide. Opening a page goes through `navigateTo`, where the admin's
 * unsaved-changes guard asks first.
 *
 * @module pages-panel
 */

import {
  apiErrorMessage,
  navigateTo,
  readPluginRoute,
  useDocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@nextlyhq/ui";
import { FileText, MoreHorizontal, Plus, Search } from "lucide-react";
import * as React from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  pagesSearchPath,
  PAGES_SEARCH_LIMIT_MAX,
  type PageItem,
  type PageReference,
  type PagesSearchResponse,
} from "../../pages-search-contract";
import {
  createPage,
  deletePage,
  duplicatePage,
  renamePage,
} from "../pages-client";

import { builderAddress } from "./builder-address";

/** How long typing must pause before the list is searched. */
const SEARCH_DEBOUNCE_MS = 150;

/** What each state chip says. A plainly published page shows none. */
const STATE_WORDS: Readonly<Record<NonNullable<PageItem["state"]>, string>> = {
  draft: "Draft",
  changed: "Changed",
  scheduled: "Scheduled",
};

/** The Pages panel as the editor mounts it, and its request to open Settings. */
export interface PagesPanelMount {
  /** Draws the panel. */
  renderPagesPanel: () => React.ReactNode;
  /** Sent to the shell, which opens Settings once per new count. */
  settingsRequest: { readonly count: number } | undefined;
  /** The page being edited, or null before it has been saved. */
  currentPage: PageReference | null;
}

/**
 * The Pages panel's mount: the page being edited, and the Settings request a
 * row's "Settings" sends. A page opened from another page's "Settings" arrives
 * with `settings=1` in its address, and opens with Settings up.
 */
export function usePagesPanel(
  /** Whether the document being edited is a page, not a component or pattern. */
  editingPage: boolean
): PagesPanelMount {
  const identity = useDocumentIdentity();
  const currentPage: PageReference | null =
    editingPage &&
    identity?.kind === "collection" &&
    identity.documentId !== undefined
      ? { collection: identity.slug, id: identity.documentId }
      : null;
  const [settingsRequest, setSettingsRequest] = React.useState<
    { readonly count: number } | undefined
  >(() => (arrivedForSettings() ? { count: 1 } : undefined));
  const openSettings = React.useCallback(
    () => setSettingsRequest(earlier => ({ count: (earlier?.count ?? 0) + 1 })),
    []
  );
  return {
    currentPage,
    settingsRequest,
    renderPagesPanel: () => (
      <PagesPanel current={currentPage} onOpenSettings={openSettings} />
    ),
  };
}

/** Whether this page was opened from another page's "Settings". */
function arrivedForSettings(): boolean {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.get("settings") === "1";
}

interface PagesPanelProps {
  /** The page being edited, so its row is marked and its actions act here. */
  current: PageReference | null;
  /** Opens this page's Settings dialog. */
  onOpenSettings: () => void;
}

function PagesPanel({
  current,
  onOpenSettings,
}: PagesPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const list = usePagesList(query);
  const [deleting, setDeleting] = React.useState<PageItem | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const act = useActions({
    current,
    list,
    onOpenSettings,
    report: setProblem,
  });

  return (
    <div className="flex h-full flex-col gap-3 p-3" aria-label="Pages">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Pages</h2>
        <NewPageButton
          // The page being edited's own collection, else the first one the
          // unfiltered list showed: never whatever a search happens to rank
          // first, which would move where a new page goes as the author types.
          collection={current?.collection ?? list.firstCollection}
          onCreate={act.create}
        />
      </div>
      <label className="relative block">
        <span className="sr-only">Search pages</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search pages"
          className="h-8 pl-7 text-sm"
        />
      </label>
      {problem === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <PageList
          list={list}
          query={query}
          current={current}
          actions={{ ...act, remove: setDeleting }}
        />
      </div>
      <DeletePageDialog
        page={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={page => {
          setDeleting(null);
          void act.remove(page);
        }}
      />
    </div>
  );
}

/** Where the list stands, and the ways to change it. */
interface PagesList {
  items: readonly PageItem[];
  /** The collection of the first page the unfiltered list showed. */
  firstCollection: string | undefined;
  state: "loading" | "ready" | "failed";
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * The pages for a search, read in pages of the route's largest size. A newer
 * search abandons the read before it, so an answer never lands under a search
 * it was not for.
 */
function usePagesList(query: string): PagesList {
  const [items, setItems] = React.useState<readonly PageItem[]>([]);
  const [state, setState] = React.useState<PagesList["state"]>("loading");
  const [next, setNext] = React.useState<string | undefined>(undefined);
  const [generation, setGeneration] = React.useState(0);
  const [firstCollection, setFirstCollection] = React.useState<
    string | undefined
  >(undefined);
  const reading = React.useRef<AbortController | null>(null);

  const read = React.useCallback(
    (before: string | undefined, append: boolean) => {
      reading.current?.abort();
      const controller = new AbortController();
      reading.current = controller;
      setState("loading");
      readPluginRoute<PagesSearchResponse>({
        plugin: PAGE_BUILDER_PLUGIN_NAME,
        path: pagesSearchPath({
          q: query.trim(),
          limit: PAGES_SEARCH_LIMIT_MAX,
          ...(before === undefined ? {} : { before }),
        }),
        signal: controller.signal,
      })
        .then(body => {
          if (controller.signal.aborted) return;
          // An answer that is not the list the contract promises is a
          // failure, not an empty site.
          if (body === undefined || !Array.isArray(body.items)) {
            setState("failed");
            return;
          }
          setItems(earlier =>
            append ? [...earlier, ...body.items] : body.items
          );
          setNext(body.meta.nextBefore ?? undefined);
          setState("ready");
          // Only an unfiltered answer names the site's first page collection.
          if (query.trim() === "" && body.items[0] !== undefined) {
            setFirstCollection(earlier => earlier ?? body.items[0]?.collection);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setState("failed");
        });
    },
    [query]
  );

  // Rows for another search are retired the moment the search changes, not
  // when the new answer lands: until then they would be acted on under it.
  const shownFor = React.useRef(query);
  React.useEffect(() => {
    if (shownFor.current !== query) {
      shownFor.current = query;
      setItems([]);
      setNext(undefined);
      setState("loading");
    }
    const timer = setTimeout(() => read(undefined, false), SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      reading.current?.abort();
    };
  }, [read, generation, query]);

  return {
    items,
    firstCollection,
    state,
    hasMore: next !== undefined,
    loadMore: () => read(next, true),
    reload: () => setGeneration(count => count + 1),
  };
}

/** What a row's menu can do. */
interface RowActions {
  open: (page: PageItem) => void;
  rename: (page: PageItem, title: string) => Promise<void>;
  duplicate: (page: PageItem) => Promise<void>;
  settings: (page: PageItem) => void;
  remove: (page: PageItem) => void;
}

/** The panel's actions, each reporting a refusal in plain words. */
function useActions({
  current,
  list,
  onOpenSettings,
  report,
}: {
  current: PageReference | null;
  list: PagesList;
  onOpenSettings: () => void;
  report: (problem: string | null) => void;
}): Omit<RowActions, "remove"> & {
  create: (collection: string, title: string) => Promise<void>;
  remove: (page: PageItem) => Promise<void>;
} {
  const attempt = async (what: string, work: () => Promise<void>) => {
    report(null);
    try {
      await work();
    } catch (error) {
      // The route's own reason where it gives one (a validation issue's
      // words), not only the envelope's generic message.
      report(`Couldn't ${what}. ${apiErrorMessage(error, "")}`.trim());
    }
  };
  return {
    open: page => openPage(page),
    settings: page =>
      isCurrent(page, current) ? onOpenSettings() : openPage(page, true),
    rename: (page, title) =>
      attempt(`rename "${page.title}"`, async () => {
        await renamePage(page, title);
        list.reload();
      }),
    duplicate: page =>
      attempt(`duplicate "${page.title}"`, async () => {
        openPage(await duplicatePage(page));
      }),
    create: (collection, title) =>
      attempt("add the page", async () => {
        openPage(await createPage({ collection, title }));
      }),
    remove: page =>
      attempt(`delete "${page.title}"`, async () => {
        await deletePage(page);
        list.reload();
      }),
  };
}

/** Whether this row is the page being edited. */
function isCurrent(
  page: PageReference,
  current: PageReference | null
): boolean {
  return (
    current !== null &&
    page.collection === current.collection &&
    page.id === current.id
  );
}

/**
 * Opens a page in the editor, where the admin's guard asks first if work
 * would be lost. With `settings`, it opens with its Settings dialog up.
 */
function openPage(
  page: Pick<PageItem, "collection" | "id" | "field">,
  settings = false
): void {
  const address = builderAddress(
    { kind: "collection", slug: page.collection, documentId: page.id },
    page.field
  );
  if ("href" in address) {
    navigateTo(settings ? `${address.href}&settings=1` : address.href);
  }
}

/** The list itself: its groups, or what it says when it has none. */
function PageList({
  list,
  query,
  current,
  actions,
}: {
  list: PagesList;
  query: string;
  current: PageReference | null;
  actions: RowActions;
}): React.JSX.Element {
  if (list.state === "failed") {
    return (
      <div className="grid justify-items-start gap-2 text-sm text-muted-foreground">
        <p>Couldn&rsquo;t load the pages.</p>
        <Button type="button" size="sm" variant="outline" onClick={list.reload}>
          Retry
        </Button>
      </div>
    );
  }
  // Empty AND nothing more: an empty first page can still have pages after
  // it (rows the author may not open, skipped), reached with Show more.
  if (list.state === "ready" && list.items.length === 0 && !list.hasMore) {
    return (
      <p className="text-sm text-muted-foreground">
        {query.trim() === ""
          ? "No pages yet."
          : `No pages match "${query.trim()}".`}
      </p>
    );
  }
  const groups = groupsOf(list.items);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      {groups.map(group => (
        <section
          key={group.collection}
          aria-label={group.label}
          className="min-w-0"
        >
          {groups.length > 1 ? (
            <h3 className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h3>
          ) : null}
          <ul className="grid min-w-0 grid-cols-1 gap-0.5">
            {group.items.map(page => (
              <PageRow
                key={`${page.collection}:${page.id}`}
                page={page}
                editing={isCurrent(page, current)}
                actions={actions}
              />
            ))}
          </ul>
        </section>
      ))}
      {list.hasMore ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={list.loadMore}
          disabled={list.state === "loading"}
        >
          Show more pages
        </Button>
      ) : null}
    </div>
  );
}

/** The pages by collection, in the order the route answered them. */
function groupsOf(
  items: readonly PageItem[]
): { collection: string; label: string; items: PageItem[] }[] {
  const groups = new Map<
    string,
    { collection: string; label: string; items: PageItem[] }
  >();
  for (const item of items) {
    const group = groups.get(item.collection) ?? {
      collection: item.collection,
      // Plural over a group of them: "Pages", not "Page".
      label: item.collectionPluralLabel ?? item.collectionLabel,
      items: [],
    };
    group.items.push(item);
    groups.set(item.collection, group);
  }
  return [...groups.values()];
}

/** A chip in the admin's own status style: a dot and a word, no colour block. */
function Chip({ children }: { children: string }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** One page: its title, what sets it apart, and its menu. */
function PageRow({
  page,
  editing,
  actions,
}: {
  page: PageItem;
  editing: boolean;
  actions: RowActions;
}): React.JSX.Element {
  const [renaming, setRenaming] = React.useState(false);
  const title = page.title.trim() === "" ? "Untitled" : page.title;
  return (
    <li
      className={`group flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm ${
        editing ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      {renaming ? (
        <RenameField
          title={page.title}
          onDone={next => {
            setRenaming(false);
            if (next !== null && next !== page.title) {
              void actions.rename(page, next);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left focus-visible:outline-none focus-visible:underline"
          onClick={() => {
            if (!editing) actions.open(page);
          }}
          aria-current={editing ? "page" : undefined}
        >
          {title}
        </button>
      )}
      {/* Plain words, not a chip: being edited is where the author is, not
          a state of the page beside its status. */}
      {editing ? (
        <span className="shrink-0 text-xs text-muted-foreground">Editing</span>
      ) : null}
      {page.state === undefined ? null : <Chip>{STATE_WORDS[page.state]}</Chip>}
      <RowMenu
        page={page}
        editing={editing}
        actions={actions}
        onRename={() => (editing ? actions.settings(page) : setRenaming(true))}
      />
    </li>
  );
}

/** A row's ⋯ menu, shown when the row is hovered or holds focus. */
function RowMenu({
  page,
  editing,
  actions,
  onRename,
}: {
  page: PageItem;
  editing: boolean;
  actions: RowActions;
  onRename: () => void;
}): React.JSX.Element {
  // A copy is made from the PUBLISHED page, so it cannot yet copy a draft,
  // nor the unpublished changes of a changed page: it would copy something
  // other than what the author sees.
  const unpublished = page.status === "draft" || page.state === "changed";
  // Rename starts once the menu has CLOSED. Started while it closes, the
  // menu's focus return pulls focus out of the new field, whose blur then
  // ends the rename before anything was typed.
  const renameAfterClose = React.useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`More for ${page.title || "Untitled"}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={event => {
          if (!renameAfterClose.current) return;
          renameAfterClose.current = false;
          event.preventDefault();
          onRename();
        }}
      >
        {editing ? null : (
          <DropdownMenuItem onSelect={() => actions.open(page)}>
            Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => {
            renameAfterClose.current = true;
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={unpublished}
          title={unpublished ? "Publish it first to duplicate it." : undefined}
          onSelect={() => void actions.duplicate(page)}
        >
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.settings(page)}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          // Not the page being edited: deleting it under the editor would
          // either leave the author on a page that no longer exists or, when
          // its unsaved work asks first, delete a page they chose to keep.
          disabled={editing}
          title={editing ? "Open another page to delete this one." : undefined}
          onSelect={() => actions.remove(page)}
        >
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The title, edited where it stands: Enter keeps it, Escape leaves it. */
function RenameField({
  title,
  onDone,
}: {
  title: string;
  onDone: (title: string | null) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState(title);
  const finish = (keep: boolean) => {
    const next = value.trim();
    onDone(keep && next !== "" ? next : null);
  };
  return (
    <Input
      aria-label="Page title"
      autoFocus
      value={value}
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
      className="h-7 min-w-0 flex-1 text-sm"
    />
  );
}

/** Adds a page: a title, then the new draft opens in the editor. */
function NewPageButton({
  collection,
  onCreate,
}: {
  collection: string | undefined;
  onCreate: (collection: string, title: string) => Promise<void>;
}): React.JSX.Element | null {
  const [naming, setNaming] = React.useState(false);
  if (collection === undefined) return null;
  return naming ? (
    <RenameField
      title=""
      onDone={title => {
        setNaming(false);
        if (title !== null) void onCreate(collection, title);
      }}
    />
  ) : (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setNaming(true)}
    >
      <Plus aria-hidden="true" className="size-3.5" />
      New page
    </Button>
  );
}

/** Deleting asks first, naming the page. */
function DeletePageDialog({
  page,
  onCancel,
  onConfirm,
}: {
  page: PageItem | null;
  onCancel: () => void;
  onConfirm: (page: PageItem) => void;
}): React.JSX.Element {
  return (
    <AlertDialog
      open={page !== null}
      onOpenChange={open => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “{page?.title || "Untitled"}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The page and its content are deleted. This can&rsquo;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (page !== null) onConfirm(page);
            }}
          >
            Delete page
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
