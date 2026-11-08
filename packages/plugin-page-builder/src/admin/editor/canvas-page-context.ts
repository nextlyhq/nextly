/**
 * The page context the editor's canvas draws under.
 *
 * The canvas renders the page in the browser, and a block reads what it draws
 * through its page context: an image resolves its media item there. Without a
 * context of its own the canvas drew under the renderer's stand-in, whose
 * media resolver answers nothing, so an image chosen from the media library
 * drew no picture at all while the published page showed it.
 *
 * ONE object for the editor's life. The renderer keeps an async block's
 * output per context, so the page drawn again for a selection does not run an
 * image or a button again and blink; a context made afresh per render would
 * be a different one each time and keep nothing. The one exception is the
 * set of lists an author chose to see empty: choosing is a deliberate act,
 * and the page is drawn again under a context naming them, while none being
 * chosen is the editor's one object again, with everything it kept.
 *
 * A collection list draws the entries the person editing may read, their
 * drafts included (the list entries route reads as them), in the
 * language being edited through the reads the inspector's count shares
 * (`canvasListReadsIn`), and, since an author is looking, says what it could
 * not do as stored (`diagnostics`): a sort that fell back to id order, a read
 * that failed. Its reads are bounded per draw as a published page's are
 * (`queries`), so lists nested in lists cannot read without end.
 *
 * @module canvas-page-context
 */
import {
  COLLECTION_LIST_TYPE,
  isPlainRecord,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  createQueryBudget,
  createStandaloneContext,
  type NamedQueryHost,
  type PageContext,
  type QueryBudget,
  type ResolvedIcon,
  type ResolvedMedia,
} from "@nextlyhq/blocks-react";
import type { ListEntryCount } from "@nextlyhq/blocks-react/blocks";
import { useCurrentUserId, useMediaResolver } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState } from "react";

import type { ListEntriesVisitor } from "../../list-entries-contract";
import { canvasListReadsIn } from "../list-entries-client";
import { canvasNamedQueriesIn } from "../named-queries-client";

import { useCanvasEntryIdentity } from "./canvas-entry";

/**
 * An icon as the canvas draws it, from the set a published page draws with.
 * The set is reached through a dynamic `import()`, so it is a chunk of its
 * own, fetched when the canvas first draws an icon rather than with the
 * editor; the set's own resolver loads its data once and keeps it.
 */
async function resolveCanvasIcon(id: string): Promise<ResolvedIcon | null> {
  const { resolveLucideIcon } = await import(
    "@nextlyhq/blocks-react/icons/lucide"
  );
  return resolveLucideIcon(id);
}

