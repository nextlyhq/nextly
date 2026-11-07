"use client";

/**
 * Which entry a template is previewed with, and everything the strip and the
 * canvas read of it.
 *
 * A template draws every entry of the collection it names, so the editor
 * previews it with one real entry: the one the author chose, else the one
 * they last previewed it with in this session, else the most recently
 * updated entry they may read. The list is the template preview route's,
 * read as the author; the entry is read whole, as the author and as the
 * public read it, for the canvas and for anything that marks what a visitor
 * would see.
 *
 * Asked again whenever the window regains focus (`useRefreshOnFocus`, with
 * the canvas's read of the entry), so an entry made in another tab (the
 * strip's New opens one there) is listed without a reload, and the previewed
 * entry's own changes are drawn, its title and its canvas alike.
 *
 * @module use-template-preview
 */
import type { PreviewedEntry } from "@nextlyhq/builder/shell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  PreviewBlocksField,
  PreviewCollectionLabels,
  PreviewEntryItem,
  PreviewEntryResponse,
  PreviewEntryStatus,
} from "../../templates/template-preview-contract";
import {
  listPreviewEntries,
  readPreviewEntry,
} from "../template-preview-client";

import type { CanvasEntryRead } from "./canvas-entry";
import {
  rememberedEntry,
  rememberEntry,
  templatePreviewStore,
} from "./template-preview-memory";

/** The list's state: on its way, read, or refused. */
export interface PreviewList {
  readonly state: "loading" | "ready" | "refused";
  /** Newest first, at most the route's twenty. */
  readonly items: readonly PreviewEntryItem[];
  readonly mayCreate: boolean;
}

/** What the chip shows of the entry being previewed. */
export interface PreviewChip {
  readonly id: string;
  readonly title: string;
  readonly status: PreviewEntryStatus;
  /**
   * Whether the entry could not be read: listed, then gone or refused when
   * read whole. The canvas then draws its fallbacks, and the chip says so
   * rather than claiming an entry the canvas does not show.
   */
  readonly unavailable: boolean;
  /**
   * Whether the entry is still being read, by its own read or the canvas's:
   * the chip names the entry chosen, and says it is not drawn yet.
   */
  readonly loading: boolean;
}

/** A template's preview, as the strip, the picker and the canvas read it. */
export interface TemplatePreview {
  /** The template's collection, or `undefined` where it names none yet. */
  readonly collection: string | undefined;
  /**
   * Whether the entry is fixed: an own design previews the one entry it
   * serves, so there is nothing to choose and no keys step through a list.
   */
  readonly fixed: boolean;
  /** How the collection is named, for "No posts to preview" and "New post". */
  readonly labels: PreviewCollectionLabels;
  /**
   * The collection's top-level blocks fields, which an Entry content block
   * may draw; `undefined` until the list says, or where it was refused.
   */
  readonly blocksFields: readonly PreviewBlocksField[] | undefined;
  readonly language: string | undefined;
  readonly list: PreviewList;
  /** The entry being previewed, as the chip shows it; none while there is none. */
  readonly chip: PreviewChip | undefined;
  /** The entry the editor reads, as the builder's seam carries it. */
  readonly previewed: PreviewedEntry;
  /** Preview `entry`, a row of the list or of a search. */
  readonly choose: (entry: PreviewEntryItem) => void;
  /**
   * Preview the next entry (`1`) or the previous one (`-1`) in the list's
   * order, wrapping at its ends; the entry switched to, or nothing where
   * there is no other.
   */
  readonly step: (by: 1 | -1) => PreviewEntryItem | undefined;
  /** Ask for the list and the entry again. */
  readonly refresh: () => void;
}

/** What the preview is made for: the template, its collection and its reader. */
export interface TemplatePreviewArgs {
  /** The template's collection, as its form holds it now. */
  readonly collection: string | undefined;
  /** The template's own id, which the memory is kept under. */
  readonly templateId: string | undefined;
  readonly userId: string | null;
  readonly locale: string | undefined;
  /**
   * The one entry an entry's own design serves, by id: previewed always,
   * with nothing to choose. Absent for a collection's template.
   */
  readonly entry?: string | undefined;
}

/**
 * The words a collection is named by before the route has named it, or
 * where it refused: its slug, spaced. The same for a collection the author
 * may not read as for one that is empty, since neither answer names it.
 */
function labelsFromSlug(slug: string): PreviewCollectionLabels {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return { singular: words, plural: words };
}

