"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  CircleHelp,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

import { Button } from "./button";
import {
  IconGlyph,
  iconDisplayName,
  type IconSource,
  type IconSourceIcon,
} from "./icon-glyph";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** Icons per row of the results grid. */
const COLUMNS = 8;
/** One row of the grid: a 38px cell and the 2px gap below it. */
const ROW_HEIGHT = 40;
/** Rows a Page Up or Page Down moves the highlight by. */
const PAGE_ROWS = 5;

/*
 * One load per loader, shared by every field and picker handed the same
 * function: a form with three icon fields loads the set once, and a field and
 * the picker it opens never load it twice. A failed load is forgotten, so the
 * next attempt tries again rather than replaying the failure.
 */
const loads = new WeakMap<() => Promise<IconSource>, Promise<IconSource>>();
/*
 * The sources already loaded, so a picker opening over a loaded set draws its
 * first frame from it instead of a frame of "Loading icons".
 */
const loaded = new WeakMap<() => Promise<IconSource>, IconSource>();

function loadOnce(load: () => Promise<IconSource>): Promise<IconSource> {
  const existing = loads.get(load);
  if (existing !== undefined) return existing;
  const loading = load();
  loads.set(load, loading);
  loading.then(
    source => loaded.set(load, source),
    () => {
      if (loads.get(load) === loading) loads.delete(load);
    }
  );
  return loading;
}

type SourceState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly source: IconSource }
  | { readonly status: "failed" };

/**
 * The icon source, loaded once `wanted` turns true, and a way to try again
 * after a failed load.
 */
function useIconSource(
  load: () => Promise<IconSource>,
  wanted: boolean
): [SourceState, () => void] {
  const [state, setState] = React.useState<SourceState>(() => {
    const source = loaded.get(load);
    return source === undefined
      ? { status: "loading" }
      : { status: "ready", source };
  });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!wanted) return;
    let current = true;
    setState(previous =>
      previous.status === "ready" ? previous : { status: "loading" }
    );
    loadOnce(load).then(
      source => {
        if (current) setState({ status: "ready", source });
      },
      () => {
        if (current) setState({ status: "failed" });
      }
    );
    return () => {
      current = false;
    };
  }, [load, wanted, attempt]);
  return [state, () => setAttempt(n => n + 1)];
}

/**
 * What a stored id draws as. `missing` is the source's answer that it draws no
 * such icon; `failed` is no answer at all, the set or its data not arriving,
 * which says nothing about the icon and is tried again.
 */
type Resolved =
  | { readonly status: "none" }
  | { readonly status: "loading" }
  | { readonly status: "found"; readonly icon: IconSourceIcon }
  | { readonly status: "missing" }
  | { readonly status: "failed" };

/**
 * What a stored id draws as, once the source can say, and a way to ask again
 * after the asking failed.
 */
function useResolvedIcon(
  source: SourceState,
  id: string | null | undefined
): [Resolved, () => void] {
  const [resolved, setResolved] = React.useState<{
    readonly id: string;
    readonly attempt: number;
    readonly answer: Resolved;
  } | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const ready = source.status === "ready" ? source.source : null;
  React.useEffect(() => {
    if (ready === null || !id) return;
    let current = true;
    ready.resolve(id).then(
      icon => {
        if (!current) return;
        setResolved({
          id,
          attempt,
          answer:
            icon === null ? { status: "missing" } : { status: "found", icon },
        });
      },
      () => {
        if (current) setResolved({ id, attempt, answer: { status: "failed" } });
      }
    );
    return () => {
      current = false;
    };
  }, [ready, id, attempt]);
  const retry = (): void => setAttempt(n => n + 1);
  if (!id) return [{ status: "none" }, retry];
  // An answer for an earlier value is not this value's answer, and a failure
  // from an earlier attempt is not this attempt's.
  if (
    resolved?.id === id &&
    (resolved.answer.status !== "failed" || resolved.attempt === attempt)
  ) {
    return [resolved.answer, retry];
  }
  return [
    source.status === "failed" ? { status: "failed" } : { status: "loading" },
    retry,
  ];
}

