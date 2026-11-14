/**
 * The pages the usage index does not cover, and whether a variable is used on
 * any of them, read from their stored text.
 *
 * Where the index cannot become whole, a page too large to read in full (an
 * undetermined document) or content it cannot address (a blocks field nested
 * under a named group) keeps every count a floor, so a removal could not tell
 * an unused variable from a used one and refused every one. The index answers
 * exactly for every page it does cover. For the pages it does not, this reads
 * their stored documents and looks for the variable's reference as written
 * (`tokenRefText`): no walk of the blocks, so neither the walk bound that made
 * a page undetermined nor a field the walk cannot address hides one.
 *
 * Which pages those are is the index's own record, never a scan of the site:
 * its undetermined marker rows name each page it could not read whole, and the
 * survey the backfill walks names each collection and Single holding a field
 * it cannot address, every document of which it covers only in part.
 *
 * Read-only, and bounded: a page not read before the time is spent, or one that
 * cannot be read, is answered as such, never guessed.
 *
 * @module uncovered-pages
 */
import { tokenRefText } from "@nextlyhq/blocks-engine";

import type { UnaddressableType } from "./usage-backfill-wiring";
import type { UsageRowReader } from "./usage-count";
import type { UsageScope } from "./usage-index";

/** One page the index does not cover. */
export interface UncoveredPage {
  readonly scope: UsageScope;
  /** The collection's or Single's slug. */
  readonly entity: string;
  /** The document's id; empty for a Single. */
  readonly entityKey: string;
}

/** The pages the index does not cover, and their stored forms. */
export interface UncoveredPages {
  /** Each page once, read as it is asked for, so a time box can stop it. */
  list(): AsyncIterable<UncoveredPage>;
  /** Every stored form of a page, whole: each language, published and draft. */
  forms(page: UncoveredPage): Promise<readonly unknown[]>;
}

/** What the uncovered pages say of the variables asked about. */
export type UncoveredOutcome =
  /** None of them uses any of the variables. */
  | { readonly kind: "clear" }
  /** The pages using each variable found on one, by identity. */
  | {
      readonly kind: "used";
      readonly uses: ReadonlyMap<string, readonly UncoveredPage[]>;
    }
  /** The first page not read: the time ran out, or it could not be read. */
  | { readonly kind: "unread"; readonly page: UncoveredPage }
  /** The time ran out while the pages were still being listed. */
  | { readonly kind: "unlisted" };

/**
 * Whether any of the variables `identities` is used on a page the index does
 * not cover, reading each such page until `deadline`.
 *
 * Every read is held to the time left, not only checked between pages: a read
 * that stalls (a slow hook on a page, a listing that does not return) would
 * otherwise keep the removal waiting past its box. A read still running when
 * the box ends is left to finish unobserved; it writes nothing.
 */
export async function variablesOnUncoveredPages(args: {
  identities: readonly string[];
  pages: UncoveredPages;
  /** When the read must stop, by `now`. */
  deadline: number;
  now?: () => number;
}): Promise<UncoveredOutcome> {
  const now = args.now ?? (() => Date.now());
  const left = () => args.deadline - now();
  const needles = args.identities.map(
    identity => [identity, tokenRefText(identity)] as const
  );
  const uses = new Map<string, UncoveredPage[]>();
  const listing = args.pages.list()[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await within(listing.next(), left());
      if (next === TIMED_OUT) return { kind: "unlisted" };
      if (next.done === true) break;
      const page = next.value;
      const text = await pageText(args.pages, page, left);
      if (text === undefined) return { kind: "unread", page };
      for (const [identity, needle] of needles) {
        if (!text.includes(needle)) continue;
        uses.set(identity, [...(uses.get(identity) ?? []), page]);
      }
    }
  } finally {
    // Stopped early, the listing is closed as a `for await` would close it.
    // One stalled mid-read closes once that read returns, if ever, so the
    // close is not awaited, and its failure has no one left to answer.
    listing.return?.().catch(() => undefined);
  }
  return uses.size === 0 ? { kind: "clear" } : { kind: "used", uses };
}

/**
 * A page's stored forms as one text, or nothing where they were not read
 * whole in the time `left`: the time was already spent, the read failed, or it
 * did not finish first.
 */
