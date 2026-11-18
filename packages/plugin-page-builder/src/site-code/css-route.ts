/**
 * The site CSS routes: where the CSS drawn on every page of the site is read
 * and saved, and where the canvas reads it to draw.
 *
 * Kept as site code is, since both reach every published page: under the site
 * settings permission, and saved by a signed-in person only, never an API
 * key, so a leaked key cannot restyle every page. Each save is judged on the
 * server by the one checker (`checkCustomCss`, the site level), whatever the
 * client checked, and each refusal names its line. A save names the CSS it
 * was made from by its SHA-256 and is refused when someone saved in between.
 * Each save writes an audit row holding hashes and sizes, never the CSS, and
 * expires every cached page that drew the CSS it replaced.
 *
 * The CSS has no version history: a save replaces it.
 *
 * @module site-code/css-route
 * @experimental
 */
import {
  NextlyError,
  respondMutation,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  SITE_CSS_DRAWN_ROUTE_PATH,
  SITE_CSS_ROUTE_PATH,
  type SiteCssDrawn,
  type SiteCssRead,
  type SiteCssSaved,
} from "../library-contract";

import { checkCustomCss, customCssProblemText } from "./css-check";
import { SITE_CODE_LIMITS } from "./limits";
import {
  readStoredSiteCss,
  saveSiteCss,
  SITE_CSS_CACHE_PART,
  SITE_CSS_STALE,
  SiteCssStaleError,
  type SiteCssSave,
  type SiteCssWrite,
  type StoredSiteCss,
} from "./site-css-store";

/** What the routes read of a request's context. */
export type SiteCssRouteContext = Pick<
  PluginRouteContext,
  "user" | "caller" | "audit" | "db" | "dialect" | "cache"
>;

/** Where the site CSS is read and saved. */
export interface SiteCssStore {
  read(): Promise<StoredSiteCss>;
  save(save: SiteCssSave): Promise<SiteCssWrite>;
}

/** What the routes are handed. */
export interface SiteCssRouteDeps {
  /** The permission the read and the save ask for: the site settings one. */
  readonly permission: string;
  /** Whether this caller may read the CSS to draw it: who may read the site style. */
  readonly mayDraw: (ctx: PluginRouteContext) => Promise<boolean>;
  /**
   * The name of the person with this id, for "Last changed by"; `null` when
   * it can't be read. Absent, no name is given.
   */
  readonly personName?: (id: string) => Promise<string | null>;
  /** The store, from the request's context: the plugin's own table by default. */
  readonly store?: (ctx: SiteCssRouteContext) => SiteCssStore;
}

/** The audit kind a save writes. */
export const SITE_CSS_SAVED_AUDIT =
  "nextlyhq-plugin-page-builder.site-css-saved";

/** The keys a save's audit row holds: hashes and sizes, never the CSS. */
export const SITE_CSS_SAVED_METADATA = [
  "cssSha256",
  "cssSha256Before",
  "cssChars",
  "cssCharsBefore",
] as const;

/**
 * A save's request. The CSS is bounded at twice what it may hold, so an
 * oversized paste reaches the checker, which says how much it may be, while
 * the request itself stays bounded.
 */
