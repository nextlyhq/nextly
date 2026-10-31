"use client";

/**
 * The add gallery: every widget the reader may add, once each, previewed, beside the dashboard.
 *
 * A modal side sheet, because adding is a task of its own: focus starts in an empty search,
 * Escape and the close button leave, and the dashboard behind stays as it is until the reader is
 * done. It stays open after an add, so several cards can be added in one visit.
 *
 * Two steps in the one sheet. The gallery lists the reader's removed cards first, then the
 * suggested pairs, then a tile per widget, filtered by chip and searched by name, description,
 * category and collection. Choosing a widget that reads a collection opens its add step, where
 * the collection, the period and the width are chosen with the card previewed; a widget that
 * reads none is added at once.
 *
 * It has its own polite live region: a modal sheet takes everything outside it out of the
 * accessibility tree, the dashboard's region included, so the sheet says for itself how many
 * widgets a search found and which card was added.
 *
 * What is offered is the server's to decide (`GET /api/dashboard/gallery`); what a tile does
 * against the draft, and what a search keeps, is `add-panel-model`'s. This module draws it.
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
  type JSX,
  type ReactNode,
} from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { WidgetTilePreview } from "../preview/WidgetTilePreview";

import {
  addWidths,
  foundCount,
  GALLERY_CHIPS,
  galleryCount,
  galleryTiles,
  newCardSettings,
  periodOf,
  removedCards,
  searchGallery,
  startingCollection,
  suggestionsFor,
  tilesInChip,
  widthsLabel,
  type GalleryChip,
  type GalleryCollection,
  type GalleryRead,
  type GalleryTile,
  type GalleryTileView,
  type RemovedCard,
} from "./add-panel-model";
import { SettingsPreview } from "./SettingsPreview";

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
   * Add a new card of this widget, starting with `settings` and `width` when given; what was
   * added, or `null` when nothing was.
   */
  onAdd: (
    widgetId: string,
    settings?: Record<string, unknown>,
    width?: number
  ) => AddedCard | null;
  /** Put a removed card back where it was, with its settings; what came back, or `null`. */
  onAddBack: (placementId: string) => AddedCard | null;
  /** The panel has closed: move focus on, to the last card added or to Add widget. */
  onClosed: () => void;
}

/** How long typing has to pause before the count is announced. */
const COUNT_ANNOUNCE_DELAY_MS = 500;

/** The add step's state: the widget, and what the reader has chosen so far. */
interface AddStep {
  tile: GalleryTile;
  collection: string;
  period?: string;
  width: number;
}

/**
 * The count, and the one sentence the panel is saying now, for its live region. Each visit starts
 * silent: the panel stays mounted while closed, so a sentence from the last visit, or a count
 * still waiting when it closed, would otherwise be said again on opening.
 */
function usePanelVoice(found: number, query: string, open: boolean) {
  const [spoken, setSpoken] = useState("");
  // Cleared as the panel opens or closes, during render (React's pattern for state that follows
  // a prop), so no frame of a new visit draws the old sentence.
  const [visit, setVisit] = useState(open);
  if (visit !== open) {
    setVisit(open);
    setSpoken("");
  }
  const count = galleryCount(found, query);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Announced once typing pauses, so each keystroke does not interrupt the last. Never while
  // closed: closing clears a count still waiting, and none starts until the panel opens again.
  useEffect(() => {
    if (!open || query.trim() === "") return undefined;
    pending.current = setTimeout(
      () => setSpoken(`${count}.`),
      COUNT_ANNOUNCE_DELAY_MS
    );
    return () => clearTimeout(pending.current);
  }, [count, query, open]);
  // A sentence said on purpose (an add, a cleared search) cancels a count still waiting, which
  // would otherwise land on top of it.
  const say = useCallback((sentence: string) => {
    clearTimeout(pending.current);
    setSpoken(sentence);
  }, []);
  return { count, spoken, say };
}

