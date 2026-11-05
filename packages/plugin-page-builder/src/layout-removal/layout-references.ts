/**
 * Which pages name a Layout: the check a removal makes before it marks the
 * Layout, and again under its fence before it removes it.
 *
 * A page names a Layout in three places, and each needs its own read:
 *
 * - its live row, when it is published;
 * - its only row, when it was never published or was unpublished;
 * - its working draft, the edit a published page holds beside its live row.
 *
 * The first two are one query on the `layout` column, whatever the state. The
 * third cannot be listed by field: a working draft is read only by id, with
 * `draft: true`. So every published page is read once more by id, one at a
 * time, and the answer counts only when it IS a working draft
 * (`_isWorkingDraft`); without one the read falls back to the live row, which
 * the first query already judged. A page whose live row names the Layout is
 * read too: its working draft naming it as well is a second place, which a
 * removal that moves its pages has to clear ({@link namesItOffTheLiveRow}).
 *
 * ## By id, never by offset
 *
 * Both listings walk by an id cursor ({@link byIdCursor}), so a page deleted
 * while the scan runs cannot shift a later page out of it.
 *
 * ## Bounded
 *
 * Every row listed and every draft read spends one of a fixed budget of page
 * reads. Past it the scan stops and says it is incomplete, and the removal is
 * refused: an unfinished scan that found nothing is not "nothing uses it".
 *
 * Reads run as the system, so a page the remover may not read still stops the
 * removal. Which of them the remover may see is asked separately
 * ({@link readableTitles}), so a refusal names only pages they may read, by
 * the title their own read answers.
 *
 * @module layout-removal/layout-references
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import { relationId } from "../default-layout/store";
import { walkPages, type StorePage } from "../paged-walk";

/** How many page reads one scan may spend. */
const PAGE_READ_BUDGET = 2000;

/** How many pages one listing read asks for. */
const PAGE_SIZE = 100;

/** The Direct API reads the scan makes. */
export type ReferenceReads = Pick<Nextly, "find" | "findByID">;

/** A listing's filter, as the Direct API takes it. */
type PageWhere = NonNullable<Parameters<ReferenceReads["find"]>[0]["where"]>;

/** Where a page names the Layout. */
export type ReferencePlace = "live" | "unpublished" | "draft";

/** One page naming the Layout. */
export interface PageReference {
  readonly id: string;
  readonly title: string;
  readonly place: ReferencePlace;
  /** On a `live` reference: the page's working draft names the Layout too. */
  readonly draftToo?: true;
}

/**
 * Whether a page names the Layout somewhere other than its live row: its only
 * row, or its working draft. Those are what a removal that moves its pages
 * clears; a live row is left, and draws the site default once the Layout is
 * gone.
 */
export function namesItOffTheLiveRow(reference: PageReference): boolean {
  return reference.place !== "live" || reference.draftToo === true;
}

/** What one scan found. */
export interface ReferenceScan {
  /** One entry per page still there, in the order found. */
  readonly references: readonly PageReference[];
  /**
   * False when the budget ran out before every page was read, or a page still
   * there could not be read.
   */
  readonly complete: boolean;
  /** The pages still there whose working draft could not be read. */
  readonly unread: readonly string[];
}

/**
 * Whether a scan stopped only because its budget ran out: incomplete, with
 * every page it reached read. Reading again from the first page with the same
 * budget stops at the same place, so a retry cannot finish it.
 */
export function stoppedAtBudget(scan: ReferenceScan): boolean {
  return !scan.complete && scan.unread.length === 0;
}

/** A row's string field, or the empty string. */
function textOf(row: unknown, key: string): string {
  if (typeof row !== "object" || row === null) return "";
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/** Whether a by-id read with `draft: true` answered a working draft. */
function isWorkingDraft(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { _isWorkingDraft?: unknown })._isWorkingDraft === true
  );
}

/**
 * Whether page `id` is confirmed gone: listed again as the system, asking for
 * nothing but its id, and not there. A check that itself fails confirms
 * nothing.
 */
export async function confirmedGone(
  nextly: Pick<Nextly, "find">,
  pages: string,
  id: string
): Promise<boolean> {
  try {
    return !(await existingIds(nextly, pages, [id])).has(id);
  } catch {
    return false;
  }
}

/**
 * Which of `ids` are pages that exist now, listed as the system asking for
 * nothing but their ids, in chunks ({@link idChunks}). The one existence check
 * a scan and a by-id read both use. Raises when a listing fails.
 */
async function existingIds(
  nextly: Pick<Nextly, "find">,
  pages: string,
  ids: readonly string[]
): Promise<Set<string>> {
  const there = new Set<string>();
  for (const chunk of idChunks(ids)) {
    const found = await nextly.find({
      collection: pages,
      where: { id: { in: chunk } },
      status: "all",
      limit: chunk.length,
      depth: 0,
      select: { id: true },
      overrideAccess: true,
    });
    for (const row of found.items) {
      const id = relationId(row);
      if (id !== null) there.add(id);
    }
  }
  return there;
}

