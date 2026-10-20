"use client";

/**
 * The add panel: the widgets a reader may add, beside the dashboard, searched and grouped.
 *
 * A modal sheet, because adding is a task of its own: focus starts in an empty search, Escape and
 * the close button leave, and the dashboard behind stays as it is until the reader is done. It
 * stays open after an add, so several cards can be added in one visit.
 *
 * It has its own polite live region. A modal sheet takes everything outside it out of the
 * accessibility tree, the dashboard's region included, so the panel speaks for itself while it is
 * open: how many widgets a search found, and where a card was added.
 *
 * Which rows there are, what each one's button does and what a search keeps is decided in
 * `add-panel-model`; this module draws it.
 *
 * @module components/features/widgets/edit/AddWidgetPanel
 */

import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import { MAX_PLACEMENTS } from "nextly/config";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import {
  addPanelCount,
  addPanelGroups,
  searchAddPanel,
  type AddPanelGroupView,
  type AddPanelRow,
} from "./add-panel-model";

/** What an add put on the dashboard, for the sentence that says so. */
export interface AddedCard {
  title: string;
  /** Its place among the cards drawn, counted from one. */
  position: number;
  /** How many cards are drawn now. */
  count: number;
}

export interface AddWidgetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly AddPanelRow[];
  /** Whether the dashboard already holds as many cards as it can, removed ones counted. */
  atCapacity: boolean;
  /** Add a new card of this widget; what was added, or `null` when nothing was. */
  onAdd: (widgetId: string) => AddedCard | null;
  /** Put a removed card back where it was; what came back, or `null`. */
  onAddBack: (placementId: string) => AddedCard | null;
  /** The panel has closed: move focus on, to the last card added or to Add widget. */
  onClosed: () => void;
}

/** How long typing has to pause before the count is announced. */
const COUNT_ANNOUNCE_DELAY_MS = 500;

/** The icon each widget's archetype is sketched with. */
const SKETCHES: Readonly<Record<string, Icons.LucideIcon>> = {
  metric: Icons.Hash,
  stats: Icons.LayoutGrid,
  list: Icons.List,
  table: Icons.Table,
  timeseries: Icons.TrendingUp,
  bars: Icons.Activity,
  text: Icons.FileText,
  actions: Icons.Zap,
  custom: Icons.Puzzle,
};

function Sketch({ kind }: { kind?: string }) {
  const Icon = SKETCHES[kind ?? ""] ?? Icons.LayoutGrid;
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}

/** A row's button, or its "on the dashboard" state. */
function RowAction({
  row,
  atCapacity,
  onAdd,
  onAddBack,
}: {
  row: AddPanelRow;
  atCapacity: boolean;
  onAdd: (widgetId: string) => void;
  onAddBack: (placementId: string) => void;
}) {
  const { action } = row;
  if (action.kind === "on-dashboard") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        data-testid={`add-panel-on-dashboard-${row.key}`}
      >
        <Icons.Check aria-hidden className="size-3.5" />
        On dashboard
      </span>
    );
  }
  if (action.kind === "add-back") {
    // Enabled at the limit: putting a removed card back adds no card.
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onAddBack(action.placementId)}
        aria-label={`Add back ${row.name}`}
        data-testid={`add-panel-add-back-${row.key}`}
      >
        Add back
      </Button>
    );
  }
  const again = action.kind === "add-another";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={atCapacity}
      onClick={() => onAdd(action.widgetId)}
      aria-label={`${again ? "Add another" : "Add"} ${row.name}`}
      data-testid={`add-panel-add-${row.key}`}
    >
      {again ? "Add another" : "Add"}
    </Button>
  );
}

/** What a row says under its name: its widths, how many are placed, and its category. */
function rowMeta(row: AddPanelRow): string | undefined {
  const parts = [
    row.widths,
    row.action.kind === "add-another" && row.placed > 0
      ? `${row.placed} on your dashboard`
      : undefined,
    row.category,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function Row(props: {
  row: AddPanelRow;
  atCapacity: boolean;
  onAdd: (widgetId: string) => void;
  onAddBack: (placementId: string) => void;
}) {
  const { row } = props;
  const meta = rowMeta(row);
  return (
    <li
      className="flex items-start gap-3 rounded-md border border-border p-3"
      data-testid={`add-panel-row-${row.key}`}
    >
      <Sketch kind={row.sketch} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-foreground">
          {row.name}
        </p>
        {row.description ? (
          <p className="break-words text-xs text-muted-foreground">
            {row.description}
          </p>
        ) : null}
        {meta ? (
          <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
        ) : null}
      </div>
      <RowAction {...props} />
    </li>
  );
}

/**
 * One plugin's (or collection's) widgets, folded under a button. Open while a search is on,
 * since a search that matched inside a folded group would otherwise find nothing visible.
 */
function Subgroup({
  name,
  rows,
  searching,
  render,
}: {
  name: string;
  rows: AddPanelRow[];
  searching: boolean;
  render: (row: AddPanelRow) => ReactNode;
}) {
  const [toggled, setToggled] = useState(false);
  const regionId = useId();
  const open = searching || toggled;
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex min-h-6 w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setToggled(current => !current)}
      >
        <span>
          {name}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {rows.length} {rows.length === 1 ? "widget" : "widgets"}
          </span>
        </span>
        <Icons.ChevronDown
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      <ul id={regionId} hidden={!open} className="space-y-2">
        {rows.map(render)}
      </ul>
    </div>
  );
}