/** A section of the gallery, under a small heading. */
function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}): JSX.Element {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2"
      data-testid={testId}
    >
      <h3
        id={headingId}
        className="font-mono text-xs uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A small button-like chip: a filter, a suggestion, a pair. */
const CHIP_CLASS =
  "inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** The filter chips: one pressed at a time, each a button of its own. */
function Chips({
  chip,
  onChip,
}: {
  chip: GalleryChip;
  onChip: (chip: GalleryChip) => void;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Filter widgets"
      className="flex flex-wrap gap-1.5"
      data-testid="add-panel-chips"
    >
      {GALLERY_CHIPS.map(each => {
        const on = each.id === chip;
        return (
          <button
            key={each.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChip(each.id)}
            className={cn(
              CHIP_CLASS,
              on &&
                "border-primary bg-primary text-primary-foreground hover:bg-primary"
            )}
          >
            {each.label}
          </button>
        );
      })}
    </div>
  );
}

/** What a tile says under its description: its widths, and how many of it are placed. */
function tileMeta(view: GalleryTileView): string {
  const parts = [widthsLabel(view.tile.size)];
  if (view.action.kind === "add-another" && view.placed > 0) {
    parts.push(`${view.placed} on your dashboard`);
  }
  return parts.join(" · ");
}

/** One widget's tile: its preview, name, description and widths, all one button. */
function Tile({
  view,
  widget,
  collection,
  atCapacity,
  onChoose,
}: {
  view: GalleryTileView;
  widget: DashboardWidget | undefined;
  /** The collection a new card starts on, which the preview is drawn with. */
  collection: string | undefined;
  atCapacity: boolean;
  onChoose: (view: GalleryTileView) => void;
}): JSX.Element {
  const { tile, action } = view;
  const onDashboard = action.kind === "on-dashboard";
  const descriptionId = useId();
  const settings =
    tile.collectionSetting !== undefined && collection !== undefined
      ? { [tile.collectionSetting]: collection }
      : undefined;
  const body = (
    <>
      <WidgetTilePreview
        widget={widget}
        {...(tile.preview === undefined ? {} : { preview: tile.preview })}
        {...(settings === undefined ? {} : { settings })}
      />
      <span className="block break-words text-sm font-medium text-foreground">
        {tile.name}
      </span>
      {tile.description ? (
        <span
          id={descriptionId}
          className="line-clamp-2 block break-words text-xs text-muted-foreground"
        >
          {tile.description}
        </span>
      ) : null}
      <span className="block text-xs text-muted-foreground">
        {onDashboard ? (
          <span
            className="inline-flex items-center gap-1"
            data-testid={`add-panel-on-dashboard-${tile.id}`}
          >
            <Icons.Check aria-hidden className="size-3.5" />
            On your dashboard
          </span>
        ) : (
          tileMeta(view)
        )}
      </span>
    </>
  );
  const frame =
    "flex h-full w-full flex-col gap-2 rounded-lg border border-border bg-card p-2.5 text-left";
  return (
    <li className="min-w-0" data-testid={`add-panel-tile-${tile.id}`}>
      {onDashboard ? (
        // Not a control: a one-card widget already on the dashboard is not added again.
        <div className={cn(frame, "opacity-80")}>{body}</div>
      ) : (
        <button
          type="button"
          disabled={atCapacity}
          aria-label={`${action.kind === "add-another" ? "Add another" : "Add"} ${tile.name}`}
          {...(tile.description ? { "aria-describedby": descriptionId } : {})}
          data-gallery-tile={tile.id}
          data-testid={`add-panel-add-${tile.id}`}
          onClick={() => onChoose(view)}
          className={cn(
            frame,
            "transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {body}
        </button>
      )}
    </li>
  );
}

/** The cards removed this session, each put back as it was. */
function RemovedList({
  cards,
  onAddBack,
}: {
  cards: readonly RemovedCard[];
  onAddBack: (card: RemovedCard) => void;
}): JSX.Element {
  return (
    <Section title={`Removed ${cards.length}`} testId="add-panel-removed">
      <ul className="space-y-2">
        {cards.map(card => (
          <li
            key={card.placementId}
            className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5"
            data-testid={`add-panel-row-removed:${card.placementId}`}
          >
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium text-foreground">
                {card.title}
              </span>
              <span className="block text-xs text-muted-foreground">
                Comes back where it was, with its size and settings.
              </span>
            </span>
            {/* Enabled at the limit: putting a removed card back adds no card. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => onAddBack(card)}
              aria-label={`Add back ${card.title}`}
              data-testid={`add-panel-add-back-removed:${card.placementId}`}
            >
              Add back
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** A labelled row of radio chips: the period, or the width. */
function RadioChips({
  legend,
  name,
  options,
  value,
  onChange,
  testId,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<{ value: string; label: string; spoken?: string }>;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}): JSX.Element {
  return (
    <fieldset className="space-y-1.5" data-testid={testId}>
      <legend className="text-xs font-medium text-muted-foreground">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(option => (
          <label key={option.value} className="relative">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              aria-label={option.spoken ?? option.label}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="inline-flex min-h-8 cursor-pointer items-center rounded-md border border-border px-2.5 font-mono text-xs text-muted-foreground peer-checked:border-foreground peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The answer a preview of a card not yet placed starts from: none, so it asks its own. */
const NOTHING_SHOWN = {
  slot: undefined,
  updatedAt: null,
  isFetching: false,
} as const;

/** The add step: the collection, the period and the width, with the card previewed. */
function AddStepView({
  step,
  widget,
  collections,
  mostEdited,
  atCapacity,
  onChange,
  onBack,
  onAdd,
}: {
  step: AddStep;
  widget: DashboardWidget | undefined;
  collections: readonly GalleryCollection[];
  mostEdited: string | undefined;
  atCapacity: boolean;
  onChange: (step: AddStep) => void;
  onBack: () => void;
  onAdd: () => void;
}): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const collectionId = useId();
  const hintId = useId();
  const period = periodOf(widget);
  const widths = addWidths(step.tile.size);
  // Into the step as it opens, so a reader hears where they are.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step.tile.id]);
  const settings = newCardSettings(step.tile, {
    ...(step.collection === "" ? {} : { collection: step.collection }),
    ...(period === undefined || step.period === undefined
      ? {}
      : { period: { name: period.name, value: step.period } }),
  });
  const chosen = step.collection !== "";
  return (
    <div className="space-y-4" data-testid="add-panel-step">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-semibold text-foreground focus-visible:outline-none"
      >
        Add “{step.tile.name}”
      </h3>
      <div className="space-y-1.5">
        <label
          htmlFor={collectionId}
          className="text-xs font-medium text-muted-foreground"
        >
          Collection
        </label>
        <select
          id={collectionId}
          value={step.collection}
          aria-describedby={hintId}
          onChange={event =>
            onChange({ ...step, collection: event.target.value })
          }
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="add-panel-collection"
        >
          <option value="">Choose a collection</option>
          {collections.map(collection => (
            <option key={collection.slug} value={collection.slug}>
              {collection.label}
            </option>
          ))}
        </select>
        <p id={hintId} className="text-xs text-muted-foreground">
          {collections.length === 0
            ? "There is no collection you can read yet."
            : step.collection !== "" && step.collection === mostEdited
              ? "The collection you edit most."
              : "Defaults to the collection you edit most."}
        </p>
      </div>
      {period !== undefined && step.period !== undefined ? (
        <RadioChips
          legend="Period"
          name={`period-${step.tile.id}`}
          options={period.options}
          value={step.period}
          onChange={value => onChange({ ...step, period: value })}
          testId="add-panel-period"
        />
      ) : null}
      {widths.length > 1 ? (
        <RadioChips
          legend="Width"
          name={`width-${step.tile.id}`}
          options={widths.map(width => ({
            value: String(width.w),
            label: width.label,
            spoken: width.spoken,
          }))}
          value={String(step.width)}
          onChange={value => onChange({ ...step, width: Number(value) })}
          testId="add-panel-width"
        />
      ) : null}
      {widget !== undefined && chosen ? (
        <SettingsPreview
          widget={widget}
          placementId={`gallery-add:${step.tile.id}`}
          stored={undefined}
          draft={settings ?? {}}
          shown={NOTHING_SHOWN}
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!chosen || atCapacity}
          onClick={onAdd}
          data-testid="add-panel-step-add"
        >
          Add to dashboard
        </Button>
      </div>
    </div>
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
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<GalleryChip>("all");
  const [step, setStep] = useState<AddStep | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The tile an add step was opened from, where Back and an add return focus.
  const openedFrom = useRef<string | null>(null);
  const countId = useId();

  const read = gallery.read;
  const tiles = useMemo(
    () => (read === undefined ? [] : galleryTiles(read, placements)),
    [read, placements]
  );
  const removed = useMemo(
    () => removedCards(placements, byId),
    [placements, byId]
  );
  const collections = useMemo(() => read?.collections ?? [], [read]);
  const found = useMemo(
    () =>
      searchGallery(
        { removed, tiles: tilesInChip(tiles, chip), collections },
        query
      ),
    [removed, tiles, chip, collections, query]
  );
  const suggestions = useMemo(
    () => (read === undefined ? [] : suggestionsFor(read, tiles, placements)),
    [read, tiles, placements]
  );
  const starting = read === undefined ? undefined : startingCollection(read);
  const voice = usePanelVoice(foundCount(found), query, open);
  const searching = query.trim() !== "";

  // A fresh gallery each time it opens: an old search, chip or step would hide what the reader
  // came to find.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setChip("all");
    setStep(null);
  }, [open]);

  /** Focus back on a tile, or on the search when the tile is gone. */
  const focusTile = (tileId: string | null) =>
    setTimeout(() => {
      const content = contentRef.current;
      const tile =
        tileId === null
          ? null
          : content?.querySelector<HTMLElement>(
              `[data-gallery-tile="${CSS.escape(tileId)}"]`
            );
      if (tile && !tile.hasAttribute("disabled")) tile.focus();
      else searchRef.current?.focus();
    }, 0);

  /*
   * After an add, focus stays on the control that was pressed while it is still drawn. When it
   * changed under it (a one-card widget is now on the dashboard), it is gone and focus goes back
   * to the search, rather than falling out of the panel. The dialog's focus trap catches a
   * removed control's focus on the sheet itself, which is inside the panel but no control, so
   * that counts as lost too.
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
        : `${verb} ${added.title}.`
    );
  };

  const openStep = (tile: GalleryTile, collection?: string) => {
    const period = periodOf(byId.get(tile.id));
    openedFrom.current = tile.id;
    setStep({
      tile,
      collection: collection ?? starting ?? "",
      ...(period === undefined ? {} : { period: period.initial }),
      width: tile.size.default.w,
    });
  };

  const choose = (view: GalleryTileView) => {
    if (view.tile.collectionSetting !== undefined) {
      openStep(view.tile);
      return;
    }
    // A widget that reads no collection has nothing to choose: added as it is.
    said(onAdd(view.tile.id), "Added");
    keepFocusInPanel();
  };

  const addPair = (tile: GalleryTile, collection: string) => {
    said(onAdd(tile.id, newCardSettings(tile, { collection })), "Added");
    keepFocusInPanel();
  };

  const addFromStep = () => {
    if (step === null || step.collection === "") return;
    const period = periodOf(byId.get(step.tile.id));
    const settings = newCardSettings(step.tile, {
      collection: step.collection,
      ...(period === undefined || step.period === undefined
        ? {}
        : { period: { name: period.name, value: step.period } }),
    });
    const added = onAdd(
      step.tile.id,
      settings,
      step.width === step.tile.size.default.w ? undefined : step.width
    );
    said(added, "Added");
    // Back to the gallery, the panel open for the next card, focus on the tile it came from.
    setStep(null);
    focusTile(openedFrom.current);
  };

  const back = () => {
    setStep(null);
    focusTile(openedFrom.current);
  };

  const clear = () => {
    setQuery("");
    voice.say(`${galleryCount(removed.length + tiles.length, "")}.`);
    searchRef.current?.focus();
  };

  const tileFor = (view: GalleryTileView) => (
    <Tile
      key={view.tile.id}
      view={view}
      widget={byId.get(view.tile.id)}
      collection={starting}
      atCapacity={atCapacity}
      onChoose={choose}
    />
  );

  const nothingFound = read !== undefined && foundCount(found) === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
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
          {step === null ? (
            <>
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
                  placeholder="Search widgets or collections"
                  aria-label="Search widgets or collections"
                  aria-describedby={countId}
                  autoComplete="off"
                  className="pl-9"
                  data-testid="add-panel-search"
                />
              </div>
              <Chips chip={chip} onChip={setChip} />
              <p
                id={countId}
                className="text-xs text-muted-foreground"
                data-testid="add-panel-count"
              >
                {read === undefined ? "" : voice.count}
              </p>
            </>
          ) : null}
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
          {step !== null ? (
            <AddStepView
              step={step}
              widget={byId.get(step.tile.id)}
              collections={collections}
              mostEdited={read?.mostEdited}
              atCapacity={atCapacity}
              onChange={setStep}
              onBack={back}
              onAdd={addFromStep}
            />
          ) : read === undefined ? (
            gallery.isError ? (
              <div
                className="space-y-2 text-sm text-muted-foreground"
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
            ) : (
              <ul
                aria-busy="true"
                aria-label="Loading widgets"
                className="grid grid-cols-2 gap-2.5"
                data-testid="add-panel-loading"
              >
                {[0, 1, 2, 3].map(index => (
                  <li
                    key={index}
                    className="h-44 animate-pulse rounded-lg border border-border bg-muted/40"
                  />
                ))}
              </ul>
            )
          ) : nothingFound && !searching ? (
            // A chip with nothing under it, before any search: nothing to match, so no Clear.
            <div
              className="space-y-2 text-sm text-muted-foreground"
              data-testid="add-panel-chip-empty"
            >
              <p className="font-medium text-foreground">
                No {GALLERY_CHIPS.find(each => each.id === chip)?.label} widgets
                to add.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setChip("all")}
              >
                Show all widgets
              </Button>
            </div>
          ) : nothingFound ? (
            <div
              className="space-y-2 text-sm text-muted-foreground"
              data-testid="add-panel-none"
            >
              <p className="font-medium text-foreground">
                No widgets match “{query.trim()}”
              </p>
              <p>Try another word, or clear the search to see every widget.</p>
              <Button type="button" variant="outline" size="sm" onClick={clear}>
                Clear
              </Button>
            </div>
          ) : (
            <>
              {found.removed.length > 0 ? (
                <RemovedList
                  cards={found.removed}
                  onAddBack={card => {
                    said(onAddBack(card.placementId), "Added back");
                    keepFocusInPanel();
                  }}
                />
              ) : null}
              {!searching && chip === "all" && suggestions.length > 0 ? (
                <Section title="Suggested for you" testId="add-panel-suggested">
                  <ul className="flex flex-wrap gap-1.5">
                    {suggestions.map(suggestion => (
                      <li
                        key={`${suggestion.widgetId}:${suggestion.collection}`}
                      >
                        <button
                          type="button"
                          className={CHIP_CLASS}
                          disabled={atCapacity}
                          onClick={() =>
                            openStep(
                              suggestion.view.tile,
                              suggestion.collection
                            )
                          }
                        >
                          {suggestion.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              {found.pairs.length > 0 ? (
                <Section title="With a collection" testId="add-panel-pairs">
                  <ul className="flex flex-wrap gap-1.5">
                    {found.pairs.map(pair => (
                      <li key={pair.key}>
                        <button
                          type="button"
                          className={CHIP_CLASS}
                          disabled={atCapacity}
                          aria-label={`Add ${pair.label}`}
                          onClick={() =>
                            addPair(pair.view.tile, pair.collection.slug)
                          }
                          data-testid={`add-panel-pair-${pair.key}`}
                        >
                          <Icons.Plus aria-hidden className="size-3.5" />
                          {pair.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              {found.tiles.length > 0 ? (
                <Section title="Widgets" testId="add-panel-tiles">
                  <ul className="grid grid-cols-2 gap-2.5">
                    {found.tiles.map(tileFor)}
                  </ul>
                </Section>
              ) : null}
            </>
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
