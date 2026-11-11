"use client";

/**
 * The add panel: every widget the reader may add, in one list they can search, beside the
 * dashboard.
 *
 * A modal side drawer, because adding is a task of its own: focus starts in an empty search,
 * Escape and the close button leave, and the dashboard behind stays as it is until the reader is
 * done. It stays open after an add, so several cards can be added in one visit.
 *
 * Each row is a widget: its icon, its name, the plugin it comes from, its one line, and Add. A
 * one-card widget already on the dashboard says so instead, and one that reads a collection says
 * it needs one when the reader may read none it suits. Add puts the card at the end with its
 * defaults; a widget that reads a collection starts on one no card of it uses yet.
 *
 * It has its own polite live region: a modal drawer takes everything outside it out of the
 * accessibility tree, the dashboard's region included, so the drawer says for itself how many
 * widgets a search found and which card was added.
 *
 * What is offered is the server's to decide (`GET /api/dashboard/gallery`); what a row does
 * against the draft, and what a search keeps, is `add-panel-model`'s. This module draws it.
 *
 * @module components/features/widgets/edit/AddWidgetPanel
 */

import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import { MAX_PLACEMENTS } from "nextly/config";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import * as Icons from "@admin/components/icons";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { REGISTRY_ENTRIES } from "@admin/lib/plugins/registry/entries";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { resolveIconName } from "../archetypes/icon";
import { settingsAsAsked } from "../widget-as-asked";

import {
  canAdd,
  collectionAsker,
  collectionsFor,
  galleryRows,
  newCardSettings,
  pluginShownName,
  rowsCount,
  searchRows,
  startingCollection,
  type GalleryRead,
  type GalleryRow,
} from "./add-panel-model";

/** What an add put on the dashboard, for the sentence that says so. */
export interface AddedCard {
  title: string;
}

/** The gallery read, as the panel is handed it. */
export interface GalleryAnswer {
  read: GalleryRead | undefined;
  isError: boolean;
  retry: () => void;
}

export interface AddWidgetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gallery: GalleryAnswer;
  /** The draft as drawn: what is placed, and what was removed this session. */
  placements: readonly WidgetPlacement[];
  byId: ReadonlyMap<string, DashboardWidget>;
  /** Whether the dashboard already holds as many cards as it can, removed ones counted. */
  atCapacity: boolean;
  /**
   * Add a new card of this widget at the end, starting with `settings` when given; what was
   * added, or `null` when nothing was. `matchesOne` says the card starts as one the reader already
   * has (every collection it can read has its card), so its settings are opened to tell it apart.
   */
  onAdd: (
    widgetId: string,
    settings?: Record<string, unknown>,
    matchesOne?: boolean
  ) => AddedCard | null;
  /** Put a removed card back where it was, with its settings; what came back, or `null`. */
  onAddBack: (placementId: string) => AddedCard | null;
  /** The panel has closed: move focus on, to the last card added or to Add widget. */
  onClosed: () => void;
}

/**
 * One sentence the panel says, and which saying of it this is. The live region draws each saying
 * as a node of its own (keyed by `id`), so a sentence equal to the last one, "Added Note." twice,
 * still changes the region and is announced again.
 */
interface Utterance {
  text: string;
  id: number;
}

/** How long typing has to pause before the count is announced. */
const COUNT_ANNOUNCE_DELAY_MS = 500;

/**
 * The one sentence the panel is saying now, for its live region. Each visit starts silent: the
 * panel stays mounted while closed, so a sentence from the last visit, or a count still waiting
 * when it closed, would otherwise be said again on opening.
 *
 * The count is said once typing pauses, for each search the reader types, and when the read lands
 * under a search typed before it (`ready`); never for the list the panel opens on, which the
 * count line under the search already describes.
 */