const SiteCssBody = z.strictObject({
  css: z.string().max(SITE_CODE_LIMITS.slotChars * 2),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** The plugin's own table, through the request's database. */
function tableStore(ctx: SiteCssRouteContext): SiteCssStore {
  return {
    read: () => readStoredSiteCss(ctx.db),
    save: save => saveSiteCss(ctx.db, ctx.dialect, save),
  };
}

/** The store the routes use for this request. */
function storeOf(
  ctx: SiteCssRouteContext,
  deps: SiteCssRouteDeps
): SiteCssStore {
  return (deps.store ?? tableStore)(ctx);
}

/**
 * The name of the person who saved the CSS last, from its `user:<id>`
 * marker; `null` when there is none or the name can't be read, which never
 * fails the read.
 */
async function changedByOf(
  marker: string | null,
  deps: SiteCssRouteDeps
): Promise<string | null> {
  if (marker?.startsWith("user:") !== true || deps.personName === undefined) {
    return null;
  }
  try {
    return await deps.personName(marker.slice("user:".length));
  } catch {
    return null;
  }
}

/** The CSS as Settings reads it, to edit. */
async function readSiteCss(
  ctx: SiteCssRouteContext,
  deps: SiteCssRouteDeps
): Promise<Response> {
  const stored = await storeOf(ctx, deps).read();
  return Response.json({
    css: stored.css,
    sha256: stored.sha256,
    changedAt: stored.changedAt,
    changedBy: await changedByOf(stored.changedBy, deps),
  } satisfies SiteCssRead);
}

/** The CSS as the canvas draws it. */
async function readDrawnSiteCss(
  ctx: PluginRouteContext,
  deps: SiteCssRouteDeps
): Promise<Response> {
  if (!(await deps.mayDraw(ctx))) {
    throw NextlyError.forbidden({
      logContext: { reason: "site-css-read-needs-editing-rights" },
    });
  }
  const stored = await storeOf(ctx, deps).read();
  return Response.json({ css: stored.css } satisfies SiteCssDrawn);
}

/** Parse a save's body, refusing one that is not a site CSS save. */
async function bodyOf(req: Request): Promise<z.infer<typeof SiteCssBody>> {
  const parsed = SiteCssBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join(".") || "body",
        code: "INVALID_VALUE",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

/** Refuse CSS the checker refuses, each refusal naming its line. */
function refuseUnsaveable(css: string): void {
  const problems = checkCustomCss(css, "site");
  if (problems.length === 0) return;
  throw NextlyError.validation({
    errors: problems.map(problem => ({
      path: "css",
      code: "SITE_CSS_REFUSED",
      message: customCssProblemText(problem),
    })),
  });
}

/** The CSS written, or the refusal of a save made from a replaced read. */
async function written(
  store: SiteCssStore,
  save: SiteCssSave
): Promise<SiteCssWrite> {
  try {
    return await store.save(save);
  } catch (error) {
    if (!(error instanceof SiteCssStaleError)) throw error;
    throw NextlyError.conflict({
      reason: "state",
      message: SITE_CSS_STALE,
      logContext: { reason: "site-css-changed-since-read" },
    });
  }
}

/**
 * Save the site's CSS. The preconditions run first, before anything is read
 * or written: a person, not a key, and CSS the checker accepts.
 */
async function changeSiteCss(
  req: Request,
  ctx: SiteCssRouteContext,
  deps: SiteCssRouteDeps
): Promise<Response> {
  if (ctx.caller?.authMethod !== "session" || ctx.user === null) {
    throw NextlyError.personOnly({
      doing: "change the site's CSS",
      logContext: { reason: "site-css-api-key" },
    });
  }
  const userId = ctx.user.id;
  const body = await bodyOf(req);
  refuseUnsaveable(body.css);
  const write = await written(storeOf(ctx, deps), {
    css: body.css,
    readSha256: body.sha256,
    changedBy: `user:${userId}`,
  });
  await ctx.audit?.write({
    kind: SITE_CSS_SAVED_AUDIT,
    actorUserId: userId,
    request: req,
    metadata: {
      cssSha256: write.after.sha256,
      cssSha256Before: write.before.sha256,
      cssChars: write.after.chars,
      cssCharsBefore: write.before.chars,
    },
  });
  // Every cached page drew the CSS this replaced: expired after the write
  // has committed, so a page read again draws the new CSS.
  await ctx.cache.expire(SITE_CSS_CACHE_PART);
  return respondMutation<SiteCssSaved>(
    "The site CSS was saved. It is drawn on every published page.",
    { sha256: write.after.sha256 }
  );
}

/** The site CSS routes: read and save, and the canvas's read. */
export function siteCssRoutes(deps: SiteCssRouteDeps): PluginRoute[] {
  return [
    {
      method: "GET",
      path: SITE_CSS_ROUTE_PATH,
      requiredPermission: deps.permission,
      handler: (_req, ctx) => readSiteCss(ctx, deps),
    },
    {
      method: "POST",
      path: SITE_CSS_ROUTE_PATH,
      requiredPermission: deps.permission,
      handler: (req, ctx) => changeSiteCss(req, ctx, deps),
    },
    {
      method: "GET",
      path: SITE_CSS_DRAWN_ROUTE_PATH,
      checksAccess: true, // The handler judges each caller.
      handler: (_req, ctx) => readDrawnSiteCss(ctx, deps),
    },
  ];
}