/**
 * The pages `found` that still exist: a page listed as naming the Layout and
 * deleted since names nothing. When the check itself fails every page is kept,
 * so a fault never lets a removal through.
 */
async function stillThere(
  nextly: Pick<Nextly, "find">,
  pages: string,
  found: ReadonlyMap<string, PageReference>
): Promise<PageReference[]> {
  const references = [...found.values()];
  if (references.length === 0) return references;
  try {
    const there = await existingIds(
      nextly,
      pages,
      references.map(reference => reference.id)
    );
    return references.filter(reference => there.has(reference.id));
  } catch {
    return references;
  }
}

/**
 * `read`, or `null` when the page it reads was deleted in the meantime: a page
 * listed by one read can be gone by the next. A not-found answer can also come
 * from the page's own read hooks, about something the page relates to, so it
 * reads as nothing only once `gone` confirms the page itself is absent; any
 * other answer, that one included, is raised, so a fault is never taken for an
 * absent page.
 */
export async function unlessGone<T>(
  read: Promise<T>,
  gone: () => Promise<boolean>
): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND") && (await gone())) return null;
    throw error;
  }
}

/** A page whose draft read failed though the page is still there. */
const UNCHECKED = Symbol("unchecked");

/**
 * How many working drafts are read at once. A draft is read only by id, so a
 * scan makes one read per published page; they go in batches this size rather
 * than one after another, which bounds both the scan's time and the
 * connections it holds at once.
 */
const DRAFT_READS_AT_ONCE = 10;

/**
 * Which of `pages` have a working draft naming `layoutId`, read in batches of
 * {@link DRAFT_READS_AT_ONCE}.
 */
async function workingDraftsNaming(
  nextly: ReferenceReads,
  collection: string,
  pages: readonly { id: string; title: string }[],
  layoutId: string
): Promise<{ naming: { id: string; title: string }[]; unread: string[] }> {
  const naming: { id: string; title: string }[] = [];
  const unread: string[] = [];
  for (let at = 0; at < pages.length; at += DRAFT_READS_AT_ONCE) {
    const batch = pages.slice(at, at + DRAFT_READS_AT_ONCE);
    const drafts = await Promise.all(
      batch.map(page =>
        unlessGone(
          nextly.findByID({
            collection,
            id: page.id,
            draft: true,
            depth: 0,
            overrideAccess: true,
          }),
          () => confirmedGone(nextly, collection, page.id)
        ).catch((error: unknown) => {
          // Not found, yet still there: unread, so the scan cannot say
          // nothing names the Layout.
          if (NextlyError.isCode(error, "NOT_FOUND")) return UNCHECKED;
          throw error;
        })
      )
    );
    drafts.forEach((draft, index) => {
      const page = batch[index];
      if (draft === UNCHECKED && page !== undefined) unread.push(page.id);
      if (
        page !== undefined &&
        isWorkingDraft(draft) &&
        relationId(draft.layout) === layoutId
      ) {
        naming.push(page);
      }
    });
  }
  return { naming, unread };
}

/**
 * A page reader that walks by id rather than by offset: every read asks for
 * the first page of the rows after the last id it saw, sorted by id. A page
 * deleted behind the cursor cannot shift a later row past it, as it would past
 * an offset.
 */
function byIdCursor(
  read: (where: PageWhere) => Promise<StorePage>,
  where: PageWhere
): () => Promise<StorePage> {
  let after: string | null = null;
  return async () => {
    const answered = await read(
      after === null ? where : { ...where, id: { greater_than: after } }
    );
    for (const row of answered.items) {
      const id = relationId(row);
      if (id !== null) after = id;
    }
    return answered;
  };
}

