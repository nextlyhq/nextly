"use client";

/**
 * One opening of the in-place picker: a non-modal dialog named "Add a
 * block", described by the line that says where a block goes, holding a
 * search, the six blocks the author adds most and "Browse all blocks and
 * sections →".
 *
 * **What it offers and where each goes is the Add panel's answer.** The
 * catalogue, the placement rule, the locks and the search's words all come
 * from {@link useInsertOffers}, the hook the panel and the editor's search
 * call, so the picker cannot place a block anywhere a panel click would not.
 * What is only true here is that a choice the place refuses is left out
 * rather than greyed: the picker is small, and a refusal's reason is the Add
 * panel's to give, one press away.
 *
 * **The keyboard is the picker's own, and honest about its shape.** The six
 * are a grid and every arrow moves through them; the results are a list
 * and Up and Down do. The search field is a combobox controlling whichever
 * is shown, with the highlighted choice as its active descendant, so focus
 * never leaves the field the author types in.
 *
 * @module insert-picker-body
 */

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { Popover, PopoverAnchor, PopoverContent } from "@nextlyhq/ui";
import { CornerDownRight, Search } from "lucide-react";
import * as React from "react";

import { useCanvasFrame } from "../../canvas/canvas-frame-context";

import { useInsertOffers, type InsertOffers } from "./insert-panel-offers";
import { tileWhere } from "./insert-panel-tiles";
import { MostUsedGrid, ResultList } from "./insert-picker-choices";
import { movedHighlight, type PickerLayout } from "./insert-picker-keys";
import type {
  InsertPickerProps,
  InsertPickerRequest,
  PickerOutcome,
} from "./insert-picker-types";
import { insertedAnnouncement, placementWords } from "./insert-placement-words";
import {
  mostUsedEntries,
  readInsertCounts,
  useInsertUsage,
} from "./insert-usage";
import {
  filterEntries,
  paletteGroups,
  type InsertEntry,
  type InsertionCandidate,
} from "./inserter";

/** The picker's own words, exactly as decided. */
const PICKER_WORDS = {
  name: "Add a block",
  search: "Search blocks",
  browseAll: "Browse all blocks and sections →",
} as const;

/** What one opening is handed by the picker that is always mounted. */
export interface OpenPickerProps
  extends Omit<InsertPickerProps, "request" | "onClose" | "onEditText"> {
  readonly request: InsertPickerRequest;
  /** How the opening ended; called once. */
  readonly onFinish: (outcome: PickerOutcome) => void;
  /** The sentence an insert is announced with, said after the picker goes. */
  readonly onSaid: (sentence: string) => void;
}

