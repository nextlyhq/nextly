"use client";

/**
 * The entry list's Design column: which entries have their own design,
 * marked with the one own-design pill, on the lists of collections that have
 * a template or own designs, and no others.
 *
 * A column is registered for a list by its key, synchronously, before the
 * plugin can know whether that collection has a template. So a provider on
 * every list (`"*"`) adds nothing itself: when a list asks for its columns,
 * it reads that collection's own designs, and only when the collection has a
 * template or own designs registers the column for that list, which the open
 * list then draws. A list key that is not a collection (users, media) is
 * answered with no template and gets no column.
 *
 * The column then follows the answer rather than the first one: each cell
 * reads the collection again as it is drawn, and when a settled answer says
 * the collection has neither a template nor an own design (its template was
 * deleted while the admin was open, say), the column is taken back, from the
 * open list too. The provider asks again on a later view, so a template
 * given later brings it back.
 *
 * Each cell reads the same cached answer (`useEntryDesigns`), so a page of
 * rows asks the server once, not once per row. That answer is capped, so
 * where it says more may exist (`meta.hasNext`), a row it does not list
 * might still have an own design. Each cell then also names its row as on
 * screen, and every cell of the list reads one lookup of the rows on screen
 * by their ids (`useEntriesDesigns`): one more request for the page, asked
 * again when the page changes, and never one per row.
 *
 * On a narrow list the column rides on each card, as every list column
 * does. A provider's column is appended after every field's, off screen on a
 * wide collection, so the column is moved to sit right after Status, beside
 * the lifecycle it reads with.
 *
 * @module admin/entry-design-column
 */
import {
  registerColumns,
  transformColumns,
  type NextlyColumn,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useSyncExternalStore, type JSX } from "react";

import { ENTRY_DESIGNS_ENTRIES_MAX } from "../templates/entry-designs-contract";

import {
  designOf,
  readCollectionDesigns,
  useEntriesDesigns,
  useEntryDesigns,
  type EntryDesignsResponse,
} from "./entry-designs-client";
import { OwnDesignPill } from "./OwnDesignPill";

/** The column's name, out of the way of any field's. */
const DESIGN_COLUMN_NAME = "__pageBuilderOwnDesign";

/** The lists given the column, each with the removal of its registrations. */
const columned = new Map<string, () => void>();
/** The lists whose read is out, so a redraw meanwhile asks nothing more. */
const pending = new Set<string>();
/**
 * When each list last answered that it has no column. Kept only a short
 * while: a collection given a template later in the session gets its column
 * the next time its list is opened, while the redraws of one list view ask
 * nothing more.
 */
const noColumnAt = new Map<string, number>();
/** How long an answer of "no column" stands. */
const NO_COLUMN_FOR_MS = 30_000;
/** Whether the provider on every list is registered. */
let registered = false;

/**
 * Offer the Design column on every list whose collection has a template or
 * own designs. Safe to call more than once.
 */
export function registerEntryDesignColumn(): void {
  if (registered) return;
  registered = true;
  registerColumns("*", ({ target }) => {
    askAbout(target);
    return [];
  });
}

/**
 * Whether a collection's list has the Design column, by its read: it has a
 * template its entries are drawn with, or entries with their own design. A
 * list cut at its bound with none listed may still have some.
 */
function hasDesignColumn(answer: EntryDesignsResponse): boolean {
  return (
    answer.meta.template !== null ||
    answer.items.length > 0 ||
    answer.meta.hasNext
  );
}

/**
 * Read `target` when its list has no column yet, and follow the answer.
 * A list with its column is followed by its own cells' reads instead.
 */
function askAbout(target: string): void {
  if (target === "*" || columned.has(target) || pending.has(target)) return;
  const answeredAt = noColumnAt.get(target);
  if (answeredAt !== undefined && Date.now() - answeredAt < NO_COLUMN_FOR_MS) {
    return;
  }
  pending.add(target);
  readCollectionDesigns(target).then(
    answer => {
      pending.delete(target);
      followDesigns(target, answer);
    },
    () => {
      pending.delete(target);
    }
  );
}

