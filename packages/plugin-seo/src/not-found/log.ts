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
const NOT_FOUND_LIMIT = 1000;

/** How far past its limit the log grows before it is pruned again. */
const PRUNE_SLACK = 100;

/** The longest address the log keeps; a longer one is not a page anyone links to. */
const LONGEST_ADDRESS = 2048;

/** How many rows one read takes. */
const PAGE = 200;

/** What a row of the log records about one address. */
export type NotFoundKind = "missing" | "moved";

/** A row of the log, read back. */
interface NotFoundRow {
  id: string;
  path: string;
  hits: number;
  lastSeen: string;
  kind: NotFoundKind;
}

/** An address as it is kept: a language and a path. */
export interface LoggedAddress {
  locale: string;
  path: string;
}

/** The stored key of an address in a language. */
function pathKey(address: LoggedAddress): string {
  return createHash("sha256")
    .update(`${address.locale}|${address.path}`, "utf8")
    .digest("hex");
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
function notFoundRowOf(entry: unknown): NotFoundRow {
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

/**
 * Count one more request on the log's row for `key`, read and written under
 * the row's lock on one transaction, so requests arriving at once each count.
 * Answers whether the row was there.
 */
function bumpLogged(
  ctx: PluginContext,
  key: string,
  lastSeen: string,
  kind: NotFoundKind
): Promise<boolean> {
  const slug = notFoundSlug(ctx);
  return ctx.services.collections.withTransaction(async transaction => {
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      transaction,
      slug,
      {
        where: { pathKey: { equals: key } },
        pagination: { limit: 1, page: 1 },
        depth: 0,
      },
      { lock: "update" }
    );
    const [entry] = data as unknown[];
    if (entry === undefined) return false;
    const row = notFoundRowOf(entry);
    await ctx.services.collections.updateEntryInTransaction(
      transaction,
      slug,
      row.id,
      {
        hits: row.hits + 1,
        lastSeen,
        ...(kind === "moved" ? { kind } : {}),
        _overwrite: true,
      }
    );
    return true;
  });
}

/**
 * Count one more request for `path` that found nothing, or list it as an old
 * address a deploy moved without a redirect (`moved`). An address left out
 * of the log is ignored.
 */
export async function recordNotFound(
  ctx: PluginContext,
  address: LoggedAddress,
  kind: NotFoundKind = "missing",
  now: Date = new Date(),
  bound: { limit: number; slack: number } = {
    limit: NOT_FOUND_LIMIT,
    slack: PRUNE_SLACK,
  }
): Promise<void> {
  if (notAPageAddress(address.path)) return;
  const slug = notFoundSlug(ctx);
  const lastSeen = now.toISOString();
  const key = pathKey(address);
  if (await bumpLogged(ctx, key, lastSeen, kind)) return;
  try {
    await ctx.services.collections.createEntry(slug, {
      pathKey: key,
      locale: address.locale,
      path: address.path,
      hits: 1,
      lastSeen,
      kind,
    });
  } catch (error) {
    // Another request made the row first: count this one on it.
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    await bumpLogged(ctx, key, lastSeen, kind);
    return;
  }
  if (
    (await ctx.services.ownCollections.count(slug)) >
    bound.limit + bound.slack
  ) {
    await pruneNotFound(ctx, bound.limit);
  }
}

/**
 * Bring the log back to `limit`: keep the half most recently asked for and
 * the half most often asked for, an address asked for as often as another
 * kept where it was asked for more recently, and let the rest go. The log
 * is pruned at a small, bounded size, so its rows are read whole.
 */
export async function pruneNotFound(
  ctx: PluginContext,
  limit: number = NOT_FOUND_LIMIT
): Promise<void> {
  const slug = notFoundSlug(ctx);
  const rows: NotFoundRow[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(slug, {
      pagination: { limit: PAGE, page },
      sort: { field: "pathKey", direction: "asc" },
      depth: 0,
    });
    rows.push(...(data as unknown[]).map(notFoundRowOf));
    if ((data as unknown[]).length < PAGE) break;
  }
  const half = Math.ceil(limit / 2);
  const recent = (a: NotFoundRow, b: NotFoundRow) =>
    Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
  const keep = new Set([
    ...[...rows]
      .sort(recent)
      .slice(0, half)
      .map(row => row.id),
    ...[...rows]
      .sort((a, b) => b.hits - a.hits || recent(a, b))
      .slice(0, half)
      .map(row => row.id),
  ]);
  for (const row of rows) {
    if (!keep.has(row.id)) {
      await ctx.services.collections.deleteEntry(slug, row.id);
    }
  }
}

/** Drop `address` from the log, as a redirect now answers it. */
export async function forgetNotFound(
  ctx: PluginContext,
  transaction: Parameters<
    PluginContext["services"]["collections"]["deleteEntryInTransaction"]
  >[0],
  address: LoggedAddress
): Promise<void> {
  const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
    transaction,
    notFoundSlug(ctx),
    {
      where: { pathKey: { equals: pathKey(address) } },
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