function Group({
  group,
  searching,
  render,
}: {
  group: AddPanelGroupView;
  searching: boolean;
  render: (row: AddPanelRow) => ReactNode;
}) {
  const headingId = useId();
  const count =
    group.rows.length +
    group.subgroups.reduce((sum, sub) => sum + sub.rows.length, 0);
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {group.section.label}
        {group.section.id === "removed" ? ` ${count}` : null}
      </h3>
      {group.section.note && !searching ? (
        <p className="text-xs text-muted-foreground">{group.section.note}</p>
      ) : null}
      {group.rows.length > 0 ? (
        <ul className="space-y-2">{group.rows.map(render)}</ul>
      ) : null}
      {group.subgroups.map(sub => (
        <Subgroup
          key={sub.name}
          name={sub.name}
          rows={sub.rows}
          searching={searching}
          render={render}
        />
      ))}
    </section>
  );
}

/** The count, and the one sentence the panel is saying now, for its live region. */
function usePanelVoice(found: number, query: string) {
  const [spoken, setSpoken] = useState("");
  const count = addPanelCount(found, query);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Announced once typing pauses, so each keystroke does not interrupt the last.
  useEffect(() => {
    if (query.trim() === "") return undefined;
    pending.current = setTimeout(
      () => setSpoken(`${count}.`),
      COUNT_ANNOUNCE_DELAY_MS
    );
    return () => clearTimeout(pending.current);
  }, [count, query]);
  // A sentence said on purpose (an add, a cleared search) cancels a count still waiting, which
  // would otherwise land on top of it: after an add the query and its count often stay the
  // same, so nothing else would clear that timer first.
  const say = useCallback((sentence: string) => {
    clearTimeout(pending.current);
    setSpoken(sentence);
  }, []);
  return { count, spoken, say };
}

export function AddWidgetPanel({
  open,
  onOpenChange,
  rows,
  atCapacity,
  onAdd,
  onAddBack,
  onClosed,
}: AddWidgetPanelProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const countId = useId();

  const found = useMemo(() => searchAddPanel(rows, query), [rows, query]);
  const groups = useMemo(() => addPanelGroups(found), [found]);
  const voice = usePanelVoice(found.length, query);
  const searching = query.trim() !== "";

  // A fresh panel each time it opens: an old search would hide widgets the reader came to find.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  /*
   * After an add, focus stays on the button that was pressed while it is still drawn (an "Add
   * another"). When the row changed under it (a one-card widget is now on the dashboard), the
   * button is gone and focus goes back to the search, rather than falling out of the panel. The
   * dialog's focus trap catches a removed button's focus on the sheet itself, which is inside the
   * panel but no control, so that counts as lost too.
   */
  const keepFocusInPanel = () =>
    setTimeout(() => {
      const content = contentRef.current;
      const active = document.activeElement;
      if (active === content || !content?.contains(active)) {
        searchRef.current?.focus();
      }
    }, 0);

  const said = (added: AddedCard | null, verb: string) => {
    voice.say(
      added === null
        ? `Your dashboard holds the most cards it can (${MAX_PLACEMENTS}, counting removed ones). Nothing was added.`
        : `${verb} ${added.title} at position ${added.position} of ${added.count}.`
    );
    keepFocusInPanel();
  };

  const render = (row: AddPanelRow) => (
    <Row
      key={row.key}
      row={row}
      atCapacity={atCapacity}
      onAdd={widgetId => said(onAdd(widgetId), "Added")}
      onAddBack={placementId => said(onAddBack(placementId), "Added back")}
    />
  );

  const clear = () => {
    setQuery("");
    voice.say(`${addPanelCount(rows.length, "")}.`);
    searchRef.current?.focus();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
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
        <SheetHeader className="space-y-3 border-b border-border p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <SheetTitle>Add widget</SheetTitle>
              <SheetDescription>
                New cards go to the end of your dashboard. Move them from their
                menu.
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <Icons.X aria-hidden className="size-4" />
            </Button>
          </div>
          <div role="search" className="relative">
            <Icons.Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search widgets"
              aria-label="Search widgets"
              aria-describedby={countId}
              autoComplete="off"
              className="pl-9"
              data-testid="add-panel-search"
            />
          </div>
          <p
            id={countId}
            className="text-xs text-muted-foreground"
            data-testid="add-panel-count"
          >
            {voice.count}
          </p>
          {atCapacity ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="add-panel-at-capacity"
            >
              Your dashboard holds the most cards it can ({MAX_PLACEMENTS},
              counting removed ones), so no new card can be added. A removed
              card can still be put back.
            </p>
          ) : null}
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {found.length === 0 ? (
            <div
              className="space-y-2 text-sm text-muted-foreground"
              data-testid="add-panel-none"
            >
              <p className="font-medium text-foreground">
                No widgets match “{query.trim()}”
              </p>
              <p>Try another word, or clear the search to see every widget.</p>
              <Button type="button" variant="outline" size="sm" onClick={clear}>
                Clear search
              </Button>
            </div>
          ) : (
            groups.map(group => (
              <Group
                key={group.section.id}
                group={group}
                searching={searching}
                render={render}
              />
            ))
          )}
        </div>

        <div
          role="status"
          aria-live="polite"
          className="sr-only"
          data-testid="add-panel-live"
        >
          {voice.spoken}
        </div>
      </SheetContent>
    </Sheet>
  );
}
