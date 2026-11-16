/**
 * The change check behind the canvas's kept reads: one mark of when each
 * source the editor's canvas reads last changed, AS THE PERSON EDITING may
 * read it.
 *
 * The canvas keeps what it reads (its bindings' entry and Singles, its lists'
 * rows) for as long as what it asks stays the same. For saves made elsewhere,
 * it asks this at most once a minute while its tab is visible, and once on
 * coming back to it; a different mark drops what it kept. One cheap question
 * rather than reading every source again: per source, its own last save, and
 * for a listed collection its newest save and how many entries it holds, so
 * an entry added or removed changes the mark too.
 *
 * Its own route rather than riding on the document lock's renewal, which
 * belongs to core and carries no plugin's data.
 *
 * ## Who may ask
 *
 * Every source is read through core's one access gate as the caller
 * (`readingAsUser`, `overrideAccess: false`), drafts included, as the canvas
 * reads them; nothing is checked here. A source the caller may not read gives
 * a fixed mark, so it neither leaks when it changed nor reads as changing.
 * The answer is one person's, so the route is `noStore`.
 *
 * @module canvas-sources-changed-route
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondDoc } from "nextly";
import { z } from "nextly/zod";

import {
  CANVAS_SOURCES_CHANGED_ROUTE_PATH,
  type CanvasSourcesChangedRequest,
  type CanvasSourcesChangedResponse,
} from "./canvas-bindings-contract";
import { readBodyWith } from "./composition-route-kit";
import { readingAsUser } from "./library-route";

/** A collection's or a Single's slug. */
const SLUG = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** A field name a binding follows: no paths, operators or quoting. */
const NAME = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

/**
 * The most Singles, collections or followed fields one check names: the
 * bindings route's own bound, so every ask it takes can be checked too.
 */
const MOST_SOURCES = 200;

const CanvasSourcesChangedBody = z.object({
  source: z.object({
    kind: z.enum(["collection", "single"]),
    slug: SLUG,
    id: z.string().min(1).max(128).optional(),
  }),
  singles: z.array(SLUG).max(MOST_SOURCES),
  lists: z.array(SLUG).max(MOST_SOURCES),
  follows: z
    .object({
      entry: z.array(NAME).max(MOST_SOURCES),
      singles: z
        .record(SLUG, z.array(NAME).max(MOST_SOURCES))
        .refine(singles => Object.keys(singles).length <= MOST_SOURCES, {
          message: `At most ${String(MOST_SOURCES)} Singles.`,
        }),
    })
    .optional(),
  locale: z.string().min(1).max(35).optional(),
});

/** The mark of a source the caller may not read, or one that is gone. */
const UNREAD = "-";

/** How the check reads each source, as the caller. */
export interface SourcesChangedReads {
  /**
   * A collection entry, or nothing; at `depth` 1 with the entries its
   * relations name read in place of their ids.
   */
  entry(collection: string, id: string, depth: 0 | 1): Promise<unknown>;
  /** A Single's document, or nothing; `depth` as for an entry. */
  single(slug: string, depth: 0 | 1): Promise<unknown>;
  /**
   * A collection's most recently saved entries, newest first and at most
   * {@link NEWEST_MARKED} of them, and how many entries it holds.
   */
  collection(slug: string): Promise<{
    readonly newest: readonly unknown[];
    readonly total: number;
  }>;
}

/**
 * How many of a listed collection's most recently saved entries its mark
 * names. More than one, because a version counts per entry: an edit to an
 * entry that was not the newest makes it the newest, which a mark of the
 * newest entry's version alone could read as no change when the two held
 * the same count. Twenty, so saves landing in the same second, which SQLite
 * stores save times to, still fall inside what the mark names.
 */
export const NEWEST_MARKED = 20;

/**
 * A read's mark, or the unread one when the caller may not read the source
 * or it is gone. Any other failure is thrown, so the check answers an error
 * and the canvas keeps what it has, rather than a mark that would change
 * once and change back.
 */
async function markOf(read: () => Promise<string>): Promise<string> {
  try {
    return await read();
  } catch (error) {
    if (
      NextlyError.isForbidden(error) ||
      NextlyError.isNotFound(error) ||
      NextlyError.isAuthRequired(error)
    ) {
      return UNREAD;
    }
    throw error;
  }
}

/** A save time as a mark: its JSON, so a Date and its string agree. */
function savedMark(value: unknown): string {
  return value === undefined || value === null ? UNREAD : JSON.stringify(value);
}

/** A read entry's mark: its id and its last save. */
function entryMark(found: unknown): string {
  return `${idOf(found)}:${savedMark(updatedAtOf(found))}`;
}

/**
 * A read document's mark: its last save, and for each relation `followed`,
 * the entries it names as they were read. An entry the caller may not read
 * is named by its id alone, so it neither leaks when it changed nor reads as
 * changing.
 */
function documentMark(found: unknown, followed: readonly string[]): string {
  const own = savedMark(updatedAtOf(found));
  if (followed.length === 0 || typeof found !== "object" || found === null) {
    return own;
  }
  const fields = found as Record<string, unknown>;
  const related = followed.map(field => {
    const value = fields[field];
    const named = (Array.isArray(value) ? value : [value]).map(item =>
      typeof item === "object" && item !== null
        ? entryMark(item)
        : String(item ?? UNREAD)
    );
    return `${field}[${named.sort().join(",")}]`;
  });
  return `${own}>${related.join(";")}`;
}