/** The set and name an id carries, read without the set: `lucide:star`. */
function partsOf(id: string): { set: string; name: string } {
  const colon = id.indexOf(":");
  return colon === -1
    ? { set: "", name: id }
    : { set: id.slice(0, colon), name: id.slice(colon + 1) };
}

/** The arrow and page keys the grid answers, and how far each moves. */
const STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
  ArrowDown: COLUMNS,
  PageUp: -COLUMNS * PAGE_ROWS,
  PageDown: COLUMNS * PAGE_ROWS,
};

/**
 * Where a key moves the highlight from `active` among `count` icons, or
 * `undefined` for a key the grid does not answer. Up from the top row stays
 * put rather than jumping to the first icon.
 */
function stepFrom(
  key: string,
  active: number,
  count: number
): number | undefined {
  const step = STEPS[key];
  if (step === undefined || count === 0) return undefined;
  if (step === -COLUMNS && active < COLUMNS) return active;
  return Math.min(count - 1, Math.max(0, active + step));
}

/** What the picker's status line says, for the results in hand. */
function announcementFor(
  results: readonly IconSourceIcon[] | null,
  failed: boolean,
  query: string
): string {
  if (results === null) {
    return failed ? "The icons could not be loaded." : "Loading icons.";
  }
  if (results.length === 0) return `No icons match “${query}”.`;
  const icons = `${results.length} ${results.length === 1 ? "icon" : "icons"}`;
  return query === "" ? `${icons}.` : `${icons} match “${query}”.`;
}

/** A search's answer, with the query and the attempt it answers. */
type SearchAnswer =
  | {
      readonly status: "found";
      readonly results: readonly IconSourceIcon[];
      readonly query: string;
      readonly attempt: number;
    }
  | {
      readonly status: "failed";
      readonly query: string;
      readonly attempt: number;
    };

/** Where the highlight starts for an answer, for the grid to scroll to. */
interface SearchStart {
  readonly index: number;
  /** The chosen icon, centred in view rather than at the top. */
  readonly centred: boolean;
}

interface IconSearch {
  /** The latest answer's icons, or `null` before one arrives or when it failed. */
  readonly results: readonly IconSourceIcon[] | null;
  /** The query the results in hand answer, which may trail the one typed. */
  readonly answered: string;
  /** The latest search failed, and has not been tried again. */
  readonly failed: boolean;
  /**
   * The query typed has not been answered yet, so the results in hand are an
   * earlier query's: shown, but not what Enter may choose from.
   */
  readonly pending: boolean;
  readonly active: number;
  readonly setActive: (index: number) => void;
  readonly start: SearchStart | null;
  /** Runs the search again, after it failed. */
  readonly retry: () => void;
}

/**
 * The results for a query, and the highlighted one among them.
 *
 * The latest search wins: results arrive asynchronously, so a slow answer to
 * "tr" must not replace the answer to "truck" that came back first, and
 * until the query typed is answered the search is `pending`. Browsing (an
 * empty query) highlights the chosen icon, once `currentSettled` says which
 * icon `currentId` is; a search highlights its best match.
 */
function useIconSearch(
  source: IconSource | null,
  query: string,
  currentId: string | null | undefined,
  currentSettled: boolean
): IconSearch {
  const [answer, setAnswer] = React.useState<SearchAnswer | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [start, setStart] = React.useState<SearchStart | null>(null);
  /* The answer the highlight was last placed for, so each is placed once. */
  const placed = React.useRef<SearchAnswer | null>(null);
  /*
   * Read when an answer lands rather than watched: the chosen icon positions
   * the highlight for the search in hand, and choosing one is no reason to
   * search again.
   */
  const place = React.useEffectEvent((found: SearchAnswer): void => {
    if (found.status !== "found" || !currentSettled) return;
    placed.current = found;
    const chosen =
      found.query.trim() === "" && currentId
        ? found.results.findIndex(icon => icon.id === currentId)
        : -1;
    const index = Math.max(0, chosen);
    setActive(index);
    setStart({ index, centred: chosen > 0 });
  });
  const land = React.useEffectEvent((found: SearchAnswer): void => {
    setAnswer(found);
    place(found);
  });
  /*
   * An answer that landed before the chosen icon resolved is placed once it
   * has: a renamed icon is found in the grid by the id it resolves to.
   */
  React.useEffect(() => {
    if (answer !== null && placed.current !== answer) place(answer);
  }, [answer, currentSettled]);
  const latest = React.useRef(0);
  React.useEffect(() => {
    if (source === null) return;
    const search = ++latest.current;
    source.search(query).then(
      results => {
        if (search === latest.current) {
          land({ status: "found", results, query, attempt });
        }
      },
      () => {
        if (search === latest.current) {
          land({ status: "failed", query, attempt });
        }
      }
    );
  }, [source, query, attempt]);
  const pending =
    source !== null &&
    (answer === null || answer.query !== query || answer.attempt !== attempt);
  return {
    results: answer?.status === "found" ? answer.results : null,
    answered: answer?.query.trim() ?? "",
    failed: answer?.status === "failed",
    pending,
    active,
    setActive,
    start,
    retry: () => setAttempt(n => n + 1),
  };
}

