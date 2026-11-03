"use client";

/**
 * The editor's search as this plugin mounts it: the builder's palette, given
 * the Add panel's sources, a way to bring a block into view, and the site's
 * other pages, read on the server as the author types.
 *
 * Also the top bar's search button, which opens the same palette: one search,
 * reached by ⌘K or by pointer.
 *
 * @module editor-search
 */

import { keyHint, revealNode } from "@nextlyhq/builder";
import {
  COMMAND_PALETTE_KEYS,
  EditorCommandPalette,
  type BuilderCommand,
} from "@nextlyhq/builder/shell";
import {
  navigateTo,
  readPluginRoute,
  useDocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import { Button, detectApplePlatform } from "@nextlyhq/ui";
import { FileText, Search } from "lucide-react";
import * as React from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  pagesSearchPath,
  type PageItem,
  type PageReference,
  type PagesSearchResponse,
} from "../../pages-search-contract";

import { builderAddress } from "./builder-address";

/** What the palette takes as a host's own results. */
type EditorSearchResults = NonNullable<
  React.ComponentProps<typeof EditorCommandPalette>["results"]
>;

/** How many pages a search shows, the same as the other kinds. */
const PAGES_SHOWN = 5;
/** How long typing must pause before the server is asked. */
const PAGES_DEBOUNCE_MS = 150;
const PAGES_GROUP = "Pages";

type EditorSearchProps = Omit<
  React.ComponentProps<typeof EditorCommandPalette>,
  "revealBlock" | "results" | "onSearchChange"
> & {
  /** The canvas's root, where a found block is brought into view. */
  canvas: Parameters<typeof revealNode>[0] | null;
};

export function EditorSearch({
  canvas,
  ...palette
}: EditorSearchProps): React.JSX.Element {
  const pages = usePageSearch();
  return (
    <EditorCommandPalette
      {...palette}
      revealBlock={id => {
        if (canvas !== null) revealNode(canvas, id);
      }}
      results={pages.results}
      onSearchChange={pages.search}
    />
  );
}

/** The top bar's way into the search, with its shortcut beside it. */
export function SearchButton({
  onOpen,
}: {
  onOpen: () => void;
}): React.JSX.Element {
  // The key as this platform names it: ⌘K on a Mac, Ctrl+K elsewhere.
  // Resolved after mounting, as the editor's other hints are: a server render
  // has no `navigator`, and would spell the key differently from the browser's
  // first render. Until then the button names no key.
  const [apple, setApple] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setApple(detectApplePlatform());
  }, []);
  const hint = apple === null ? null : keyHint(COMMAND_PALETTE_KEYS, apple);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      // A square at the editor's control height while it shows only its icon,
      // as the bar's other icon buttons are; wide again where the key hint shows.
      className="w-[var(--nx-builder-control-height)] px-0 @min-[1500px]/topbar:w-auto @min-[1500px]/topbar:px-[var(--nx-builder-control-padding-x)]"
      title={
        hint === null ? "Search and commands" : `Search and commands (${hint})`
      }
      aria-label="Search and commands"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={onOpen}
    >
      <Search className="size-4" aria-hidden="true" />
      {/* The key hint gives way first when the top bar is short of room, so
          the save state beside it never has to wrap and its recovery offer
          fits at 1440; the title still names the key. */}
      {hint === null ? null : (
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px] text-muted-foreground @max-[1500px]/topbar:hidden">
          {hint}
        </kbd>
      )}
    </Button>
  );
}

/** Where one search of the site's pages stands. */
type PagesState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "failed" }
  | { readonly kind: "found"; readonly items: readonly PageItem[] };

/**
 * The site's other pages for the current search, read on the server.
 *
 * Asked once typing pauses, and a newer search abandons the one before it, so
 * an answer never lands under a search it was not for. The page being edited
 * is left out: opening it again is not a way anywhere.
 */
function usePageSearch(): {
  results: EditorSearchResults;
  search: (query: string) => void;
} {
  const identity = useDocumentIdentity();
  const exclude: PageReference | undefined =
    identity?.kind === "collection" && identity.documentId !== undefined
      ? { collection: identity.slug, id: identity.documentId }
      : undefined;
  const excludeKey = exclude === undefined ? "" : JSON.stringify(exclude);
  const [state, setState] = React.useState<PagesState>({ kind: "idle" });
  const pending = React.useRef<{
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const stop = React.useCallback(() => {
    if (pending.current === null) return;
    clearTimeout(pending.current.timer);
    pending.current.controller.abort();
    pending.current = null;
  }, []);
  // Nothing is left running once the editor goes.
  React.useEffect(() => stop, [stop]);

  const search = React.useCallback(
    (query: string) => {
      stop();
      if (query === "") {
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "searching" });
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void readPages(query, excludeKey, controller.signal).then(next => {
          if (!controller.signal.aborted) setState(next);
        });
      }, PAGES_DEBOUNCE_MS);
      pending.current = { controller, timer };
    },
    [stop, excludeKey]
  );

  return {
    results: {
      group: {
        name: PAGES_GROUP,
        limit: PAGES_SHOWN,
        ...(state.kind === "searching" ? { status: "Searching pages…" } : {}),
        ...(state.kind === "failed"
          ? { status: "Couldn't search pages. Try again." }
          : {}),
      },
      commands: state.kind === "found" ? pageCommands(state.items) : [],
    },
    search,
  };
}

/** One search of the pages, answered as the state it leaves. */
async function readPages(
  query: string,
  excludeKey: string,
  signal: AbortSignal
): Promise<PagesState> {
  try {
    const body = await readPluginRoute<PagesSearchResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: pagesSearchPath({
        q: query,
        limit: PAGES_SHOWN,
        ...(excludeKey === ""
          ? {}
          : { exclude: JSON.parse(excludeKey) as PageReference }),
      }),
      signal,
    });
    // An answer that is not the list the contract promises is a failure,
    // not "no pages".
    return Array.isArray(body?.items)
      ? { kind: "found", items: body.items }
      : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * The found pages as search rows.
 *
 * Each names its collection when the title alone would not tell it apart:
 * the results come from more than one collection, or a title repeats.
 */
function pageCommands(items: readonly PageItem[]): BuilderCommand[] {
  const collections = new Set(items.map(item => item.collection));
  const titles = new Map<string, number>();
  for (const item of items) {
    titles.set(item.title, (titles.get(item.title) ?? 0) + 1);
  }
  return items.map(item =>
    pageCommand(item, collections.size > 1 || (titles.get(item.title) ?? 0) > 1)
  );
}

/** A page as a search row: its title, what tells it apart, and opening it. */
function pageCommand(item: PageItem, nameCollection: boolean): BuilderCommand {
  const address = builderAddress(
    { kind: "collection", slug: item.collection, documentId: item.id },
    item.field
  );
  return {
    id: `page:${item.collection}:${item.id}`,
    label: item.title,
    group: PAGES_GROUP,
    icon: <FileText className="size-4" />,
    // Says only what tells two pages apart at a glance.
    ...detailOf(item, nameCollection),
    verb: "Open",
    run: () => {
      if ("href" in address) navigateTo(address.href);
    },
  };
}

/** "Draft", the collection's name, both, or nothing. */
function detailOf(
  item: PageItem,
  nameCollection: boolean
): { detail?: string } {
  const parts = [
    ...(nameCollection ? [item.collectionLabel] : []),
    ...(item.status === "draft" ? ["Draft"] : []),
  ];
  return parts.length === 0 ? {} : { detail: parts.join(" · ") };
}