/** Scan the pages collection for every page naming `layoutId`. */
export async function scanLayoutReferences(args: {
  nextly: ReferenceReads;
  pages: string;
  layoutId: string;
  budget?: number;
  /** Called after each listing page, so a long scan can keep its lease. */
  onProgress?: () => Promise<void>;
}): Promise<ReferenceScan> {
  const { nextly, pages, layoutId } = args;
  const progress = args.onProgress ?? (async () => {});
  const budget = args.budget ?? PAGE_READ_BUDGET;
  const found = new Map<string, PageReference>();
  let spent = 0;
  // Enough pages for the budget to run out first: each page read spends one
  // per row, so this bound is never what stops the walk.
  const maxPages = Math.ceil(budget / PAGE_SIZE) + 1;

  // The rows naming it, published or not.
  const rowsDone = await walkPages({
    describe: `the pages naming Layout ${layoutId}`,
    maxPages,
    fetchPage: byIdCursor(
      where =>
        nextly.find({
          collection: pages,
          where,
          status: "all",
          sort: "id",
          limit: PAGE_SIZE,
          depth: 0,
          select: { title: true, status: true },
          overrideAccess: true,
        }),
      { layout: { equals: layoutId } }
    ),
    onPage: async (items, { hasNext }) => {
      await progress();
      for (const row of items) {
        spent += 1;
        const id = relationId(row);
        if (id === null) continue;
        found.set(id, {
          id,
          title: textOf(row, "title"),
          place: textOf(row, "status") === "published" ? "live" : "unpublished",
        });
      }
      // Stopped only when the budget is spent AND rows remain: a walk that
      // ends exactly on its budget read every row.
      return spent >= budget && hasNext ? "stop" : undefined;
    },
  });
  const unreadIds: string[] = [];
  if (!rowsDone) {
    return {
      references: await stillThere(nextly, pages, found),
      complete: false,
      unread: unreadIds,
    };
  }

  // Every published page's working draft, read one at a time, those whose
  // live row names the Layout included.
  const draftsDone = await walkPages({
    describe: "the published pages",
    maxPages,
    fetchPage: byIdCursor(
      where =>
        nextly.find({
          collection: pages,
          where,
          status: "published",
          sort: "id",
          limit: PAGE_SIZE,
          depth: 0,
          select: { title: true },
          overrideAccess: true,
        }),
      {}
    ),
    onPage: async (items, { hasNext }) => {
      await progress();
      const toRead: { id: string; title: string }[] = [];
      let unread = 0;
      for (const row of items) {
        if (spent >= budget) {
          unread += 1;
          continue;
        }
        spent += 1;
        const id = relationId(row);
        if (id !== null) toRead.push({ id, title: textOf(row, "title") });
      }
      const drafts = await workingDraftsNaming(nextly, pages, toRead, layoutId);
      for (const draft of drafts.naming) {
        const live = found.get(draft.id);
        found.set(
          draft.id,
          live === undefined
            ? { ...draft, place: "draft" }
            : { ...live, draftToo: true }
        );
      }
      unreadIds.push(...drafts.unread);
      // Incomplete when a row went unread: on this page past the budget, on a
      // page after it, or a page still there whose draft could not be read.
      return drafts.unread.length > 0 ||
        unread > 0 ||
        (spent >= budget && hasNext)
        ? "stop"
        : undefined;
    },
  });
  return {
    references: await stillThere(nextly, pages, found),
    complete: draftsDone,
    unread: unreadIds,
  };
}

/**
 * How many ids one `in` lookup asks about: under the 500 rows a collection
 * read answers, and well under SQLite's 999 bound parameters.
 */
const ID_CHUNK = 200;

/** `ids` in chunks of {@link ID_CHUNK}, each small enough for one lookup. */
export function idChunks(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let at = 0; at < ids.length; at += ID_CHUNK) {
    chunks.push(ids.slice(at, at + ID_CHUNK));
  }
  return chunks;
}

/**
 * Which of `ids` the remover may read, as one query, each with the title that
 * read answers: `null` when a field rule hid the title from them.
 */
async function readableIn(
  args: { nextly: Pick<Nextly, "find">; pages: string; asPerson: PersonReads },
  ids: readonly string[]
): Promise<Map<string, string | null>> {
  const titles = new Map<string, string | null>();
  try {
    const answered = await args.nextly.find({
      collection: args.pages,
      where: { id: { in: [...ids] } },
      status: "all",
      limit: ids.length,
      depth: 0,
      select: { title: true },
      ...args.asPerson,
    });
    for (const row of answered.items) {
      const id = relationId(row);
      if (id === null) continue;
      const title = (row as { title?: unknown }).title;
      titles.set(id, typeof title === "string" ? title : null);
    }
  } catch {
    // A caller refused the collection outright reads none of them, and is
    // told only how many there are.
  }
  return titles;
}

/** How the remover reads: as themselves, never past their own access. */
export interface PersonReads {
  readonly overrideAccess: false;
  readonly user?: Parameters<Nextly["find"]>[0]["user"];
  readonly actor?: Parameters<Nextly["find"]>[0]["actor"];
}

/**
 * Which of `references` the remover may read, by id and title, read again as
 * them; the rest are only counted. The title is the one THAT read answers,
 * never the system scan's, so a page whose title a field rule hides from the
 * remover is counted rather than named. One query per chunk of ids.
 */
export async function readableTitles(args: {
  nextly: Pick<Nextly, "find">;
  pages: string;
  references: readonly PageReference[];
  asPerson: PersonReads;
}): Promise<{ readable: { id: string; title: string }[]; unreadable: number }> {
  const ids = args.references.map(reference => reference.id);
  if (ids.length === 0) return { readable: [], unreadable: 0 };
  const titles = new Map<string, string | null>();
  for (const chunk of idChunks(ids)) {
    for (const [id, title] of await readableIn(args, chunk)) {
      titles.set(id, title);
    }
  }
  const readable: { id: string; title: string }[] = [];
  for (const reference of args.references) {
    const title = titles.get(reference.id);
    if (typeof title === "string") readable.push({ id: reference.id, title });
  }
  return { readable, unreadable: ids.length - readable.length };
}