/** What a media item read through the admin gives a block to draw. */
interface MediaItem {
  readonly url: string;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

/** A media item as a block draws it, or `null` for none. */
function drawnMedia(item: MediaItem | null): ResolvedMedia | null {
  if (item === null) return null;
  return {
    url: item.url,
    ...(item.altText ? { alt: item.altText } : {}),
    ...(item.width ? { width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
  };
}

/**
 * A read budget the canvas renews for each draw: one object, so the context
 * holding it stays the editor's one object, whose allowance is a published
 * page's (`createQueryBudget`) and is begun afresh by `renew`.
 */
interface CanvasQueryBudget extends QueryBudget {
  renew(): void;
}

function canvasQueryBudget(): CanvasQueryBudget {
  let current = createQueryBudget();
  return {
    take: () => current.take(),
    remaining: () => current.remaining?.() ?? 0,
    // Each draw's own, so a named query's run is kept for one draw only.
    generation: () => current,
    renew: () => {
      current = createQueryBudget();
    },
  };
}

/**
 * The collection a document is an entry of, as its lists judge a related
 * source: the collection's slug for an entry (for a template, the entry of
 * its collection it is previewed with, which the editor hands the canvas as
 * its identity); `null` for a Single, whose
 * page has no entry a related list could read, so the inspector refuses
 * such a list as the save does; nothing while no document is known, nor for
 * a component, which is drawn on the pages placing it and judged with each
 * of them as the entry, as its save judges it.
 */
export function listEntryCollectionOf(
  identity: { readonly kind: string; readonly slug: string } | null,
  document?: unknown
): string | null | undefined {
  if (identity === null) return undefined;
  if (isPlainRecord(document) && document.kind === "component") {
    return undefined;
  }
  if (identity.kind === "single") return null;
  return identity.kind === "collection" ? identity.slug : undefined;
}

/**
 * The canvas's page context: its images resolve through the admin's media
 * read, which caches each item by id and shares a read in flight, its icons
 * from the published page's icon set, and its lists read in `locale`, the
 * language being edited.
 */
export function useCanvasPageContext(
  listsShowingEmpty?: ReadonlySet<string>,
  locale?: string,
  /** The document being edited, whose kind decides whether it is an entry. */
  document?: unknown,
  /** The list the page splits into pages, which draws its first page's links. */
  pagedList?: string,
  /** The lists whose new source waits for an input, with each one's tag. */
  listsStillShowing?: ReadonlyMap<string, string>,
  /**
   * The document being edited while its visibility conditions are applied,
   * with the blocks it draws: its lists are then read as a visitor reads
   * them, published entries and public fields only, so each item's
   * conditions are judged as the published page judges them; and a list a
   * visitor sees fewer entries of says so.
   */
  asVisitor?: VisitorLists
): PageContext {
  const visitor = asVisitor?.visitor;
  const readMedia = useMediaResolver();
  const budget = useMemo(canvasQueryBudget, []);
  // Renewed once each draw has been committed, so the next draw has the
  // whole allowance and one draw's reads stay within it.
  useEffect(() => {
    budget.renew();
  });
  // The entry the document is stored on, by its collection and id, so a list
  // of its related entries reads the relation as the canvas reads the entry:
  // again, through the canvas's reader, never from the form's values. For a
  // template, the entry of its collection being previewed.
  const identity = useCanvasEntryIdentity();
  const entryCollection =
    listEntryCollectionOf(identity, document) ?? undefined;
  const entryId =
    identity?.kind === "collection" ? identity.documentId : undefined;
  // The person's and language's one set of list reads, which the inspector's
  // count shares: the rows are read as the person signed in.
  const userId = useCurrentUserId();
  const lists = canvasListReadsIn(locale, userId, visitor);
  // The site's named queries, whose runs the server makes as that person:
  // until they are read, a list whose source is one draws its template, as
  // with no host.
  const namedQueries = useCanvasNamedHost(locale, userId, visitor);
  const visitorNotes = useVisitorListNotes(asVisitor, locale, userId);
  const base = useMemo(
    () =>
      createStandaloneContext({
        resolveMedia: async id => drawnMedia(await readMedia(id)),
        resolveIcon: resolveCanvasIcon,
        ...lists.terms,
        data: lists.data,
        queries: budget,
        diagnostics: true,
        // The canvas acts on a note's action: see `onListSortField`.
        listNoteActions: true,
        ...(entryCollection === undefined || entryId === undefined
          ? {}
          : { entry: { id: entryId }, entryCollection }),
        ...(namedQueries === undefined ? {} : { namedQueries }),
      }),
    [readMedia, entryCollection, entryId, lists, budget, namedQueries]
  );
  return useMemo(() => {
    const empty =
      listsShowingEmpty === undefined || listsShowingEmpty.size === 0
        ? undefined
        : listsShowingEmpty;
    const still =
      listsStillShowing === undefined || listsStillShowing.size === 0
        ? undefined
        : listsStillShowing;
    // The editor's one object again whenever nothing is chosen, waiting,
    // paged or drawn as a visitor sees fewer of.
    if (
      empty === undefined &&
      still === undefined &&
      pagedList === undefined &&
      visitorNotes === undefined
    ) {
      return base;
    }
    return {
      ...base,
      ...(empty === undefined ? {} : { listsShowingEmpty: empty }),
      ...(still === undefined ? {} : { listsStillShowing: still }),
      ...(visitorNotes === undefined
        ? {}
        : { listsShowingVisitors: visitorNotes }),
      // The links lead nowhere on the canvas: a click there selects the
      // list, and the pages after the first are the published route's to
      // draw.
      ...(pagedList === undefined
        ? {}
        : {
            listPage: { nodeId: pagedList, page: 1, href: canvasPageHref },
          }),
    };
  }, [base, listsShowingEmpty, listsStillShowing, pagedList, visitorNotes]);
}

/** The document a canvas reads its lists as a visitor of, and its blocks. */
export interface VisitorLists {
  readonly visitor: ListEntriesVisitor;
  /** The blocks the canvas draws, whose lists are counted both ways. */
  readonly nodes: readonly BlockNode[];
}

/** A list the page draws once: its id and what it stores. */
interface DrawnList {
  readonly id: string;
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * The lists a page draws once each: every collection list but one inside
 * another list's entries, which is drawn once per entry and counts nothing
 * as one list.
 */
export function drawnListsOf(nodes: readonly BlockNode[]): DrawnList[] {
  const found: DrawnList[] = [];
  const stack: unknown[] = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isPlainRecord(node) || typeof node.id !== "string") continue;
    if (node.type === COLLECTION_LIST_TYPE) {
      found.push({ id: node.id, props: propsOf(node.props) });
    } else {
      stack.push(...childrenOf(node.slots).reverse());
    }
  }
  return found;
}

/** A stored block's props, or none where it stores something else. */
function propsOf(props: unknown): Readonly<Record<string, unknown>> {
  return isPlainRecord(props) ? props : {};
}

/** A stored block's children, slot by slot, in order. */
function childrenOf(slots: unknown): unknown[] {
  if (!isPlainRecord(slots)) return [];
  return Object.values(slots).flatMap(children =>
    Array.isArray(children) ? (children as unknown[]) : []
  );
}

/**
 * What a list read as a visitor reads it says, where a visitor sees fewer
 * of its entries than the person editing: "Showing what visitors see: 4 of
 * 6 entries". Nothing where either count is not known, or nothing shrank.
 */
export function visitorListWords(
  own: ListEntryCount | undefined,
  seen: ListEntryCount | undefined
): string | undefined {
  if (own === undefined || seen === undefined || seen.shown >= own.shown) {
    return undefined;
  }
  const noun = own.shown === 1 ? "entry" : "entries";
  return `Showing what visitors see: ${String(seen.shown)} of ${String(own.shown)} ${noun}`;
}

/** A list's count, as the person editing reads it or as a visitor does. */
function countAs(
  props: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  userId: string | null,
  visitor: ListEntriesVisitor | undefined
): Promise<ListEntryCount | undefined> {
  const count =
    props.namedQuery === undefined || props.namedQuery === null
      ? canvasListReadsIn(locale, userId, visitor).count(props)
      : canvasNamedQueriesIn(locale, userId, visitor).count(props);
  // A count that can't be taken says nothing, as the inspector's does.
  return count.catch(() => undefined);
}

/**
 * The words each list read as a visitor wears, by its id, where a visitor
 * sees fewer of its entries: counted from the same reads the canvas draws
 * with, the person's own and the visitor's, so counting reads little anew.
 * Asked again only when what the lists store changes.
 */
function useVisitorListNotes(
  asVisitor: VisitorLists | undefined,
  locale: string | undefined,
  userId: string | null
): ReadonlyMap<string, string> | undefined {
  const lists = useMemo(
    () =>
      JSON.stringify(
        asVisitor === undefined ? [] : drawnListsOf(asVisitor.nodes)
      ),
    [asVisitor]
  );
  const collection = asVisitor?.visitor.collection;
  const id = asVisitor?.visitor.id;
  const key = JSON.stringify([lists, locale ?? "", userId, collection, id]);
  const [found, setFound] = useState<{
    readonly key: string;
    readonly notes: ReadonlyMap<string, string>;
  }>();
  useEffect(() => {
    if (collection === undefined || id === undefined) return;
    const drawn = JSON.parse(lists) as DrawnList[];
    if (drawn.length === 0) return;
    let live = true;
    const visitor = { collection, id };
    void Promise.all(
      drawn.map(async list => {
        const [own, seen] = await Promise.all([
          countAs(list.props, locale, userId, undefined),
          countAs(list.props, locale, userId, visitor),
        ]);
        return [list.id, visitorListWords(own, seen)] as const;
      })
    ).then(counted => {
      if (!live) return;
      const notes = new Map<string, string>();
      for (const [list, words] of counted) {
        if (words !== undefined) notes.set(list, words);
      }
      setFound({ key, notes });
    });
    return () => {
      live = false;
    };
  }, [key, lists, locale, userId, collection, id]);
  return found?.key === key && found.notes.size > 0 ? found.notes : undefined;
}

/** Where a page link points on the canvas: an anchor naming the page. */
function canvasPageHref(page: number): string {
  return `#page-${String(page)}`;
}

/** How long the canvas waits before asking again for queries it could not read. */
const RETRY_FIRST_MS = 2000;
/** The longest it waits between asks, however many have failed. */
const RETRY_MOST_MS = 60_000;

/** The wait before ask number `attempt` (from 1), doubling to its cap. */
export function namedHostRetryDelay(attempt: number): number {
  return Math.min(
    RETRY_FIRST_MS * 2 ** Math.max(0, attempt - 1),
    RETRY_MOST_MS
  );
}

/**
 * The canvas's host for named queries in `locale`, once the site's queries
 * are read; `undefined` until then, so a list whose source is one draws its
 * template rather than a failure. A read that fails is asked again, after a
 * wait that grows to a cap, so one failed request never leaves the canvas
 * without its queries for the rest of the session.
 */
function useCanvasNamedHost(
  locale: string | undefined,
  userId: string | null,
  visitor: ListEntriesVisitor | undefined
): NamedQueryHost | undefined {
  const [found, setFound] = useState<{
    readonly locale: string | undefined;
    readonly userId: string | null;
    readonly visitorKey: string | undefined;
    readonly host: NamedQueryHost;
  }>();
  // The visitor by its parts, so a new object naming the same document asks
  // for nothing again.
  const visitorCollection = visitor?.collection;
  const visitorId = visitor?.id;
  const visitorKey =
    visitorCollection === undefined || visitorId === undefined
      ? undefined
      : JSON.stringify([visitorCollection, visitorId]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    canvasNamedQueriesIn(
      locale,
      userId,
      visitorCollection === undefined || visitorId === undefined
        ? undefined
        : { collection: visitorCollection, id: visitorId }
    )
      .host()
      .then(
        host => {
          if (live) setFound({ locale, userId, visitorKey, host });
        },
        () => {
          // The shared read keeps no failure, so the next ask reads again.
          if (!live) return;
          retry = setTimeout(
            () => setAttempt(count => count + 1),
            namedHostRetryDelay(attempt + 1)
          );
        }
      );
    return () => {
      live = false;
      if (retry !== undefined) clearTimeout(retry);
    };
  }, [locale, userId, visitorCollection, visitorId, visitorKey, attempt]);
  // The host for THIS person, language and visitor only, so one never draws
  // another's.
  return found !== undefined &&
    found.locale === locale &&
    found.userId === userId &&
    found.visitorKey === visitorKey
    ? found.host
    : undefined;
}