/**
 * How results awaiting a newer answer are drawn: kept, and dimmed.
 *
 * Kept rather than cleared because most answers land within a frame or two,
 * and a grid emptied on every keystroke would flash its loading line while
 * the person types. Dimmed only after a short delay for the same reason, so
 * a quick answer never visibly dims; a slow one fades the stale icons back
 * to say they are not what Enter chooses. Brightening again has no delay.
 */
function pendingFade(pending: boolean): string {
  return cn("transition-opacity", pending && "opacity-50 delay-150");
}

/** What stands in the grid while there is nothing to choose from. */
function PickerMessage({
  results,
  failed,
  query,
  onRetry,
}: {
  results: readonly IconSourceIcon[] | null;
  failed: boolean;
  query: string;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (results !== null && results.length > 0) return null;
  if (results === null && failed) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
        <TriangleAlert className="size-5" aria-hidden="true" />
        <p>The icons could not be loaded.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <p className="py-8 text-center text-muted-foreground">
      {results === null ? "Loading icons…" : `No icons match “${query}”.`}
    </p>
  );
}

/** One icon in the grid: an option of the listbox. */
function IconOption({
  icon,
  id,
  index,
  count,
  isActive,
  isCurrent,
  onHighlight,
  onChoose,
}: {
  icon: IconSourceIcon;
  id: string;
  index: number;
  count: number;
  isActive: boolean;
  isCurrent: boolean;
  onHighlight: (index: number) => void;
  onChoose: (icon: IconSourceIcon) => void;
}): React.JSX.Element {
  return (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      aria-setsize={count}
      aria-posinset={index + 1}
      aria-label={`${iconDisplayName(icon.name)}${isCurrent ? ", current" : ""}`}
      data-current={isCurrent || undefined}
      // Keeps focus in the search box, so typing carries on.
      onMouseDown={event => event.preventDefault()}
      onMouseMove={() => {
        if (!isActive) onHighlight(index);
      }}
      onClick={() => onChoose(icon)}
      className={cn(
        "flex h-[38px] cursor-pointer items-center justify-center rounded-md",
        isCurrent &&
          !isActive &&
          "bg-muted ring-[1.5px] ring-inset ring-primary",
        isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      )}
    >
      <IconGlyph icon={icon} className="size-5" />
    </div>
  );
}

