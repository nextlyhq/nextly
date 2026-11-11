/**
 * The redirects screen's routes: list, add, edit and remove redirects, and
 * list the addresses not found with a suggested page for each.
 *
 * People see and type addresses as visitors open them (`/de/alt` on a site
 * with language prefixes); the routes turn them into the language and kept
 * path redirects are stored by, and back again for the screen. Every write
 * goes through `putRedirect`, the one set of rules a page's own move uses.
 *
 * @module redirects/routes
 */
import {
  NextlyError,
  respondList,
  respondMutation,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { recordSlug, rowOf } from "../address-record/participant";
import { notFoundSlug } from "../not-found/collection";
import { closestPageIn, type LivePage } from "../not-found/suggest";
import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";

import { redirectsSlug } from "./collection";
import type { NotFoundView, RedirectView } from "./contract";
import { importRedirects, readImportFile } from "./import";
import { keptFrom, originBeside, servedOf } from "./served";
import {
  putRedirect,
  redirectOf,
  removeRedirect,
  type RedirectOutcome,
  type StoredRedirect,
} from "./store";

/** How many rows one read of a list takes. */
const MOST_LISTED = 500;

/** How many held addresses a suggestion is chosen from, at most. */
const MOST_CANDIDATES = 5000;

const PAGE = 200;

const addBody = z.object({
  from: z.string().max(2048),
  to: z.string().max(2048),
  type: z.enum(["permanent", "temporary"]).default("permanent"),
});

const editBody = z.object({
  to: z.string().max(2048),
  type: z.enum(["permanent", "temporary"]).default("permanent"),
});

async function viewOf(redirect: StoredRedirect): Promise<RedirectView> {
  return {
    id: redirect.id,
    from: await servedOf(redirect.source, redirect.locale),
    to: await servedOf(redirect.target, redirect.locale),
    type: redirect.permanent ? "permanent" : "temporary",
    origin: redirect.origin,
    addedBy: redirect.addedBy,
    addedAt: redirect.createdAt,
    editedAt: redirect.updatedAt,
  };
}

/** The sentence that says what a saved redirect's chain did, or nothing. */
function chainNote(
  typed: string,
  saved: { chain: string[]; repointed: number },
  final: string
): string {
  let note = "";
  if (saved.chain.length > 1) {
    note += ` ${typed} already goes on to ${final}, so this goes straight there in one hop.`;
  }
  if (saved.repointed === 1) {
    note += ` 1 existing redirect that went to the old address now goes straight to ${final} too.`;
  } else if (saved.repointed > 1) {
    note += ` ${saved.repointed} existing redirects that went to the old address now go straight to ${final} too.`;
  }
  return note;
}

/** A refusal as the error the screen shows beside the form. */
function refusal(
  outcome: Extract<RedirectOutcome, { refused: string }>
): NextlyError {
  if (outcome.reason === "duplicate" || outcome.reason === "held") {
    return NextlyError.duplicate({
      message: outcome.refused,
      logContext: { reason: `redirect-${outcome.reason}` },
    });
  }
  return NextlyError.invalidInput({
    message: outcome.refused,
    logContext: { reason: `redirect-${outcome.reason}` },
  });
}

/** Who a person's redirect is recorded as added by. */
function nameOf(ctx: PluginRouteContext): string | null {
  const user = ctx.user;
  if (user === null) return null;
  return user.name !== undefined && user.name !== null && user.name !== ""
    ? user.name
    : user.email;
}

/** A request body read as JSON, refused when it is not valid JSON. */
async function bodyOf(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "Send the redirect as JSON.",
      logContext: { reason: "redirect-body-not-json" },
    });
  }
}

/**
 * Every row of one of the plugin's collections in `sort` order, read
 * `pageSize` rows at a time until a short page.
 */
async function everyRow(
  ctx: PluginContext,
  slug: string,
  sort: { field: string; direction: "asc" | "desc" },
  pageSize: number
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(slug, {
      pagination: { limit: pageSize, page },
      sort,
      depth: 0,
    });
    rows.push(...(data as unknown[]));
    if ((data as unknown[]).length < pageSize) return rows;
  }
}

/** A whole list as one page, in the list envelope. */
function wholeList<T>(items: T[]): Response {
  return respondList(items, {
    total: items.length,
    page: 1,
    limit: items.length,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });
}