/** The mark of every source `ask` names, in a fixed order. */
export async function sourcesChangedStamp(
  ask: CanvasSourcesChangedRequest,
  reads: SourcesChangedReads
): Promise<string> {
  const { source } = ask;
  const entryFollows = ask.follows?.entry ?? [];
  const followsOf = (slug: string) => ask.follows?.singles[slug] ?? [];
  const depthFor = (followed: readonly string[]) =>
    followed.length === 0 ? 0 : 1;
  const sourceFollows =
    source.kind === "single" ? followsOf(source.slug) : entryFollows;
  const own =
    source.kind === "single"
      ? markOf(async () =>
          documentMark(
            await reads.single(source.slug, depthFor(sourceFollows)),
            sourceFollows
          )
        )
      : source.id === undefined
        ? Promise.resolve(UNREAD)
        : markOf(async () =>
            documentMark(
              await reads.entry(
                source.slug,
                source.id as string,
                depthFor(sourceFollows)
              ),
              sourceFollows
            )
          );
  const parts = await Promise.all([
    own.then(mark => `${source.kind}:${source.slug}=${mark}`),
    ...[...new Set(ask.singles)]
      .sort()
      .map(slug =>
        markOf(async () =>
          documentMark(
            await reads.single(slug, depthFor(followsOf(slug))),
            followsOf(slug)
          )
        ).then(mark => `single:${slug}=${mark}`)
      ),
    ...[...new Set(ask.lists)].sort().map(slug =>
      markOf(async () => {
        const { newest, total } = await reads.collection(slug);
        // By id, so two entries saved in the same second, which a store to
        // the second may hand back in either order, mark the same way.
        const entries = newest.map(entryMark).sort();
        return `${String(total)}@${entries.join(",")}`;
      }).then(mark => `list:${slug}=${mark}`)
    ),
  ]);
  return parts.join("|");
}

/**
 * What marks a read document's last save: its version, which every save
 * changes, else its save time; nothing for no document. The version, because
 * a save time stored to the second would miss a second save within it.
 */
function updatedAtOf(found: unknown): unknown {
  if (typeof found !== "object" || found === null) return undefined;
  const { _rev, updatedAt } = found as { _rev?: unknown; updatedAt?: unknown };
  return _rev ?? updatedAt;
}

/** A read entry's id, as a mark names it. */
function idOf(found: unknown): string {
  if (typeof found !== "object" || found === null) return UNREAD;
  const { id } = found as { id?: unknown };
  return typeof id === "string" || typeof id === "number" ? String(id) : UNREAD;
}

/**
 * The most entries a listed collection's mark names when entries tie at the
 * boundary of its newest {@link NEWEST_MARKED}: every entry saved in the
 * same instant as the last one named, up to this many.
 */
const MOST_TIED = 200;

/** A save time as a filter value. */
function asFilterValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The sources read through the Direct API as the caller, drafts included,
 * in `locale` where one is edited.
 */
async function directSourcesChangedReads(
  ctx: PluginRouteContext,
  locale: string | undefined
): Promise<SourcesChangedReads> {
  const { requireNextly } = await import("nextly/runtime");
  const nextly = requireNextly();
  const person = await readingAsUser(ctx);
  // As the canvas reads its sources: every state, the working draft in place
  // of the live row, judged as the person.
  const asEditing = {
    ...person,
    status: "all" as const,
    draft: true,
    ...(locale === undefined ? {} : { locale }),
  };
  return {
    entry: async (collection, id, depth) =>
      nextly.findByID({ collection, id, depth, ...asEditing }),
    single: async (slug, depth) =>
      nextly.findSingle({ slug, depth, ...asEditing }),
    collection: async slug => {
      const newestFirst = { sort: ["-updatedAt", "id"], depth: 0 as const };
      const found = await nextly.find({
        collection: slug,
        limit: NEWEST_MARKED,
        ...newestFirst,
        ...asEditing,
      });
      const last = found.items.at(-1) as { updatedAt?: unknown } | undefined;
      if (found.items.length < NEWEST_MARKED || last?.updatedAt == null) {
        return { newest: found.items, total: found.meta.total };
      }
      // Every entry saved in the same instant as the last one named, too:
      // saves in one second tie where save times are kept to the second,
      // and one past the boundary would otherwise go unseen.
      const tied = await nextly.find({
        collection: slug,
        where: {
          updatedAt: { greater_than_equal: asFilterValue(last.updatedAt) },
        },
        limit: MOST_TIED,
        ...newestFirst,
        ...asEditing,
      });
      return { newest: tied.items, total: found.meta.total };
    },
  };
}

/**
 * The route the editor's change check asks. A POST because an ask carries
 * what to look at, never because it writes; `noStore` because its answer is
 * one person's.
 */
export function canvasSourcesChangedRoute(): {
  method: "POST";
  checksAccess: true;
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: CANVAS_SOURCES_CHANGED_ROUTE_PATH,
    checksAccess: true, // Each source is read through the gate as the caller.
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(
        req,
        CanvasSourcesChangedBody,
        "canvas sources changed"
      );
      const answer: CanvasSourcesChangedResponse = {
        stamp: await sourcesChangedStamp(
          body,
          await directSourcesChangedReads(ctx, body.locale)
        ),
      };
      return respondDoc(answer);
    },
  };
}