/** An entry's answer, or its failure, for the id it was read for. */
type EntryRead =
  | { readonly id: string; readonly answer: PreviewEntryResponse }
  | { readonly id: string; readonly failed: true };

/** Where the next or previous entry of `items` is, from `id`, wrapping. */
export function steppedEntry(
  items: readonly PreviewEntryItem[],
  id: string | undefined,
  by: 1 | -1
): PreviewEntryItem | undefined {
  if (items.length === 0) return undefined;
  const at = items.findIndex(item => item.id === id);
  // From outside the list (an entry found by search), the first step goes
  // to its start or its end.
  const next =
    at === -1
      ? by === 1
        ? 0
        : items.length - 1
      : (at + by + items.length) % items.length;
  const item = items[next];
  return item === undefined || item.id === id ? undefined : item;
}

/** What the list's answer says of the collection besides its entries. */
interface ListFacts {
  readonly labels?: PreviewCollectionLabels;
  readonly blocksFields?: readonly PreviewBlocksField[];
}

/** The list, read for this collection and person, again on each `round`. */
function usePreviewList(
  args: TemplatePreviewArgs,
  round: number
): PreviewList & ListFacts {
  const { collection, locale, userId } = args;
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly list: PreviewList & ListFacts;
  } | null>(null);
  const key = JSON.stringify([collection ?? null, locale ?? null, userId]);
  useEffect(() => {
    // Asked of whoever the session names; the answer is kept under that
    // person, so another's never stands in for theirs.
    if (collection === undefined) return;
    let current = true;
    listPreviewEntries({
      collection,
      ...(locale === undefined ? {} : { locale }),
    }).then(
      found => {
        if (!current) return;
        setAnswer({
          key,
          list: {
            state: "ready",
            items: found.items,
            mayCreate: found.meta.mayCreate,
            labels: found.meta.labels,
            blocksFields: found.meta.blocksFields,
          },
        });
      },
      () => {
        // Refused or failed, it lists nothing: the same words as an empty
        // collection, so the strip says nothing of why.
        if (current) {
          setAnswer({
            key,
            list: { state: "refused", items: [], mayCreate: false },
          });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [collection, locale, userId, key, round]);
  // Another collection's, language's or person's list is never shown.
  if (answer === null || answer.key !== key) {
    return { state: "loading", items: [], mayCreate: false };
  }
  return answer.list;
}

/** The entry `id`, read whole, again on each `round`. */
function useEntryRead(
  args: TemplatePreviewArgs,
  id: string | undefined,
  round: number
): EntryRead | undefined {
  const { collection, locale, userId } = args;
  const [read, setRead] = useState<
    (EntryRead & { readonly key: string }) | undefined
  >(undefined);
  const key = JSON.stringify([collection ?? null, locale ?? null, userId]);
  useEffect(() => {
    if (collection === undefined || id === undefined) return;
    let current = true;
    readPreviewEntry({
      collection,
      id,
      ...(locale === undefined ? {} : { locale }),
    }).then(
      answer => {
        if (current) setRead({ key, id, answer });
      },
      () => {
        if (current) setRead({ key, id, failed: true });
      }
    );
    return () => {
      current = false;
    };
  }, [collection, id, locale, userId, key, round]);
  // The last answer for this collection, language and person; its id says
  // which entry it is, so a read still on its way is never taken for the
  // entry the strip names.
  return read === undefined || read.key !== key ? undefined : read;
}

/**
 * The preview of the template being edited: its list, the entry it is
 * previewed with, and the ways to choose another.
 */
export function useTemplatePreview(args: TemplatePreviewArgs): TemplatePreview {
  const { collection, locale } = args;
  const { round, refresh } = useFocusRefresh();
  const [chosenRow, setChosen] = useState<PreviewEntryItem | undefined>(
    undefined
  );
  const list = usePreviewList(args, round);
  // An own design remembers nothing: it previews its one entry.
  const fixed = args.entry;
  const memory = usePreviewMemory(memoryArgsOf(args));
  const mostRecent = list.items[0]?.id;
  const selected = fixed ?? chosenRow?.id ?? memory.remembered ?? mostRecent;
  const read = useEntryRead(args, selected, round);
  const dropChosen = useCallback(() => setChosen(undefined), []);
  useSettledRead(read, {
    selected,
    mostRecent: fixed ?? mostRecent,
    chosen: chosenRow?.id,
    memory,
    dropChosen,
  });
  const previewed = useMemo(
    () => previewedFrom(collection, list, selected, read),
    [collection, list, selected, read]
  );
  const labels = list.labels ?? labelsFromSlug(collection ?? "entries");
  const chip =
    chipFrom(
      chosenRow === undefined ? list.items : [chosenRow, ...list.items],
      selected,
      read
    ) ?? fixedChip(fixed, labels, read);
  const { choose, step } = useChoosing(fixed, list.items, selected, setChosen);
  return {
    collection,
    fixed: fixed !== undefined,
    // A template always names its collection; "entries" only stands in
    // until its form has the value.
    labels,
    blocksFields: list.blocksFields,
    language: locale,
    list,
    chip,
    previewed,
    choose,
    step,
    refresh,
  };
}

/**
 * What the seam says while the canvas's read of the entry is on its way: one
 * value, so a render while it waits hands the seam's readers nothing new.
 */
const CANVAS_LOADING: PreviewedEntry = { kind: "none", reason: "loading" };

/**
 * The preview as the strip and the seam say it: an entry is named as the
 * one previewed only once both its own read and the canvas's read of it
 * have answered, so neither claims an entry the canvas is not drawing. A
 * canvas read that failed marks the entry unavailable, as a failed entry
 * read does, and Try again then asks both again (`retryCanvas`). A canvas
 * with nothing bound needs no read, and counts as answered.
 */
export function followingCanvas(
  preview: TemplatePreview,
  canvas: CanvasEntryRead | undefined,
  retryCanvas: () => void
): TemplatePreview {
  const refresh = () => {
    preview.refresh();
    retryCanvas();
  };
  const { chip } = preview;
  if (chip === undefined || chip.unavailable) return { ...preview, refresh };
  const state = canvas?.entryId === chip.id ? canvas.state : "pending";
  if (state === "failed") {
    return {
      ...preview,
      chip: { ...chip, unavailable: true },
      previewed: { kind: "none", reason: "unavailable" },
      refresh,
    };
  }
  if (state === "pending") {
    return {
      ...preview,
      chip: { ...chip, loading: true },
      ...(preview.previewed.kind === "entry"
        ? { previewed: CANVAS_LOADING }
        : {}),
      refresh,
    };
  }
  return { ...preview, refresh };
}

/** What the memory is kept for: nothing for an own design, which previews its one entry. */
function memoryArgsOf(args: TemplatePreviewArgs): TemplatePreviewArgs {
  return args.entry === undefined ? args : { ...args, templateId: undefined };
}

/**
 * Choosing an entry and stepping through the list, both of which an own
 * design's one entry (`fixed`) refuses: it has nothing else to preview.
 */
function useChoosing(
  fixed: string | undefined,
  items: readonly PreviewEntryItem[],
  selected: string | undefined,
  setChosen: (entry: PreviewEntryItem) => void
): Pick<TemplatePreview, "choose" | "step"> {
  const choose = useCallback(
    (entry: PreviewEntryItem) => {
      if (fixed === undefined) setChosen(entry);
    },
    [fixed, setChosen]
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (fixed !== undefined) return undefined;
      const next = steppedEntry(items, selected, by);
      if (next !== undefined) setChosen(next);
      return next;
    },
    [fixed, items, selected, setChosen]
  );
  return { choose, step };
}

/**
 * A count bumped to read the list and the entry again, and a way to bump it.
 * The window regaining focus does not bump it here: the editor asks the
 * preview's whole refresh then (`useRefreshOnFocus`), so the canvas's read
 * is asked again with them, never left on what it kept.
 */
function useFocusRefresh(): { round: number; refresh: () => void } {
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound(value => value + 1), []);
  return { round, refresh };
}

/**
 * Call `refresh` whenever the window regains focus: an entry made or changed
 * in another tab (the strip's New opens one there) is listed and drawn
 * without a reload. The latest `refresh` is called, so a caller may hand a
 * new one on every render.
 */
export function useRefreshOnFocus(refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const onFocus = () => latest.current();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}

/** The entry remembered for the template this session, and how to change it. */
interface PreviewMemory {
  readonly remembered: string | undefined;
  /** Keep `entry` as the template's, or forget its entry with `null`. */
  readonly keep: (entry: string | null) => void;
}

/**
 * The entry remembered for the template, read once as the editor opens it,
 * kept per person and template for the session.
 */
function usePreviewMemory(args: TemplatePreviewArgs): PreviewMemory {
  const { templateId, userId } = args;
  const store = useMemo(() => templatePreviewStore(userId), [userId]);
  // Whose memory, of which template: none until both are known. On a cold
  // load the person is known only once the admin has asked who they are, so
  // the memory is read again then, never kept from the read made before.
  const whose =
    userId === null || templateId === undefined
      ? null
      : JSON.stringify([userId, templateId]);
  const read = (): string | undefined =>
    whose === null || templateId === undefined
      ? undefined
      : rememberedEntry(store, templateId);
  const [held, setHeld] = useState(() => ({ whose, remembered: read() }));
  // Read again, in this render, whenever the person or the template changes.
  const current = held.whose === whose ? held : { whose, remembered: read() };
  if (current !== held) setHeld(current);
  const keep = useCallback(
    (entry: string | null) => {
      // Nothing is kept for a person not known yet: a choice made then would
      // be written over theirs once they are.
      if (whose === null || templateId === undefined) return;
      setHeld({ whose, remembered: entry ?? undefined });
      rememberEntry(store, templateId, entry);
    },
    [store, templateId, whose]
  );
  return { remembered: current.remembered, keep };
}

/**
 * What a settled read leaves behind: the entry read is remembered for the
 * template; a chosen or remembered entry that can no longer be read
 * (deleted, or no longer the author's to read) gives way to the most
 * recent, which failing itself is said as unavailable rather than looped on.
 */
function useSettledRead(
  read: EntryRead | undefined,
  at: {
    readonly selected: string | undefined;
    readonly mostRecent: string | undefined;
    readonly chosen: string | undefined;
    readonly memory: PreviewMemory;
    readonly dropChosen: () => void;
  }
): void {
  const { selected, mostRecent, chosen, memory, dropChosen } = at;
  const failedId = read !== undefined && "failed" in read ? read.id : undefined;
  const answeredId =
    read !== undefined && "answer" in read ? read.answer.id : undefined;
  const { remembered, keep } = memory;
  useEffect(() => {
    if (failedId === undefined || failedId === mostRecent) return;
    if (failedId === chosen) dropChosen();
    if (failedId === remembered) keep(null);
  }, [failedId, mostRecent, chosen, remembered, keep, dropChosen]);
  useEffect(() => {
    if (answeredId !== undefined && answeredId === selected) {
      keep(answeredId);
    }
  }, [answeredId, selected, keep]);
}

/** The seam's answer, from the list, the selection and the entry's read. */
function previewedFrom(
  collection: string | undefined,
  list: PreviewList,
  selected: string | undefined,
  read: EntryRead | undefined
): PreviewedEntry {
  if (collection === undefined) return { kind: "none", reason: "empty" };
  if (selected === undefined) {
    return list.state === "loading"
      ? { kind: "none", reason: "loading" }
      : { kind: "none", reason: "empty" };
  }
  if (read !== undefined && "answer" in read && read.answer.id === selected) {
    const { answer } = read;
    // Only the selected entry's own answer: the strip names the selected
    // entry, so nothing reads another one as the entry being previewed.
    return {
      kind: "entry",
      collection,
      id: answer.id,
      title: answer.title,
      editorValues: answer.editorValues,
      publicValues: answer.publicValues,
      fields: answer.fields,
    };
  }
  if (read !== undefined && read.id === selected) {
    return { kind: "none", reason: "unavailable" };
  }
  return { kind: "none", reason: "loading" };
}

/**
 * The chip for an own design's one entry before its read answers, which no
 * list row stands in for: named for the collection's entry ("the post"),
 * read, or marked unavailable where its read failed.
 */
function fixedChip(
  entry: string | undefined,
  labels: PreviewCollectionLabels,
  read: EntryRead | undefined
): PreviewChip | undefined {
  if (entry === undefined) return undefined;
  const failed = read !== undefined && "failed" in read && read.id === entry;
  return {
    id: entry,
    title: `the ${labels.singular.toLowerCase()}`,
    status: "published",
    unavailable: failed,
    loading: !failed,
  };
}

/**
 * What the chip shows: the selected entry, from its read, else from the row
 * it was chosen from or the list's.
 */
function chipFrom(
  rows: readonly PreviewEntryItem[],
  selected: string | undefined,
  read: EntryRead | undefined
): PreviewChip | undefined {
  if (selected === undefined) return undefined;
  if (read !== undefined && "answer" in read && read.answer.id === selected) {
    const { id, title, status } = read.answer;
    return { id, title, status, unavailable: false, loading: false };
  }
  const row = rows.find(item => item.id === selected);
  // Named from its row while it is read; marked when that read failed.
  const failed = read !== undefined && "failed" in read && read.id === selected;
  return row === undefined
    ? undefined
    : {
        id: row.id,
        title: row.title,
        status: row.status,
        unavailable: failed,
        loading: !failed,
      };
}