/**
 * Give `target`'s list the column, or take it back, as the latest settled
 * read of the collection says. The one decision both the provider's read
 * and every cell's read go through, so the column always matches the
 * answer on screen.
 */
function followDesigns(
  target: string,
  answer: EntryDesignsResponse | undefined
): void {
  if (answer !== undefined && hasDesignColumn(answer)) {
    noColumnAt.delete(target);
    if (columned.has(target)) return;
    const removeColumn = registerColumns(target, () => [designColumn(target)]);
    const removeMove = transformColumns(target, designAfterStatus);
    columned.set(target, () => {
      removeColumn();
      removeMove();
    });
    return;
  }
  noColumnAt.set(target, Date.now());
  const remove = columned.get(target);
  if (remove === undefined) return;
  columned.delete(target);
  remove();
}

/** The Design column of `collection`'s list. */
function designColumn(collection: string): NextlyColumn {
  return {
    name: DESIGN_COLUMN_NAME,
    header: "Design",
    sortable: false,
    searchable: false,
    cell: ({ row }) => <DesignCell collection={collection} row={row} />,
  };
}

/** The entry list's lifecycle column, a collection with drafts' `status`. */
const STATUS_COLUMN_NAME = "status";

/**
 * `columns` with the Design column moved to right after Status, so it is on
 * screen beside the lifecycle rather than after every field. A list with no
 * Status column (one whose lifecycle is drawn elsewhere, or a collection
 * without drafts) takes it right after its first column, the one naming each
 * entry, for the same reason: appended, it sits past every field, off screen
 * on a wide collection. A list without the Design column is returned as it
 * came.
 */
export function designAfterStatus<Column extends { name: string }>(
  columns: Column[]
): Column[] {
  const design = columns.find(column => column.name === DESIGN_COLUMN_NAME);
  if (design === undefined) return columns;
  const rest = columns.filter(column => column !== design);
  const status = rest.findIndex(column => column.name === STATUS_COLUMN_NAME);
  const after = status === -1 ? Math.min(1, rest.length) : status + 1;
  return [...rest.slice(0, after), design, ...rest.slice(after)];
}