/** The highlighted icon, large, with its name and the words it is found by. */
function HighlightedIcon({
  icon,
  className,
}: {
  icon: IconSourceIcon | undefined;
  className?: string;
}): React.JSX.Element {
  const words = (icon?.tags ?? []).slice(0, 3).join(", ");
  return (
    <div
      className={cn(
        "flex min-h-[57px] items-center gap-2.5 border-t border-border px-3 py-2",
        className
      )}
    >
      {icon === undefined ? null : (
        <>
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
            <IconGlyph icon={icon} className="size-[22px]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">
              {iconDisplayName(icon.name)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {words === "" ? icon.name : `${icon.name} · ${words}`}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Props for IconPicker.
 *
 * @experimental
 */
export interface IconPickerProps {
  /**
   * Loads the icon source. Called once per function and shared by every
   * picker and field given the same one, so pass a stable function rather
   * than one created on each render.
   */
  loadIcons: () => Promise<IconSource>;
  /**
   * The id currently chosen, marked in the grid and scrolled to on open. An
   * id the set has since renamed is marked as the icon it resolves to.
   */
  value?: string | null;
  /** An icon was chosen, by click or by Enter. */
  onChoose: (icon: IconSourceIcon) => void;
  className?: string;
}

/**
 * A search-first icon picker: a search box over a grid of the matching icons,
 * and the highlighted icon's name and tags beneath.
 *
 * The search box keeps focus throughout, as a combobox. The arrow keys move a
 * highlight through the grid (left and right by one icon, up and down by a
 * row), Page Up and Page Down by several rows, and Enter chooses the
 * highlighted icon; the first match is highlighted as soon as results arrive,
 * so typing and pressing Enter chooses the best match. The grid is a listbox
 * that renders only the rows in view, which is what keeps a set of nearly two
 * thousand icons quick to open. How many icons match is announced politely.
 *
 * @experimental
 */
export function IconPicker({
  loadIcons,
  value,
  onChoose,
  className,
}: IconPickerProps): React.JSX.Element {
  const base = React.useId();
  const listId = `${base}-icons`;
  const optionId = (index: number): string => `${base}-icon-${index}`;
  const [sourceState, retryLoad] = useIconSource(loadIcons, true);
  const source = sourceState.status === "ready" ? sourceState.source : null;
  const [query, setQuery] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  /*
   * The chosen icon as the set knows it now. A stored id may name the icon by
   * a former name, and the grid lists it by its current id, so the grid is
   * compared with the id the stored one resolves to.
   */
  const [current] = useResolvedIcon(sourceState, value);
  const currentId = current.status === "found" ? current.icon.id : value;
  const {
    results,
    answered,
    failed: searchFailed,
    pending,
    active,
    setActive,
    start,
    retry: retrySearch,
  } = useIconSearch(source, query, currentId, current.status !== "loading");
  const count = results?.length ?? 0;
  /*
   * No option is active while the query typed is unanswered: the results in
   * hand are an earlier query's, and Enter chooses the best match for what
   * was typed, never one from the set before it. Their highlight stays
   * drawn, dimmed with them, so the grid does not flicker while typing.
   */
  const highlighted = pending ? undefined : results?.[active];
  const trimmed = query.trim();
  const failed = sourceState.status === "failed" || (searchFailed && !pending);
  const retry = (): void => {
    if (sourceState.status === "failed") retryLoad();
    else retrySearch();
    // The button goes once the icons arrive; typing carries on in the box.
    inputRef.current?.focus();
  };

  const virtualizer = useVirtualizer({
    count: Math.ceil(count / COLUMNS),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });
  /*
   * Scrolls once an answer's results are drawn, from an effect: scrolling as
   * they arrive would measure the grid of the previous results.
   */
  React.useEffect(() => {
    if (start === null) return;
    virtualizer.scrollToIndex(Math.floor(start.index / COLUMNS), {
      align: start.centred ? "center" : "start",
    });
  }, [start, virtualizer]);

  /*
   * A click chooses only from answered results, as Enter does: while the query
   * typed is unanswered the icons drawn are an earlier query's, dimmed.
   */
  const chooseAnswered = (icon: IconSourceIcon): void => {
    if (!pending) onChoose(icon);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (pending) {
      // Enter must not submit a surrounding form while the answer is due.
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    const next = stepFrom(event.key, active, count);
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
      virtualizer.scrollToIndex(Math.floor(next / COLUMNS), { align: "auto" });
      return;
    }
    if (event.key === "Enter" && highlighted !== undefined) {
      event.preventDefault();
      onChoose(highlighted);
    }
  };

  return (
    <div
      className={cn(
        // Never taller than the room Radix measures on the side it opens: a
        // field low on the screen opens upwards, and a panel of its full height
        // there would run past the window's top edge, search box first.
        "flex h-[min(452px,70vh,var(--radix-popover-content-available-height,452px))] flex-col text-sm text-foreground",
        className
      )}
    >
      <div className="m-2.5 flex items-center gap-1.5 rounded-md border-[1.5px] border-input px-2 py-1.5 focus-within:border-primary">
        <Search
          className="size-[15px] shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search icons"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlighted === undefined ? undefined : optionId(active)
          }
          autoComplete="off"
          spellCheck={false}
          placeholder="Search icons"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {trimmed === "" ? "All icons" : `Matches for “${trimmed}”`}
      </p>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2.5">
        <PickerMessage
          results={results}
          failed={failed}
          query={answered}
          onRetry={retry}
        />
        <div
          id={listId}
          role="listbox"
          aria-label="Icons"
          aria-busy={pending || undefined}
          className={cn("relative w-full", pendingFade(pending))}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map(row => (
            <div
              key={row.key}
              role="presentation"
              className="absolute inset-x-0 top-0 grid grid-cols-8 gap-0.5"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {(results ?? [])
                .slice(row.index * COLUMNS, row.index * COLUMNS + COLUMNS)
                .map((icon, column) => {
                  const index = row.index * COLUMNS + column;
                  return (
                    <IconOption
                      key={icon.id}
                      icon={icon}
                      id={optionId(index)}
                      index={index}
                      count={count}
                      isActive={index === active}
                      isCurrent={icon.id === currentId}
                      onHighlight={setActive}
                      onChoose={chooseAnswered}
                    />
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {/* Still the earlier answer's highlight while pending, dimmed with it. */}
      <HighlightedIcon
        icon={results?.[active]}
        className={pendingFade(pending)}
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcementFor(results, failed, answered)}
      </p>
    </div>
  );
}

/** How the field shows a value: its name, its set, and what it is called. */
interface ValueText {
  /** The name on the button. */
  readonly name: string;
  /** The set's name under it, with "not found" for a missing icon. */
  readonly set: string;
  /** The button's accessible name: the label, then the icon. */
  readonly spoken: string;
}

/** The text the field shows and speaks for a value, however it resolved. */
function valueTextFor(
  value: string | null | undefined,
  resolved: Resolved,
  source: IconSource | null,
  label: string
): ValueText {
  if (!value) {
    return { name: "Choose an icon", set: "", spoken: `${label}: none chosen` };
  }
  const parts = partsOf(value);
  const setName =
    source !== null && parts.set === source.prefix
      ? source.label
      : iconDisplayName(parts.set);
  if (resolved.status === "missing") {
    return {
      name: parts.name,
      set: setName === "" ? "Not found" : `${setName} · not found`,
      spoken: `${label}: ${parts.name}, not found`,
    };
  }
  if (resolved.status === "failed") {
    const name = iconDisplayName(parts.name);
    return {
      name,
      set: setName === "" ? "Could not load" : `${setName} · could not load`,
      spoken: `${label}: ${name}, could not be loaded`,
    };
  }
  const name = iconDisplayName(
    resolved.status === "found" ? resolved.icon.name : parts.name
  );
  return { name, set: setName, spoken: `${label}: ${name}` };
}

/** The tile the chosen icon is drawn in, or what stands in for it. */
function IconSwatch({ resolved }: { resolved: Resolved }): React.JSX.Element {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[5px]",
        resolved.status === "found"
          ? "bg-muted"
          : "border border-dashed border-muted-foreground",
        resolved.status === "loading" &&
          "animate-pulse bg-muted motion-reduce:animate-none"
      )}
    >
      {resolved.status === "found" ? (
        <IconGlyph icon={resolved.icon} className="size-[18px]" />
      ) : resolved.status === "missing" ? (
        <CircleHelp
          className="size-[18px] text-muted-foreground"
          aria-hidden="true"
        />
      ) : resolved.status === "failed" ? (
        <TriangleAlert
          className="size-[18px] text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

/** What the field's button shows: the swatch, the name, the set, a chevron. */
function IconFieldFace({
  resolved,
  text,
  empty,
}: {
  resolved: Resolved;
  text: ValueText;
  empty: boolean;
}): React.JSX.Element {
  return (
    <>
      <IconSwatch resolved={resolved} />
      <span className="min-w-0 flex-1 leading-tight">
        <span
          className={cn(
            "block text-sm font-medium [overflow-wrap:anywhere]",
            empty && "font-normal text-muted-foreground"
          )}
        >
          {text.name}
        </span>
        {text.set === "" ? null : (
          <span className="text-[11px] text-muted-foreground">{text.set}</span>
        )}
      </span>
      <ChevronDown
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  );
}

/** The warning under a field whose icon the set no longer draws. */
function MissingIconWarning({ id }: { id: string }): React.JSX.Element {
  return (
    <p
      id={id}
      className="mt-1.5 flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 px-2.5 py-1.5 text-xs text-warning-900 dark:border-warning-900 dark:bg-warning-950 dark:text-warning-100"
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>This icon is no longer available. Choose another.</span>
    </p>
  );
}

/**
 * The button that opens the picker. Every prop it is not given by name goes
 * to the `<button>`, so a popover trigger can hand it its ref, state and
 * handlers.
 */
function IconFieldButton({
  resolved,
  text,
  empty,
  interactive,
  invalid,
  readOnly,
  ...button
}: React.ComponentProps<"button"> & {
  resolved: Resolved;
  text: ValueText;
  empty: boolean;
  interactive: boolean;
  invalid: boolean;
  readOnly: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...button}
      aria-label={text.spoken}
      aria-invalid={invalid || undefined}
      aria-disabled={readOnly || undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-[5px] text-left",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        interactive ? "cursor-pointer hover:bg-muted" : "cursor-default"
      )}
    >
      <IconFieldFace resolved={resolved} text={text} empty={empty} />
    </button>
  );
}

/** The bordered row the field's two buttons sit in. */
function IconFieldFrame({
  invalid,
  disabled,
  children,
}: {
  invalid: boolean;
  disabled: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex w-full items-center rounded-md border border-input bg-background",
        invalid && "border-destructive",
        disabled && "opacity-50"
      )}
    >
      {children}
    </div>
  );
}

/** A button that clears the field. */
function ClearIconButton({
  onClear,
}: {
  onClear: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="Clear icon"
      onClick={onClear}
      className="mr-1 grid place-items-center rounded p-[3px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="size-[15px]" aria-hidden="true" />
    </button>
  );
}

/**
 * What a field's value draws as and is called, loading the set when there is
 * an icon to draw or a picker to fill. Opening the picker asks again for
 * whichever failed to arrive, the set or the value's icon.
 */
function useIconFieldValue(
  loadIcons: () => Promise<IconSource>,
  value: string | null | undefined,
  label: string,
  open: boolean
): { resolved: Resolved; text: ValueText } {
  const [sourceState, retryLoad] = useIconSource(
    loadIcons,
    Boolean(value) || open
  );
  const [resolved, retryResolve] = useResolvedIcon(sourceState, value);
  const source = sourceState.status === "ready" ? sourceState.source : null;
  // A new source resolves the value afresh by itself, so a failed load is
  // retried and a failed resolve only once the set is in hand. Read when the
  // picker opens rather than watched: a failure is no reason to retry at once.
  const retryFailed = React.useEffectEvent((): void => {
    if (sourceState.status === "failed") retryLoad();
    else if (resolved.status === "failed") retryResolve();
  });
  React.useEffect(() => {
    if (open) retryFailed();
  }, [open]);
  return { resolved, text: valueTextFor(value, resolved, source, label) };
}

/**
 * A button the field keeps a handle on and hands to the caller's ref too: the
 * field takes focus back to it after a clear, and a form focuses it from
 * outside. One callback ref gives the node to both.
 */
function useSharedButtonRef(
  ref: React.Ref<HTMLButtonElement> | undefined
): [
  React.RefObject<HTMLButtonElement | null>,
  (node: HTMLButtonElement | null) => void,
] {
  const own = React.useRef<HTMLButtonElement | null>(null);
  const share = React.useCallback(
    (node: HTMLButtonElement | null): void => {
      own.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );
  return [own, share];
}

/** Joins the ids describing an element, or `undefined` when there are none. */
function describedByIds(
  ...ids: readonly (string | undefined)[]
): string | undefined {
  const joined = ids.filter(id => id !== undefined && id !== "").join(" ");
  return joined === "" ? undefined : joined;
}

/**
 * Props for IconField.
 *
 * @experimental
 */
export interface IconFieldProps {
  /** The stored icon id, `lucide:star`, or nothing. */
  value: string | null | undefined;
  /** An icon was chosen (its id), or the field was cleared (`null`). */
  onChange: (id: string | null) => void;
  /** Loads the icon source; see {@link IconPickerProps.loadIcons}. */
  loadIcons: () => Promise<IconSource>;
  /**
   * The field's label as a person reads it. It opens the button's accessible
   * name, which goes on to say the chosen icon: `Icon: Truck`.
   */
  label?: string;
  /** The id of the button that opens the picker, for a `<label for>`. */
  id?: string;
  disabled?: boolean;
  /** Shows the value and its warning, but offers neither picker nor clear. */
  readOnly?: boolean;
  /** Marks the button invalid, for a form that rejected the value. */
  invalid?: boolean;
  /** Describes the button, for a hint or an error beside the field. */
  "aria-describedby"?: string;
  /**
   * The field was left: focus moved from its buttons to somewhere outside
   * them, the picker closed, or the value was cleared.
   */
  onBlur?: () => void;
  /**
   * The button that opens the picker, for a form that focuses a field it
   * rejected or is asked to focus.
   */
  ref?: React.Ref<HTMLButtonElement>;
  className?: string;
}

/**
 * A field holding one icon: a button showing the chosen icon, its name and
 * its set, which opens an {@link IconPicker}, and a button that clears it.
 *
 * An id the source no longer draws is shown by its name with a warning, and
 * kept until someone chooses another: the field never rewrites a stored value
 * on its own. Escape closes the picker and returns focus to the button.
 *
 * @experimental
 */
export function IconField({
  value,
  onChange,
  loadIcons,
  label = "Icon",
  id,
  disabled = false,
  readOnly = false,
  invalid = false,
  "aria-describedby": describedBy,
  onBlur,
  ref,
  className,
}: IconFieldProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [triggerRef, setTrigger] = useSharedButtonRef(ref);
  const warningId = React.useId();
  const { resolved, text } = useIconFieldValue(loadIcons, value, label, open);
  const missing = resolved.status === "missing";
  const interactive = !disabled && !readOnly;

  const pickerRef = React.useRef<HTMLDivElement | null>(null);

  const setOpenAndReport = (next: boolean): void => {
    if (next && !interactive) return;
    setOpen(next);
    if (!next) onBlur?.();
  };

  // Focus leaving the field's buttons for somewhere outside the field reports
  // the field left. The picker sits in a portal, elsewhere in the document,
  // so it is checked by its own node; its focus events still bubble here
  // through React. Focus never leaves the open picker without closing it, and
  // the close reports, so nothing is reported while it is open or for focus
  // leaving it.
  const reportFocusLeft = (event: React.FocusEvent<HTMLDivElement>): void => {
    const picker = pickerRef.current;
    if (open || picker?.contains(event.target)) return;
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      (event.currentTarget.contains(next) || picker?.contains(next))
    ) {
      return;
    }
    onBlur?.();
  };

  return (
    <div className={cn("w-full", className)} onBlur={reportFocusLeft}>
      <IconFieldFrame invalid={invalid} disabled={disabled}>
        <Popover open={open} onOpenChange={setOpenAndReport}>
          <PopoverTrigger asChild>
            <IconFieldButton
              ref={setTrigger}
              id={id}
              aria-describedby={describedByIds(
                describedBy,
                missing ? warningId : undefined
              )}
              disabled={disabled}
              resolved={resolved}
              text={text}
              empty={!value}
              interactive={interactive}
              invalid={invalid}
              readOnly={readOnly}
            />
          </PopoverTrigger>
          <PopoverContent
            ref={pickerRef}
            align="start"
            collisionPadding={8}
            aria-label="Choose an icon"
            className="w-[min(360px,calc(100vw-32px))] rounded-[10px] p-0 shadow-lg motion-reduce:animate-none"
          >
            <IconPicker
              loadIcons={loadIcons}
              value={value}
              onChoose={icon => {
                onChange(icon.id);
                setOpenAndReport(false);
              }}
            />
          </PopoverContent>
        </Popover>
        {value && interactive ? (
          <ClearIconButton
            onClear={() => {
              onChange(null);
              onBlur?.();
              triggerRef.current?.focus();
            }}
          />
        ) : null}
      </IconFieldFrame>
      {missing ? <MissingIconWarning id={warningId} /> : null}
    </div>
  );
}
