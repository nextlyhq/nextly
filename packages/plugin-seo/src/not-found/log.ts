/**
 * The log of addresses that answered "not found": one row per address, with
 * how often and when it was last asked for, kept to a bounded size.
 *
 * Admin, API and asset requests never enter it, so it lists only addresses a
 * person or a search engine expected to be a page. Past its bound it keeps
 * the most recently and the most frequently asked-for addresses, so a flood
 * of distinct addresses pushes out neither the address asked for an hour ago
 * nor the one asked for a thousand times last month.
 *
 * @module not-found/log
 */
import { createHash } from "node:crypto";

import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { notFoundSlug } from "./collection";

/** The most addresses the log keeps once it is pruned. */
export const NOT_FOUND_LIMIT = 1000;

/** How far past its limit the log grows before it is pruned again. */
const PRUNE_SLACK = 100;

/** The longest address the log keeps; a longer one is not a page anyone links to. */
const LONGEST_ADDRESS = 2048;

/** How many rows one read takes. */
const PAGE = 200;

/** What a row of the log records about one address. */
export type NotFoundKind = "missing" | "moved";

/** A row of the log, read back. */
export interface NotFoundRow {
  id: string;
  path: string;
  hits: number;
  lastSeen: string;
  kind: NotFoundKind;
}

/** The stored key of an address. */
function pathKey(path: string): string {
  return createHash("sha256").update(path, "utf8").digest("hex");
}

/** The first path segments no public page is ever served under. */
const LEFT_OUT_PREFIXES = ["/admin", "/api", "/_next"];

/** Files a browser fetches for a page rather than pages: scripts, styles, images, fonts, media. */
const ASSET_EXTENSION =
  /\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|m4a|mov)$/i;

/**
 * Whether a request for `path` stays out of the log: the admin, the API,
 * Next.js's own files, a static asset, or an address too long to be a page.
 */
export function notAPageAddress(path: string): boolean {
  if (path.length > LONGEST_ADDRESS) return true;
  if (
    LEFT_OUT_PREFIXES.some(
      prefix => path === prefix || path.startsWith(`${prefix}/`)
    )
  ) {
    return true;
  }
  return ASSET_EXTENSION.test(path);
}

/** A stored row read back, every column checked rather than trusted. */
export function notFoundRowOf(entry: unknown): NotFoundRow {
  const row = entry as Record<string, unknown>;
  const lastSeen = row.lastSeen;
  return {
    id: String(row.id),
    path: typeof row.path === "string" ? row.path : "",
    hits: typeof row.hits === "number" ? row.hits : Number(row.hits ?? 0),
    lastSeen:
      lastSeen instanceof Date
        ? lastSeen.toISOString()
        : typeof lastSeen === "string"
          ? lastSeen
          : "",
    kind: row.kind === "moved" ? "moved" : "missing",
  };
}

/** The log's row for `path`, if it has one. */
async function rowFor(
  ctx: PluginContext,
  path: string
): Promise<NotFoundRow | undefined> {
  const { data } = await ctx.services.ownCollections.listEntries(
    notFoundSlug(ctx),
    {
      where: { pathKey: { equals: pathKey(path) } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [row] = data as unknown[];
  return row === undefined ? undefined : notFoundRowOf(row);
}

/**
 * Count one more request for `path` that found nothing, or list it as an old
 * address a deploy moved without a redirect (`moved`). An address left out
 * of the log is ignored.
 */
export async function recordNotFound(
  ctx: PluginContext,
  path: string,
  kind: NotFoundKind = "missing",
  now: Date = new Date(),
  bound: { limit: number; slack: number } = {
    limit: NOT_FOUND_LIMIT,
    slack: PRUNE_SLACK,
  }
): Promise<void> {
  if (notAPageAddress(path)) return;
  const slug = notFoundSlug(ctx);
  const lastSeen = now.toISOString();
  const bump = async (row: NotFoundRow) => {
    await ctx.services.collections.updateEntry(slug, row.id, {
      hits: row.hits + 1,
      lastSeen,
      ...(kind === "moved" ? { kind } : {}),
      _overwrite: true,
    });
  };
  const known = await rowFor(ctx, path);
  if (known !== undefined) return bump(known);
  try {
    await ctx.services.collections.createEntry(slug, {
      pathKey: pathKey(path),
      path,
      hits: 1,
      lastSeen,
      kind,
    });
  } catch (error) {
    // Another request made the row first: count this one on it.
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    const made = await rowFor(ctx, path);
    if (made !== undefined) await bump(made);
    return;
  }
  if ((await ctx.services.ownCollections.count(slug)) > bound.limit + bound.slack) {
    await pruneNotFound(ctx, bound.limit);
  }
}

/** The ids of the first `limit` rows by `field`, most first. */
async function topIds(
  ctx: PluginContext,
  field: "lastSeen" | "hits",
  limit: number
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; ids.size < limit; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      notFoundSlug(ctx),
      {
        pagination: { limit: Math.min(PAGE, limit), page },
        sort: { field, direction: "desc" },
        depth: 0,
      }
    );
    const rows = data as Record<string, unknown>[];
    for (const row of rows) {
      if (ids.size < limit) ids.add(String(row.id));
    }
    if (rows.length < Math.min(PAGE, limit)) break;
  }
  return ids;
}

/**
 * Bring the log back to its limit: keep the half most recently asked for and
 * the half most often asked for, and let the rest go.
 */
export async function pruneNotFound(
  ctx: PluginContext,
  limit: number = NOT_FOUND_LIMIT
): Promise<void> {
  const half = Math.ceil(limit / 2);
  const keep = new Set([
    ...(await topIds(ctx, "lastSeen", half)),
    ...(await topIds(ctx, "hits", half)),
  ]);
  const slug = notFoundSlug(ctx);
  const gone: string[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(slug, {
      pagination: { limit: PAGE, page },
      sort: { field: "pathKey", direction: "asc" },
      depth: 0,
    });
    const rows = data as Record<string, unknown>[];
    for (const row of rows) {
      const id = String(row.id);
      if (!keep.has(id)) gone.push(id);
    }
    if (rows.length < PAGE) break;
  }
  for (const id of gone) {
    await ctx.services.collections.deleteEntry(slug, id);
  }
}

/** Drop `path` from the log, as a redirect now answers it. */
export async function forgetNotFound(
  ctx: PluginContext,
  transaction: Parameters<
    PluginContext["services"]["collections"]["deleteEntryInTransaction"]
  >[0],
  path: string
): Promise<void> {
  const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
    transaction,
    notFoundSlug(ctx),
    {
      where: { pathKey: { equals: pathKey(path) } },
      pagination: { limit: 1, page: 1 },
      depth: 0,
    }
  );
  const [row] = data as Record<string, unknown>[];
  if (row !== undefined) {
    await ctx.services.collections.deleteEntryInTransaction(
      transaction,
      notFoundSlug(ctx),
      String(row.id)
    );
  }
}
