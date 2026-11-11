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
import { NOT_FOUND_SLUG, notFoundSlug } from "../not-found/collection";
import { closestPage } from "../not-found/suggest";

import { REDIRECTS_SLUG, redirectsSlug } from "./collection";
import type { NotFoundView, RedirectView } from "./contract";
import { importRedirects, readImportFile } from "./import";
import { keptFrom, servedOf } from "./served";
import {
  putRedirect,
  redirectOf,
  removeRedirect,
  type RedirectOutcome,
  type StoredRedirect,
} from "./store";

/** The most rows one list answers with. */
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

/** Every redirect, newest first. */
async function listRedirects(ctx: PluginContext): Promise<Response> {
  const { data } = await ctx.services.ownCollections.listEntries(
    redirectsSlug(ctx),
    {
      pagination: { limit: MOST_LISTED, page: 1 },
      sort: { field: "createdAt", direction: "desc" },
      depth: 0,
    }
  );
  const items = await Promise.all(
    (data as unknown[]).map(entry => viewOf(redirectOf(entry)))
  );
  return respondList(items, {
    total: items.length,
    page: 1,
    limit: MOST_LISTED,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });
}

async function addRedirect(
  req: Request,
  ctx: PluginRouteContext
): Promise<Response> {
  const body = addBody.parse(await bodyOf(req));
  const origin = new URL(req.url).origin;
  const from = await keptFrom(ctx, body.from, origin);
  const to = await keptFrom(ctx, body.to, origin);
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
  const to = await keptFrom(ctx, body.to, new URL(req.url).origin);
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
async function livePages(ctx: PluginContext): Promise<string[]> {
  const redirects = redirectsSlug(ctx);
  const live: string[] = [];
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
      live.push(await servedOf(row.address.path, row.address.locale));
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
  live: readonly string[]
): Promise<NotFoundView> {
  const kept = typeof row.path === "string" ? row.path : "";
  const locale = typeof row.locale === "string" ? row.locale : "";
  // Suggested for in the spelling live pages are listed in, and shown as the
  // visitor asked for it, where that is known.
  const served = await servedOf(kept, locale);
  const asked = typeof row.asked === "string" ? row.asked : "";
  return {
    id: String(row.id),
    path: asked === "" ? served : asked,
    hits: Number(row.hits ?? 0),
    lastSeen: isoOf(row.lastSeen),
    kind: row.kind === "moved" ? "moved" : "missing",
    suggestion: closestPage(served, live),
  };
}

/** The addresses not found, most visited first, each with a suggestion. */
async function listNotFound(ctx: PluginContext): Promise<Response> {
  const { data } = await ctx.services.ownCollections.listEntries(
    notFoundSlug(ctx),
    {
      pagination: { limit: MOST_LISTED, page: 1 },
      sort: { field: "hits", direction: "desc" },
      depth: 0,
    }
  );
  const live = await livePages(ctx);
  const items: NotFoundView[] = [];
  for (const row of data as Record<string, unknown>[]) {
    items.push(await notFoundViewOf(row, live));
  }
  // Most visited first, and of those visited as often, the most recent.
  items.sort(
    (a, b) => b.hits - a.hits || Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
  );
  return respondList(items, {
    total: items.length,
    page: 1,
    limit: MOST_LISTED,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });
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
  });
  const saved = result.rows.filter(
    row => row.kind !== "same" && row.kind !== "refused"
  ).length;
  const message = result.applied
    ? `Imported ${saved} redirect${saved === 1 ? "" : "s"} in one step`
    : `${rows.length} row${rows.length === 1 ? "" : "s"} read. Nothing has changed yet.`;
  return respondMutation(message, result);
}

/** The routes the redirects screen reads and writes through. */
export function redirectRoutes(): PluginRoute[] {
  return [
    {
      method: "GET",
      path: "/redirects",
      requiredPermission: `read-${REDIRECTS_SLUG}`,
      handler: (_req, ctx) => listRedirects(ctx),
    },
    {
      method: "POST",
      path: "/redirects",
      requiredPermission: `create-${REDIRECTS_SLUG}`,
      handler: addRedirect,
    },
    {
      method: "PATCH",
      path: "/redirects/:id",
      requiredPermission: `update-${REDIRECTS_SLUG}`,
      handler: editRedirect,
    },
    {
      method: "DELETE",
      path: "/redirects/:id",
      requiredPermission: `delete-${REDIRECTS_SLUG}`,
      handler: (_req, ctx) => deleteRedirect(ctx),
    },
    {
      method: "POST",
      path: "/redirects/import",
      requiredPermission: `create-${REDIRECTS_SLUG}`,
      handler: importFile,
    },
    {
      method: "GET",
      path: "/not-found",
      requiredPermission: `read-${NOT_FOUND_SLUG}`,
      handler: (_req, ctx) => listNotFound(ctx),
    },
  ];
}