/**
 * Every redirect, newest first: the list route's answer, the page size a
 * parameter so a test can cross a page.
 */
export async function listRedirects(
  ctx: PluginContext,
  pageSize: number = MOST_LISTED
): Promise<Response> {
  const entries = await everyRow(
    ctx,
    redirectsSlug(ctx),
    { field: "createdAt", direction: "desc" },
    pageSize
  );
  return wholeList(
    await Promise.all(entries.map(entry => viewOf(redirectOf(entry))))
  );
}

async function addRedirect(
  req: Request,
  ctx: PluginRouteContext
): Promise<Response> {
  const body = addBody.parse(await bodyOf(req));
  const origin = new URL(req.url).origin;
  const from = await keptFrom(ctx, body.from, origin);
  // A To path is read on the From address's domain, so `/neu` beside
  // `https://example.de/alt` is German whichever domain the admin is on.
  const to = await keptFrom(
    ctx,
    body.to,
    originBeside(body.from.trim(), origin)
  );
  const locale = from.locale ?? "";
  // A From address that is no path at all is refused for itself below.
  if (
    from.locale !== undefined &&
    to.locale !== undefined &&
    to.locale !== locale
  ) {
    throw NextlyError.invalidInput({
      message:
        "Send it to an address in the same language as the From address.",
      logContext: { reason: "redirect-to-other-language" },
    });
  }
  const outcome = await ctx.services.collections.withTransaction(tx =>
    putRedirect(ctx, tx, {
      locale,
      source: from.path,
      target: to.locale === undefined ? body.to : to.path,
      permanent: body.type === "permanent",
      origin: "person",
      addedBy: nameOf(ctx),
    })
  );
  if ("refused" in outcome) throw refusal(outcome);
  const view = await viewOf(outcome.saved);
  return respondMutation(
    `Added. It works from the next visit.${chainNote(body.to.trim(), outcome, view.to)}`,
    view,
    { status: 201 }
  );
}

async function editRedirect(
  req: Request,
  ctx: PluginRouteContext
): Promise<Response> {
  const body = editBody.parse(await bodyOf(req));
  const id = ctx.params.id ?? "";
  const found = await ctx.services.ownCollections
    .findEntryById(redirectsSlug(ctx), id)
    .then(redirectOf);
  // Read on the domain the redirect's From address is served on.
  const to = await keptFrom(
    ctx,
    body.to,
    originBeside(
      await servedOf(found.source, found.locale),
      new URL(req.url).origin
    )
  );
  if (to.locale !== undefined && to.locale !== found.locale) {
    throw NextlyError.invalidInput({
      message:
        "Send it to an address in the same language as the From address.",
      logContext: { reason: "redirect-to-other-language" },
    });
  }
  const outcome = await ctx.services.collections.withTransaction(tx =>
    putRedirect(
      ctx,
      tx,
      {
        locale: found.locale,
        source: found.source,
        target: to.locale === undefined ? body.to : to.path,
        permanent: body.type === "permanent",
        origin: found.origin,
      },
      id
    )
  );
  if ("refused" in outcome) throw refusal(outcome);
  const view = await viewOf(outcome.saved);
  return respondMutation(
    `Saved. ${view.from} now goes to ${view.to}, ${view.type}.${chainNote(body.to.trim(), outcome, view.to)}`,
    view
  );
}

async function deleteRedirect(ctx: PluginRouteContext): Promise<Response> {
  const removed = await ctx.services.collections.withTransaction(tx =>
    removeRedirect(ctx, tx, ctx.params.id ?? "")
  );
  const view = await viewOf(removed);
  return respondMutation(`Removed the redirect from ${view.from}`, view);
}

/** The addresses pages hold now, as visitors open them: what is suggested from. */
async function livePages(ctx: PluginContext): Promise<LivePage[]> {
  const redirects = redirectsSlug(ctx);
  const live: LivePage[] = [];
  for (let page = 1; live.length < MOST_CANDIDATES; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(
      recordSlug(ctx),
      {
        where: { kind: { equals: "address" } },
        pagination: { limit: PAGE, page },
        sort: { field: "claimKey", direction: "asc" },
        depth: 0,
      }
    );
    for (const entry of data as unknown[]) {
      const row = rowOf(entry);
      if (row.address === null || row.holder?.collection === redirects)
        continue;
      live.push({
        locale: row.address.locale,
        path: await servedOf(row.address.path, row.address.locale),
      });
    }
    if ((data as unknown[]).length < PAGE) break;
  }
  return live;
}

