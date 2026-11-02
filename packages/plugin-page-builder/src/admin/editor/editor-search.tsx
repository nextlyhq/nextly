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

import { revealNode } from "@nextlyhq/builder";
import {
  EditorCommandPalette,
  type BuilderCommand,
} from "@nextlyhq/builder/shell";
import {
  navigateTo,
  readPluginRoute,
  useDocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
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
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      title="Search and commands (⌘K)"
      aria-label="Search and commands"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={onOpen}
    >
      <Search className="size-4" aria-hidden="true" />
      <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px] text-muted-foreground">
        ⌘K
      </kbd>
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
      commands: state.kind === "found" ? state.items.map(pageCommand) : [],
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

/** A page as a search row: its title, whether it is a draft, and opening it. */
function pageCommand(item: PageItem): BuilderCommand {
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
    ...(item.status === "draft" ? { detail: "Draft" } : {}),
    verb: "Open",
    run: () => {
      if ("href" in address) navigateTo(address.href);
    },
  };
}