export function OpenPicker({
  request,
  onFinish,
  onSaid,
  onBrowseAll,
  categoryOrder,
  blockOrder,
  ...sources
}: OpenPickerProps): React.JSX.Element {
  const { editor } = sources;
  const inserted = React.useRef<BlockNode | null>(null);
  const place =
    request.target.kind === "place" ? request.target.place : undefined;
  const offerings = useInsertOffers({
    ...sources,
    ...place,
    onInsert: node => {
      inserted.current = node;
      sources.onInsert?.(node);
    },
  });
  const [query, setQuery] = React.useState("");
  const [highlighted, setHighlighted] = React.useState(0);
  const choices = useChoices(offerings, query, { categoryOrder, blockOrder });
  const index = Math.min(highlighted, Math.max(choices.entries.length - 1, 0));
  const current = choices.entries[index];
  const line = linePlace(request, offerings, current);

  const done = React.useRef(false);
  const finish = (outcome: PickerOutcome): void => {
    if (done.current) return;
    done.current = true;
    onFinish(outcome);
  };
  useFrameDismiss(() => finish({ kind: "dismissed", returnFocus: true }));

  const choose = (at: number): void => {
    const entry = choices.entries[at];
    const offer =
      entry === undefined ? undefined : offerings.offers.get(entry.id);
    if (entry === undefined || offer?.place === undefined) return;
    // Named against the page before the insert, where its blocks are.
    const said = insertedAnnouncement(
      entry.label,
      editor.document,
      offer.place
    );
    inserted.current = null;
    offerings.insert(offer);
    const node = inserted.current;
    if (node === null) return;
    onSaid(said);
    finish({ kind: "inserted", node });
  };

  const ids = usePickerIds();
  const input = React.useRef<HTMLInputElement | null>(null);
  // Focus stays in the search, so the list does not follow the highlight by
  // itself: a choice the keyboard or a new search highlights is brought into
  // view, as little as it takes, once it is drawn. A fresh object per request
  // so a key that leaves the highlight where it is still shows it. A pointer
  // highlight asks for nothing: the choice under the pointer is in view.
  const [revealed, setRevealed] = React.useState<{ at: number } | null>(null);
  React.useLayoutEffect(() => {
    if (revealed === null) return;
    input.current?.ownerDocument
      .getElementById(ids.choice(revealed.at))
      ?.scrollIntoView({ block: "nearest" });
  }, [revealed, ids]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // An input method composing text owns Enter and the arrows: they pick and
    // confirm its characters, not a block.
    if (composing(event.nativeEvent)) return;
    const moved = movedHighlight(
      choices.layout,
      index,
      choices.entries.length,
      event.key
    );
    if (moved === undefined && event.key !== "Enter") return;
    // The picker's own keys, kept from the editor's shortcuts beneath it.
    event.preventDefault();
    event.stopPropagation();
    if (moved === undefined) {
      choose(index);
      return;
    }
    setHighlighted(moved);
    setRevealed({ at: moved });
  };

  return (
    <Popover
      open
      onOpenChange={open => {
        if (!open) finish({ kind: "dismissed", returnFocus: true });
      }}
    >
      <PopoverAnchor virtualRef={{ current: request.anchor }} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="nx-insert-picker"
        aria-label={PICKER_WORDS.name}
        aria-describedby={line === undefined ? undefined : ids.line}
        onOpenAutoFocus={event => {
          event.preventDefault();
          input.current?.focus({ preventScroll: true });
        }}
        // Focus is put back by the picker itself, once it has gone.
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => {
          event.preventDefault();
          // An input method's Escape cancels what it was composing, and the
          // search the author is typing stays open.
          if (composing(event)) return;
          finish({ kind: "dismissed", returnFocus: true });
        }}
        // Leaving by Tab goes where the author went: focus stays there.
        onFocusOutside={event => {
          event.preventDefault();
          finish({ kind: "dismissed", returnFocus: false });
        }}
        // Escape is the picker's: the editor's Escape beneath it would clear
        // the selection the picker was opened from.
        onKeyDown={event => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <div className="nx-insert-picker__search">
          <Search aria-hidden="true" size={14} />
          <input
            ref={input}
            className="nx-insert-picker__input"
            role="combobox"
            aria-label={PICKER_WORDS.search}
            placeholder={PICKER_WORDS.search}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-haspopup={choices.layout === "grid" ? "grid" : "listbox"}
            aria-controls={ids.choices}
            aria-activedescendant={
              current === undefined ? undefined : ids.choice(index)
            }
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setHighlighted(0);
              setRevealed({ at: 0 });
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {line === undefined ? (
          <p className="nx-insert-picker__line" role="status">
            The place chosen to add at is no longer on the page.
          </p>
        ) : (
          <p id={ids.line} className="nx-insert-picker__line">
            <CornerDownRight aria-hidden="true" size={13} />
            <span>{placementWords("Adding", editor.document, line)}</span>
          </p>
        )}
        <PickerChoices
          layout={choices.layout}
          query={query}
          id={ids.choices}
          entries={choices.entries}
          highlighted={index}
          choiceId={ids.choice}
          whereOf={entry =>
            tileWhere(offerings.offers.get(entry.id), editor.document)
          }
          onHighlight={setHighlighted}
          onChoose={choose}
        />
        <button
          type="button"
          className="nx-insert-picker__all"
          onClick={() => {
            finish({ kind: "browse" });
            onBrowseAll(request.target);
          }}
        >
          {PICKER_WORDS.browseAll}
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Whether a key belongs to an input method composing text: `isComposing`,
 * or the legacy 229 key code some browsers send instead.
 */
function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** The grid or the list, and what it says when it holds nothing. */
function PickerChoices({
  layout,
  query,
  ...props
}: React.ComponentProps<typeof ResultList> & {
  readonly layout: PickerLayout;
  readonly query: string;
}): React.JSX.Element {
  const Choices = layout === "grid" ? MostUsedGrid : ResultList;
  const empty =
    layout === "grid"
      ? "No blocks can be added here."
      : `No blocks match "${query.trim()}".`;
  return (
    <>
      <Choices {...props} />
      {props.entries.length === 0 ? (
        <p className="nx-insert-picker__empty" role="status">
          {empty}
        </p>
      ) : null}
    </>
  );
}

/**
 * What the picker shows: at rest the six most used blocks the place takes,
 * and while typing every block, saved section and component it takes that
 * matches, in the Add panel's order and by its words.
 */
function useChoices(
  { catalog, offers }: InsertOffers,
  query: string,
  order: Pick<InsertPickerProps, "categoryOrder" | "blockOrder">
): { readonly layout: PickerLayout; readonly entries: readonly InsertEntry[] } {
  const usage = useInsertUsage();
  // Read once per opening: an insert closes the picker, and the next
  // opening reads the count it added.
  const counts = React.useMemo(() => readInsertCounts(usage), [usage]);
  const offered = React.useMemo(
    () =>
      paletteGroups(
        catalog.filter(entry => offers.get(entry.id)?.place !== undefined),
        order.categoryOrder,
        order.blockOrder
      ).flatMap(group => group.entries),
    [catalog, offers, order.categoryOrder, order.blockOrder]
  );
  if (query.trim() === "") {
    return { layout: "grid", entries: mostUsedEntries(offered, counts) };
  }
  return { layout: "list", entries: filterEntries(offered, query) };
}

/**
 * Where the line says a block goes. At a fixed place, that place. By the
 * rule, the highlighted block's own place, as the Add panel's line follows
 * its highlight; before anything is highlighted, where a content block goes.
 * `undefined` when a fixed place is gone from the page.
 */
function linePlace(
  request: InsertPickerRequest,
  { offers, rest }: InsertOffers,
  current: InsertEntry | undefined
): InsertionCandidate | undefined {
  if (request.target.kind === "place" || current === undefined) return rest;
  return offers.get(current.id)?.place ?? rest;
}

/** The ids the dialog's parts point at one another by. */
function usePickerIds(): {
  readonly line: string;
  readonly choices: string;
  readonly choice: (index: number) => string;
} {
  const prefix = React.useId();
  return React.useMemo(
    () => ({
      line: `${prefix}-line`,
      choices: `${prefix}-choices`,
      choice: (index: number) => `${prefix}-choice-${String(index)}`,
    }),
    [prefix]
  );
}

/**
 * A press on the page closes the picker. The page is drawn in a frame of its
 * own, whose presses never reach the editor's document, where the popover
 * listens for presses outside it.
 */
function useFrameDismiss(dismiss: () => void): void {
  const frameDocument = useCanvasFrame().document;
  const latest = React.useRef(dismiss);
  latest.current = dismiss;
  React.useEffect(() => {
    if (frameDocument === null || frameDocument === globalThis.document) {
      return;
    }
    const press = (): void => latest.current();
    frameDocument.addEventListener("pointerdown", press, true);
    return () => frameDocument.removeEventListener("pointerdown", press, true);
  }, [frameDocument]);
}
