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
 * the first query already judged.
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
}

/** What one scan found. */
export interface ReferenceScan {
  /** One entry per page, in the order found. */
  readonly references: readonly PageReference[];
  /** False when the budget ran out before every page was read. */
  readonly complete: boolean;
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
): Promise<{ id: string; title: string }[]> {
  const naming: { id: string; title: string }[] = [];
  for (let at = 0; at < pages.length; at += DRAFT_READS_AT_ONCE) {
    const batch = pages.slice(at, at + DRAFT_READS_AT_ONCE);
    const drafts = await Promise.all(
      batch.map(page =>
        nextly.findByID({
          collection,
          id: page.id,
          draft: true,
          depth: 0,
          overrideAccess: true,
        })
      )
    );
    drafts.forEach((draft, index) => {
      const page = batch[index];
      if (
        page !== undefined &&
        isWorkingDraft(draft) &&
        relationId(draft.layout) === layoutId
      ) {
        naming.push(page);
      }
    });
  }
  return naming;
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
}): Promise<ReferenceScan> {
  const { nextly, pages, layoutId } = args;
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
    onPage: (items, { hasNext }) => {
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
  if (!rowsDone) return { references: [...found.values()], complete: false };

  // Every published page's working draft, read one at a time.
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
      const toRead: { id: string; title: string }[] = [];
      let unread = 0;
      for (const row of items) {
        if (spent >= budget) {
          unread += 1;
          continue;
        }
        spent += 1;
        const id = relationId(row);
        if (id !== null && !found.has(id)) {
          toRead.push({ id, title: textOf(row, "title") });
        }
      }
      for (const draft of await workingDraftsNaming(
        nextly,
        pages,
        toRead,
        layoutId
      )) {
        found.set(draft.id, { ...draft, place: "draft" });
      }
      // Incomplete only when a row went unread: on this page past the budget,
      // or on a page after it.
      return unread > 0 || (spent >= budget && hasNext) ? "stop" : undefined;
    },
  });
  return { references: [...found.values()], complete: draftsDone };
}

/**
 * How many ids one readable-pages lookup asks about: under the 500 rows a
 * collection read answers, and well under SQLite's 999 bound parameters.
 */
const READABLE_CHUNK = 200;

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
  for (let at = 0; at < ids.length; at += READABLE_CHUNK) {
    const chunk = await readableIn(args, ids.slice(at, at + READABLE_CHUNK));
    for (const [id, title] of chunk) titles.set(id, title);
  }
  const readable: { id: string; title: string }[] = [];
  for (const reference of args.references) {
    const title = titles.get(reference.id);
    if (typeof title === "string") readable.push({ id: reference.id, title });
  }
  return { readable, unreadable: ids.length - readable.length };
}
