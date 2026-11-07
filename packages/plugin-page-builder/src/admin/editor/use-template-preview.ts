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
 * Asked again whenever the window regains focus, so an entry made in
 * another tab (the strip's New opens one there) is listed without a reload,
 * and the previewed entry's own changes are drawn.
 *
 * @module use-template-preview
 */
import type { PreviewedEntry } from "@nextlyhq/builder/shell";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PreviewCollectionLabels,
  PreviewEntryItem,
  PreviewEntryResponse,
  PreviewEntryStatus,
} from "../../templates/template-preview-contract";
import {
  listPreviewEntries,
  readPreviewEntry,
} from "../template-preview-client";

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
}

/** A template's preview, as the strip, the picker and the canvas read it. */
export interface TemplatePreview {
  /** The template's collection, or `undefined` where it names none yet. */
  readonly collection: string | undefined;
  /** How the collection is named, for "No posts to preview" and "New post". */
  readonly labels: PreviewCollectionLabels;
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

/** The list, read for this collection and person, again on each `round`. */
function usePreviewList(
  args: TemplatePreviewArgs,
  round: number
): PreviewList & { readonly labels?: PreviewCollectionLabels } {
  const { collection, locale, userId } = args;
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly list: PreviewList & { readonly labels?: PreviewCollectionLabels };
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
  // The last answer for this collection, language and person, kept while
  // another entry's is on its way, so the canvas does not blink to its
  // fallbacks between two entries.
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
  const memory = usePreviewMemory(args);
  const mostRecent = list.items[0]?.id;
  const selected = chosenRow?.id ?? memory.remembered ?? mostRecent;
  const read = useEntryRead(args, selected, round);
  const dropChosen = useCallback(() => setChosen(undefined), []);
  useSettledRead(read, {
    selected,
    mostRecent,
    chosen: chosenRow?.id,
    memory,
    dropChosen,
  });
  const previewed = useMemo(
    () => previewedFrom(collection, list, selected, read),
    [collection, list, selected, read]
  );
  const chip = chipFrom(
    chosenRow === undefined ? list.items : [chosenRow, ...list.items],
    selected,
    read
  );
  const choose = useCallback((entry: PreviewEntryItem) => setChosen(entry), []);
  const step = useCallback(
    (by: 1 | -1) => {
      const next = steppedEntry(list.items, selected, by);
      if (next !== undefined) setChosen(next);
      return next;
    },
    [list.items, selected]
  );
  return {
    collection,
    labels: list.labels ?? labelsFromSlug(collection ?? ""),
    language: locale,
    list,
    chip,
    previewed,
    choose,
    step,
    refresh,
  };
}

/** A count bumped whenever the window regains focus, and a way to bump it. */
function useFocusRefresh(): { round: number; refresh: () => void } {
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound(value => value + 1), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return { round, refresh };
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
  const [remembered, setRemembered] = useState<string | undefined>(() =>
    templateId === undefined ? undefined : rememberedEntry(store, templateId)
  );
  const keep = useCallback(
    (entry: string | null) => {
      setRemembered(entry ?? undefined);
      if (templateId !== undefined) rememberEntry(store, templateId, entry);
    },
    [store, templateId]
  );
  return { remembered, keep };
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
  if (read !== undefined && "answer" in read) {
    const { answer } = read;
    // The entry read last, kept until the selected one's answer replaces it.
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
    return { id, title, status };
  }
  const row = rows.find(item => item.id === selected);
  return row === undefined
    ? undefined
    : { id: row.id, title: row.title, status: row.status };
}