/** A listed row's id, as text. */
function rowIdOf(row: Record<string, unknown>): string | undefined {
  const id = row.id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/**
 * The rows each collection's list has on screen, by id, each counted by the
 * cells naming it, so a row drawn twice (a table and its card) is one id and
 * stays named until both are gone.
 */
const onScreen = new Map<string, Map<string, number>>();
/** Each collection's rows on screen as one sorted list, until they change. */
const onScreenLists = new Map<string, readonly string[]>();
/** The cells to tell when the rows on screen change. */
const onScreenWatchers = new Set<() => void>();
/** Whether a change is already waiting to be told. */
let onScreenTelling = false;
/** No rows: one value, so a cell with nothing named does not redraw. */
const NO_ROWS: readonly string[] = [];

/**
 * Tell every cell, once for every change made in the same pass: the cells of
 * a page name their rows one after another as they mount, and the lookup is
 * asked for the page they make together, not for each row as it arrives.
 */
function rowsOnScreenChanged(collection: string): void {
  onScreenLists.delete(collection);
  if (onScreenTelling) return;
  onScreenTelling = true;
  queueMicrotask(() => {
    onScreenTelling = false;
    for (const watcher of [...onScreenWatchers]) watcher();
  });
}

/** Name `id` as on screen in `collection`'s list, until the removal is run. */
function nameOnScreen(collection: string, id: string): () => void {
  const ids = onScreen.get(collection) ?? new Map<string, number>();
  onScreen.set(collection, ids);
  ids.set(id, (ids.get(id) ?? 0) + 1);
  rowsOnScreenChanged(collection);
  return () => {
    const left = (ids.get(id) ?? 1) - 1;
    if (left > 0) ids.set(id, left);
    else ids.delete(id);
    if (ids.size === 0 && onScreen.get(collection) === ids) {
      onScreen.delete(collection);
    }
    rowsOnScreenChanged(collection);
  };
}

/** `collection`'s rows on screen, sorted, so every cell asks the one path. */
function rowsOnScreenOf(collection: string): readonly string[] {
  const cached = onScreenLists.get(collection);
  if (cached !== undefined) return cached;
  const ids = onScreen.get(collection);
  const list = ids === undefined ? NO_ROWS : [...ids.keys()].sort();
  onScreenLists.set(collection, list);
  return list;
}

/** Watch the rows on screen, as `useSyncExternalStore` asks. */
function watchRowsOnScreen(watcher: () => void): () => void {
  onScreenWatchers.add(watcher);
  return () => {
    onScreenWatchers.delete(watcher);
  };
}

/**
 * The rows on screen that `id`'s lookup asks about: all of them, or, past
 * the lookup's bound (two lists of one collection open together, say), the
 * share of them holding `id`, so each lookup stays within it.
 */
function lookupRowsOf(
  rows: readonly string[],
  id: string | undefined
): readonly string[] {
  const at = id === undefined ? -1 : rows.indexOf(id);
  if (at === -1) return NO_ROWS;
  if (rows.length <= ENTRY_DESIGNS_ENTRIES_MAX) return rows;
  const start = at - (at % ENTRY_DESIGNS_ENTRIES_MAX);
  return rows.slice(start, start + ENTRY_DESIGNS_ENTRIES_MAX);
}

/**
 * Whether a row can be named in the lookup: its ids travel comma-separated,
 * so one holding a comma would be read as two.
 */
function lookupNames(id: string | undefined): id is string {
  return id !== undefined && !id.includes(",");
}

/**
 * One row's mark: the pill for an own design, "Template" for the rest while
 * the collection has one.
 */
export function DesignCell({
  collection,
  row,
}: {
  collection: string;
  row: Record<string, unknown>;
}): JSX.Element | null {
  const read = useEntryDesigns(collection);
  const id = rowIdOf(row);
  const settled = read.fetching ? undefined : read.data;
  // Where the collection's answer is capped, its absence of a row says
  // nothing, so the row is named for the lookup of the rows on screen.
  const capped = read.data?.meta.hasNext === true && lookupNames(id);
  const rows = useSyncExternalStore(watchRowsOnScreen, () =>
    rowsOnScreenOf(collection)
  );
  const lookup = useEntriesDesigns(
    collection,
    capped ? lookupRowsOf(rows, id) : NO_ROWS
  );
  useEffect(() => {
    if (!capped || id === undefined) return undefined;
    return nameOnScreen(collection, id);
  }, [capped, collection, id]);
  useEffect(() => {
    // Only a settled answer moves the column: one shown from the cache while
    // the read is asked again may be the answer that went out of date.
    if (settled !== undefined) followDesigns(collection, settled);
  }, [collection, settled]);
  if (read.data === undefined) return readPending(read.error !== null);
  const { meta } = read.data;
  // The lookup answers for this row by its key, so it goes first; the
  // collection's answer stands in until it lands.
  const design =
    id === undefined
      ? undefined
      : (designOf(lookup.data, id) ?? designOf(read.data, id));
  if (design !== undefined) {
    return (
      <OwnDesignPill
        published={design.status === "published"}
        template={
          meta.template?.status === "published" ? meta.template.title : null
        }
      />
    );
  }
  if (capped) {
    // A capped answer cannot say this row has none: the lookup does. While
    // it is out the pill's place is held; if it fails, nothing is claimed.
    if (lookup.data === undefined) return readPending(lookup.error !== null);
  } else if (meta.hasNext) {
    // A row the lookup cannot name, past a capped answer: nothing claimed.
    return null;
  }
  // An entry without its own design in a collection with no template is
  // drawn with nothing: "Template" there would name one that does not exist.
  if (meta.template === null) return null;
  return <span className="text-xs text-muted-foreground">Template</span>;
}

/**
 * A cell while its answer is out: the pill's own size, so the row does not
 * move when it lands; nothing at all once it failed.
 */
function readPending(failed: boolean): JSX.Element | null {
  return failed ? null : (
    <span
      aria-hidden="true"
      className="inline-block h-[22px] w-20 animate-pulse rounded-full bg-muted"
    />
  );
}