async function pageText(
  pages: UncoveredPages,
  page: UncoveredPage,
  left: () => number
): Promise<string | undefined> {
  if (left() <= 0) return undefined;
  let forms: readonly unknown[] | typeof TIMED_OUT;
  try {
    forms = await within(pages.forms(page), left());
  } catch {
    return undefined;
  }
  // The stored forms as the database holds them, serialized as the
  // reference's spelling is derived: JSON.stringify, no whitespace.
  return forms === TIMED_OUT ? undefined : JSON.stringify(forms);
}

/** What a read held to the time box answers when the time ran out first. */
const TIMED_OUT = Symbol("timed out");

/**
 * `read`'s answer, or {@link TIMED_OUT} once `ms` have passed first. The
 * timer is cleared whichever wins, so none outlives the answer, and a read
 * that fails after losing has its failure taken by the race, never left
 * unhandled.
 */
async function within<T>(
  read: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  try {
    return await Promise.race([read, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Rows of the index's own table one read of its markers takes. */
const MARKER_PAGES_MAX = 10_000;

/** Where the uncovered pages are read from. */
interface UncoveredSources {
  /** The variable index's rows, read a page at a time. */
  rows: UsageRowReader;
  /** The predicate naming its undetermined markers. */
  markers: Record<string, { equals: string }>;
  /** The types holding a blocks field the index cannot address. */
  unaddressable: () => Promise<readonly UnaddressableType[]>;
  /** The ids of a collection's documents after `after`, a page at a time. */
  idsAfter: (
    collection: string,
    after: string | undefined
  ) => Promise<{ ids: readonly string[]; hasNext: boolean }>;
  forms: (page: UncoveredPage) => Promise<readonly unknown[]>;
}

/**
 * The uncovered pages from the index's own records: the pages its marker rows
 * name first, then every document of each type its survey cannot address.
 * Each page is listed once, as a page both undetermined and in such a type is
 * one page.
 */
export function uncoveredPagesFrom(deps: UncoveredSources): UncoveredPages {
  return {
    forms: deps.forms,
    list: async function* () {
      const seen = new Set<string>();
      for (const pages of [markedPages(deps), unaddressablePages(deps)]) {
        for await (const page of pages) {
          const key = JSON.stringify([page.scope, page.entity, page.entityKey]);
          if (seen.has(key)) continue;
          seen.add(key);
          yield page;
        }
      }
    },
  };
}

/** The pages the index's undetermined markers name, a row page at a time. */
async function* markedPages(
  deps: Pick<UncoveredSources, "rows" | "markers">
): AsyncGenerator<UncoveredPage> {
  let after: string | undefined;
  for (let page = 1; page <= MARKER_PAGES_MAX; page += 1) {
    const found = await deps.rows({ where: deps.markers, page, after });
    const rows = found.items as Array<Record<string, unknown>>;
    for (const row of rows) yield markedPage(row);
    if (!found.hasNext) return;
    after = nextAfter(rows.at(-1));
  }
}

/** The page one marker row names. */
function markedPage(row: Record<string, unknown>): UncoveredPage {
  return {
    scope: row.scope === "single" ? "single" : "collection",
    entity: typeof row.entity === "string" ? row.entity : "",
    entityKey: typeof row.entityKey === "string" ? row.entityKey : "",
  };
}

/** Where the next page of marker rows starts: after the last row's id. */
function nextAfter(last: { id?: unknown } | undefined): string {
  if (typeof last?.id !== "string") {
    // Pages run by id: without the last id, the next page cannot be asked
    // for, and stopping here would leave pages out unread.
    throw new Error(
      "[page-builder] the usage index's marker rows could not be paged past a row without an id"
    );
  }
  return last.id;
}

/** Every document of each type holding a field the index cannot address. */
async function* unaddressablePages(
  deps: Pick<UncoveredSources, "unaddressable" | "idsAfter">
): AsyncGenerator<UncoveredPage> {
  for (const type of await deps.unaddressable()) {
    if (type.scope === "single") {
      yield { scope: "single", entity: type.slug, entityKey: "" };
      continue;
    }
    let cursor: string | undefined;
    for (;;) {
      const found = await deps.idsAfter(type.slug, cursor);
      for (const id of found.ids) {
        yield { scope: "collection", entity: type.slug, entityKey: id };
      }
      if (!found.hasNext || found.ids.length === 0) break;
      cursor = found.ids.at(-1);
    }
  }
}