function usePanelVoice(
  count: string,
  query: string,
  open: boolean,
  /** Whether the read has answered: before it, the list is loading, not empty. */
  ready: boolean
) {
  const [spoken, setSpoken] = useState<Utterance>({ text: "", id: 0 });
  // Each sentence a new saying, even one equal to the last.
  const utter = useCallback(
    (text: string) => setSpoken(last => ({ text, id: last.id + 1 })),
    []
  );
  // Cleared as the panel opens or closes, during render (React's pattern for state that follows
  // a prop), so no frame of a new visit draws the old sentence.
  const [visit, setVisit] = useState(open);
  if (visit !== open) {
    setVisit(open);
    setSpoken(last => ({ text: "", id: last.id + 1 }));
  }
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Read when the announcement fires, so a count that moves without the search moving (a card
  // added) does not schedule one of its own.
  const sayCount = useEffectEvent(() => utter(`${count}.`));
  const searched = query.trim();
  // Never while the read is on its way, which would say an empty list; once it lands under a
  // search typed before it, the count is said then.
  useEffect(() => {
    if (!open || !ready || searched === "") return undefined;
    pending.current = setTimeout(sayCount, COUNT_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(pending.current);
  }, [searched, open, ready]);
  // A sentence said on purpose (an add) cancels a count still waiting, which would otherwise land
  // on top of it.
  const say = useCallback(
    (sentence: string) => {
      clearTimeout(pending.current);
      utter(sentence);
    },
    [utter]
  );
  return { spoken, say };
}

/** The sentence an add, or an add refused at the limit, is announced with. */
function addedSentence(added: AddedCard | null, verb: string): string {
  return added === null
    ? `Your dashboard holds the most cards it can (${MAX_PLACEMENTS}, counting removed ones). Nothing was added.`
    : `${verb} ${added.title}.`;
}

/** What the plugin line beside a widget's name says: "SEO plugin". */
function pluginLine(name: string): string {
  return /\bplugin\b/i.test(name) ? name : `${name} plugin`;
}

/** The icon a row is drawn with: its widget's own, else a plugin's or a site widget's glyph. */
function RowIcon({
  row,
  widget,
}: {
  row: GalleryRow;
  widget?: DashboardWidget;
}) {
  const own = resolveIconName(widget?.icon);
  const fallback =
    row.tile.plugin === undefined ? (
      <Icons.LayoutDashboard className="h-4 w-4" />
    ) : (
      <Icons.Puzzle className="h-4 w-4" />
    );
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground [&_svg]:size-[18px]"
    >
      {own ?? fallback}
    </span>
  );
}

/** What stands at a row's end: Add, or why there is nothing to add. */
function RowEnd({
  row,
  atCapacity,
  onAdd,
}: {
  row: GalleryRow;
  atCapacity: boolean;
  onAdd: (row: GalleryRow) => void;
}): JSX.Element {
  const { tile, action } = row;
  if (action.kind === "on-dashboard") {
    return (
      <span
        className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
        data-testid={`add-panel-on-dashboard-${tile.id}`}
      >
        On dashboard
      </span>
    );
  }
  if (action.kind === "needs-collection") {
    return (
      <span
        className="max-w-28 shrink-0 text-right text-xs text-muted-foreground"
        data-testid={`add-panel-needs-collection-${tile.id}`}
      >
        Needs a collection you can read
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      // Putting a removed card back adds no card, so it stays offered at the limit.
      disabled={atCapacity && action.kind === "add"}
      aria-label={`Add ${tile.name}`}
      onClick={() => onAdd(row)}
      // What the press does, for tests that look for a removed card's way back.
      data-action={action.kind}
      data-testid={`add-panel-add-${tile.id}`}
      className="h-7 shrink-0 rounded-[7px] border-control-border bg-card px-2.5 text-[12.5px] font-medium"
    >
      Add
    </Button>
  );
}

/** One widget's row: no border, a fill on hover, and its Add at the end. */
function Row({
  row,
  widget,
  atCapacity,
  onAdd,
}: {
  row: GalleryRow;
  widget: DashboardWidget | undefined;
  atCapacity: boolean;
  onAdd: (row: GalleryRow) => void;
}): JSX.Element {
  const { tile } = row;
  return (
    <li
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent"
      data-testid={`add-panel-row-${tile.id}`}
    >
      <RowIcon row={row} widget={widget} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] leading-5 font-medium text-foreground">
          <span className="break-words">{tile.name}</span>
          {row.pluginName === undefined ? null : (
            <small className="text-[11.5px] font-normal text-muted-foreground">
              {pluginLine(row.pluginName)}
            </small>
          )}
        </p>
        {tile.description ? (
          <p className="text-[12.5px] leading-[18px] break-words text-muted-foreground">
            {tile.description}
          </p>
        ) : null}
      </div>
      <RowEnd row={row} atCapacity={atCapacity} onAdd={onAdd} />
    </li>
  );
}

/** The list before its read has answered: loading, or failed with Try again. */
function ListPending({ gallery }: { gallery: GalleryAnswer }): JSX.Element {
  if (gallery.isError) {
    return (
      <div
        className="space-y-2 pt-2 text-sm text-muted-foreground"
        data-testid="add-panel-error"
      >
        <p className="font-medium text-foreground">
          The widgets could not be loaded.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={gallery.retry}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <ul
      aria-busy="true"
      aria-label="Loading widgets"
      className="space-y-1"
      data-testid="add-panel-loading"
    >
      {[0, 1, 2, 3, 4].map(index => (
        <li key={index} className="flex items-center gap-3 px-2 py-2.5">
          <span className="size-9 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}

/** The search, and the count line under it, which describes the search to a screen reader. */
function Search({
  searchRef,
  query,
  onQuery,
  count,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  /** What the count line says; empty before the read has answered. */
  count: string;
}): JSX.Element {
  const countId = useId();
  return (
    <div className="shrink-0 px-5 pt-3.5 pb-1">
      <label
        role="search"
        className="flex h-9 items-center gap-2 rounded-lg border border-control-border bg-card px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring"
      >
        <Icons.Search aria-hidden className="size-[15px] shrink-0" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={event => onQuery(event.target.value)}
          placeholder="Search widgets"
          aria-label="Search widgets"
          aria-describedby={countId}
          autoComplete="off"
          // The browser's own clear button is hidden: it draws in a colour of its own.
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
          data-testid="add-panel-search"
        />
      </label>
      <p
        id={countId}
        className="mt-2 text-xs text-muted-foreground"
        data-testid="add-panel-count"
      >
        {count}
      </p>
    </div>
  );
}

/** The drawer's header: its title, the line under it, and Close. */
function PanelHeader(): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border py-3 pr-3 pl-5">
      <SheetHeader className="min-w-0 flex-1 space-y-0.5 text-left">
        <SheetTitle className="text-[15px] leading-5 font-semibold">
          Add widget
        </SheetTitle>
        <SheetDescription className="text-[12.5px]">
          New widgets go to the end. Drag them where you want.
        </SheetDescription>
      </SheetHeader>
      <SheetClose asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <Icons.X aria-hidden className="size-[18px]" />
        </Button>
      </SheetClose>
    </div>
  );
}

/**
 * The drawer the panel is drawn in: focus starts in the search as it opens, and where it goes as
 * it closes is the dashboard's to say (`onClosed`). Its own polite live region says what the
 * panel is saying (`spoken`), since a modal drawer takes the dashboard's region out of reach.
 */
function PanelSheet({
  open,
  onOpenChange,
  contentRef,
  searchRef,
  onClosed,
  spoken,
  children,
}: Pick<AddWidgetPanelProps, "open" | "onOpenChange" | "onClosed"> & {
  contentRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  spoken: Utterance;
  children: ReactNode;
}): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="right"
        // 440 pixels from the small breakpoint up, the whole width below it, on the card colour.
        // No padding of its own: the header, the search and the list each pad themselves, so the
        // rule under the header runs edge to edge.
        className="flex w-full flex-col gap-0 overflow-hidden bg-card p-0 sm:w-[440px] sm:max-w-[440px]"
        data-testid="add-widget-panel"
        onOpenAutoFocus={event => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        onCloseAutoFocus={event => {
          // Where focus goes is the dashboard's to say: the last card added, or Add widget.
          event.preventDefault();
          onClosed();
        }}
      >
        {children}
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
          data-testid="add-panel-live"
        >
          <span key={spoken.id}>{spoken.text}</span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * After an add, focus stays on the Add that was pressed while it is still drawn. When the row
 * changed under it (a one-card widget is now on the dashboard) it is gone, and focus goes back to
 * the search rather than falling out of the panel. The dialog's focus trap catches a removed
 * control's focus on the drawer itself, which is inside the panel but no control, so that counts
 * as lost too. A tick later, so the render that changed the row has landed.
 */
function keepFocusInPanel(
  contentRef: RefObject<HTMLDivElement | null>,
  searchRef: RefObject<HTMLInputElement | null>
): void {
  setTimeout(() => {
    const content = contentRef.current;
    const active = document.activeElement;
    if (active === content || !content?.contains(active)) {
      searchRef.current?.focus();
    }
  }, 0);
}

/**
 * The rows, worked out from the read and the draft (`add-panel-model`), what the search keeps of
 * them, and the collection each widget may be set to.
 */
function usePanelRows(
  read: GalleryRead | undefined,
  placements: readonly WidgetPlacement[],
  byId: ReadonlyMap<string, DashboardWidget>,
  query: string
) {
  // Which collections each widget can be set to, by the rule its card is drawn by.
  const branding = useBranding();
  const sources = branding.widgetSources;
  const plugins = branding.plugins;
  const canAsk = useMemo(() => collectionAsker(byId, sources), [byId, sources]);
  const rows = useMemo(() => {
    if (read === undefined) return [];
    const named = (plugin: string) =>
      pluginShownName(
        plugin,
        plugins?.find(each => each.name === plugin),
        REGISTRY_ENTRIES
      );
    return galleryRows(read, placements, byId, canAsk, named);
  }, [read, placements, byId, canAsk, plugins]);
  const found = useMemo(() => searchRows(rows, query), [rows, query]);
  const collectionsOf = (widgetId: string) =>
    collectionsFor(widgetId, read?.collections ?? [], canAsk);
  // The collection a card reads, as it is asked: its declared default where it stores none.
  const collectionOf = (placement: WidgetPlacement, setting: string) => {
    const widget = byId.get(placement.widgetId);
    return widget === undefined
      ? placement.config?.[setting]
      : settingsAsAsked(widget, placement.config, sources)[setting];
  };
  return { found, collectionsOf, collectionOf };
}

/**
 * What a row's Add does: a one-card widget removed this session comes back as it was; any other
 * is added at the end, a widget that reads a collection starting on the first it may be set to
 * that no card of it uses yet (`startingCollection`).
 */
function useRowAdd({
  placements,
  onAdd,
  onAddBack,
  collectionsOf,
  collectionOf,
  say,
  keepFocus,
}: Pick<AddWidgetPanelProps, "placements" | "onAdd" | "onAddBack"> & {
  collectionsOf: (widgetId: string) => ReturnType<typeof collectionsFor>;
  collectionOf: (placement: WidgetPlacement, setting: string) => unknown;
  say: (sentence: string) => void;
  keepFocus: () => void;
}) {
  return (row: GalleryRow) => {
    if (!canAdd(row)) return;
    if (row.action.kind === "add-back") {
      say(addedSentence(onAddBack(row.action.placementId), "Added"));
      keepFocus();
      return;
    }
    const { tile } = row;
    const start = startingCollection(
      tile,
      collectionsOf(tile.id),
      placements,
      collectionOf
    );
    const settings = newCardSettings(tile, start?.slug);
    say(
      addedSentence(onAdd(tile.id, settings, start?.taken === true), "Added")
    );
    keepFocus();
  };
}

/**
 * The search's text, empty each time the panel opens: an old search would hide what the reader
 * came to find. Reset during the render that opens it (React's pattern for state that follows a
 * prop), so the drawer's first frame already draws the search its focus goes to.
 */
function useFreshSearch(open: boolean) {
  const [query, setQuery] = useState("");
  const [visit, setVisit] = useState(open);
  if (visit !== open) {
    setVisit(open);
    if (open) setQuery("");
  }
  return [query, setQuery] as const;
}

/** Said under the search while the dashboard holds as many cards as it can. */
function CapacityNote({ atCapacity }: { atCapacity: boolean }) {
  if (!atCapacity) return null;
  return (
    <p
      className="shrink-0 px-5 pt-1 text-xs text-muted-foreground"
      data-testid="add-panel-at-capacity"
    >
      Your dashboard holds the most cards it can ({MAX_PLACEMENTS}, counting
      removed ones), so no new card can be added.
    </p>
  );
}

/** The list: waiting for the read, nothing the search matched, or a row each (`children`). */
function ListBody({
  gallery,
  found,
  children,
}: {
  gallery: GalleryAnswer;
  found: readonly GalleryRow[];
  children: (row: GalleryRow) => JSX.Element;
}): JSX.Element {
  if (gallery.read === undefined) return <ListPending gallery={gallery} />;
  if (found.length === 0) {
    return (
      <p
        className="pt-1.5 text-[13px] text-muted-foreground"
        data-testid="add-panel-none"
      >
        No widget matches. Try another word.
      </p>
    );
  }
  return (
    <ul aria-label="Widgets" data-testid="add-panel-list">
      {found.map(children)}
    </ul>
  );
}

export function AddWidgetPanel({
  open,
  onOpenChange,
  gallery,
  placements,
  byId,
  atCapacity,
  onAdd,
  onAddBack,
  onClosed,
}: AddWidgetPanelProps): JSX.Element {
  const [query, setQuery] = useFreshSearch(open);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const read = gallery.read;
  const { found, collectionsOf, collectionOf } = usePanelRows(
    read,
    placements,
    byId,
    query
  );
  const count = rowsCount(found.length);
  const voice = usePanelVoice(count, query, open, read !== undefined);
  const add = useRowAdd({
    placements,
    onAdd,
    onAddBack,
    collectionsOf,
    collectionOf,
    say: voice.say,
    keepFocus: () => keepFocusInPanel(contentRef, searchRef),
  });

  return (
    <PanelSheet
      open={open}
      onOpenChange={onOpenChange}
      contentRef={contentRef}
      searchRef={searchRef}
      onClosed={onClosed}
      spoken={voice.spoken}
    >
      <PanelHeader />
      <Search
        searchRef={searchRef}
        query={query}
        onQuery={setQuery}
        count={read === undefined ? "" : count}
      />
      <CapacityNote atCapacity={atCapacity} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1.5 pb-5">
        <ListBody gallery={gallery} found={found}>
          {row => (
            <Row
              key={row.tile.id}
              row={row}
              widget={byId.get(row.tile.id)}
              atCapacity={atCapacity}
              onAdd={add}
            />
          )}
        </ListBody>
      </div>
    </PanelSheet>
  );
}