/** A stored time as ISO text, whichever way the dialect hands it back. */
function isoOf(seen: unknown): string {
  if (seen instanceof Date) return seen.toISOString();
  return typeof seen === "string" ? seen : "";
}

/** One logged address as the Not found tab shows it, with its suggestion. */
async function notFoundViewOf(
  row: Record<string, unknown>,
  live: readonly LivePage[]
): Promise<NotFoundView> {
  const kept = typeof row.path === "string" ? row.path : "";
  const locale = typeof row.locale === "string" ? row.locale : "";
  // Suggested for in the spelling live pages are listed in, and shown as the
  // visitor asked for it, where that is known.
  const served = await servedOf(kept, locale);
  const asked = typeof row.asked === "string" ? row.asked : "";
  const path = asked === "" ? served : asked;
  return {
    id: String(row.id),
    path,
    // A full address where its language has a domain of its own.
    from: served.startsWith("/") ? path : served,
    hits: Number(row.hits ?? 0),
    lastSeen: isoOf(row.lastSeen),
    kind: row.kind === "moved" ? "moved" : "missing",
    // A page in the address's own language, the only one a redirect from it
    // may go to.
    suggestion: closestPageIn(served, locale, live),
  };
}

/**
 * Every address not found, most visited first, each with a suggestion: the
 * Not found route's answer, the page size a parameter so a test can cross a
 * page. The log is bounded, so every row it keeps is listed.
 */
export async function listNotFound(
  ctx: PluginContext,
  pageSize: number = MOST_LISTED
): Promise<Response> {
  const rows = await everyRow(
    ctx,
    notFoundSlug(ctx),
    { field: "hits", direction: "desc" },
    pageSize
  );
  const live = await livePages(ctx);
  const items: NotFoundView[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    items.push(await notFoundViewOf(row, live));
  }
  // Most visited first, and of those visited as often, the most recent.
  items.sort(
    (a, b) => b.hits - a.hits || Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
  );
  return wholeList(items);
}

const importBody = z.object({
  // A file of up to a few thousand rows; far larger text is not a redirect list.
  file: z.string().max(2_000_000),
  apply: z.boolean().default(false),
});

/**
 * Read an uploaded file and say what each row would do, or, with `apply`,
 * import it whole: nothing is kept while any row is refused.
 */
async function importFile(
  req: Request,
  ctx: PluginRouteContext
): Promise<Response> {
  const body = importBody.parse(await bodyOf(req));
  const rows = readImportFile(body.file);
  const result = await importRedirects(ctx, rows, {
    apply: body.apply,
    origin: new URL(req.url).origin,
    addedBy: nameOf(ctx),
    // Whoever may import may change a redirect too: both are site-wide SEO,
    // which the route has already asked.
    mayReplace: true,
  });
  const saved = result.rows.filter(
    row => row.kind !== "same" && row.kind !== "refused"
  ).length;
  const message = result.applied
    ? `Imported ${saved} redirect${saved === 1 ? "" : "s"} in one step`
    : `${rows.length} row${rows.length === 1 ? "" : "s"} read. Nothing has changed yet.`;
  return respondMutation(message, result);
}

/**
 * The routes the redirects screen reads and writes through, each for
 * someone holding `manage-seo`. The plugin keeps the redirects and the
 * not-found log itself, writing as the system, and their own collections
 * answer no one through the API, so site-wide SEO is the one permission
 * that decides who reads and changes them.
 */
export function redirectRoutes(): PluginRoute[] {
  const routes: PluginRoute[] = [
    {
      method: "GET",
      path: "/redirects",
      handler: (_req, ctx) => listRedirects(ctx),
    },
    { method: "POST", path: "/redirects", handler: addRedirect },
    { method: "PATCH", path: "/redirects/:id", handler: editRedirect },
    {
      method: "DELETE",
      path: "/redirects/:id",
      handler: (_req, ctx) => deleteRedirect(ctx),
    },
    { method: "POST", path: "/redirects/import", handler: importFile },
    {
      method: "GET",
      path: "/not-found",
      handler: (_req, ctx) => listNotFound(ctx),
    },
  ];
  return routes.map(route =>
    siteWide({ ...route, requiredPermission: MANAGE_SEO_PERMISSION })
  );
}
