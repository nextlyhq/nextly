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
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
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

/** The most Singles or collections one check names: more than a page reads. */
const MOST_SOURCES = 50;

const CanvasSourcesChangedBody = z.object({
  source: z.object({
    kind: z.enum(["collection", "single"]),
    slug: SLUG,
    id: z.string().min(1).max(128).optional(),
  }),
  singles: z.array(SLUG).max(MOST_SOURCES),
  lists: z.array(SLUG).max(MOST_SOURCES),
});

/** The mark of a source the caller may not read, or one that is gone. */
const UNREAD = "-";

/** How the check reads each source, as the caller. */
export interface SourcesChangedReads {
  /** A collection entry's last save, or nothing. */
  entry(collection: string, id: string): Promise<unknown>;
  /** A Single's last save, or nothing. */
  single(slug: string): Promise<unknown>;
  /** A collection's newest save and how many entries it holds. */
  collection(
    slug: string
  ): Promise<{ readonly latest: unknown; readonly total: number }>;
}

/** A read's mark, or the unread one when the read fails or is refused. */
async function markOf(read: () => Promise<string>): Promise<string> {
  try {
    return await read();
  } catch {
    return UNREAD;
  }
}

/** A save time as a mark: its JSON, so a Date and its string agree. */
function savedMark(value: unknown): string {
  return value === undefined || value === null ? UNREAD : JSON.stringify(value);
}

/** The mark of every source `ask` names, in a fixed order. */
export async function sourcesChangedStamp(
  ask: CanvasSourcesChangedRequest,
  reads: SourcesChangedReads
): Promise<string> {
  const { source } = ask;
  const own =
    source.kind === "single"
      ? markOf(async () => savedMark(await reads.single(source.slug)))
      : source.id === undefined
        ? Promise.resolve(UNREAD)
        : markOf(async () =>
            savedMark(await reads.entry(source.slug, source.id as string))
          );
  const parts = await Promise.all([
    own.then(mark => `${source.kind}:${source.slug}=${mark}`),
    ...[...new Set(ask.singles)]
      .sort()
      .map(slug =>
        markOf(async () => savedMark(await reads.single(slug))).then(
          mark => `single:${slug}=${mark}`
        )
      ),
    ...[...new Set(ask.lists)].sort().map(slug =>
      markOf(async () => {
        const { latest, total } = await reads.collection(slug);
        return `${String(total)}@${savedMark(latest)}`;
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

/** The sources read through the Direct API as the caller, drafts included. */
async function directSourcesChangedReads(
  ctx: PluginRouteContext
): Promise<SourcesChangedReads> {
  const { requireNextly } = await import("nextly/runtime");
  const nextly = requireNextly();
  const person = await readingAsUser(ctx);
  // As the canvas reads its sources: every state, the working draft in place
  // of the live row, judged as the person.
  const asEditing = { ...person, status: "all" as const, draft: true };
  return {
    entry: async (collection, id) =>
      updatedAtOf(
        await nextly.findByID({ collection, id, depth: 0, ...asEditing })
      ),
    single: async slug =>
      updatedAtOf(await nextly.findSingle({ slug, depth: 0, ...asEditing })),
    collection: async slug => {
      const found = await nextly.find({
        collection: slug,
        sort: "-updatedAt",
        limit: 1,
        depth: 0,
        ...asEditing,
      });
      return {
        latest: updatedAtOf(found.items[0]),
        total: found.meta.total,
      };
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
          await directSourcesChangedReads(ctx)
        ),
      };
      return respondDoc(answer);
    },
  };
}
