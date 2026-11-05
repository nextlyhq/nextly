/**
 * The site's settings as the editor's Settings changes them: the permission
 * they need, the one way the site's breakpoints change, and what a caller may
 * change.
 *
 * The breakpoints have ONE door. Redefining the site's devices is a site
 * setting with a permission of its own, so it is written by a route that asks
 * for that permission, and the `site-style` Single refuses every other write
 * that changes them (`refuseBreakpointsOutsideSettings`, beside the Single).
 *
 * @module site-settings
 */
import {
  breakpointContexts,
  type BreakpointSet,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import type { RemovalDryRun } from "./breakpoint-removal/dry-run";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { asOverwrite } from "./document-version";
import {
  SITE_BREAKPOINTS_ROUTE_PATH,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteBreakpointsRequest,
  type SiteLayoutOption,
  type SiteSettingsRead,
} from "./library-contract";
import { walkPages } from "./paged-walk";
import {
  resolveSiteStyle,
  siteBreakpoints,
  type SiteStyleData,
} from "./site-style";
import { checkStoredBreakpoints } from "./site-style-record";
import {
  loadSiteStyle,
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "./site-style-storage";

/** The permission a role needs to change the site's settings, in its parts. */
const MANAGE_SITE = {
  action: "manage",
  resource: "page-builder-site",
} as const;

/** The same permission as a route declares it. */
export const MANAGE_SITE_PERMISSION: string = `${MANAGE_SITE.action}-${MANAGE_SITE.resource}`;

/** The caller and the plugin's resolved names, as a route sees them. */
export interface SiteSettingsRouteContext {
  self: {
    collections: Record<string, string | undefined>;
    singles: Record<string, string | undefined>;
  };
  user: { id: string } | null;
  caller: { can(action: string, resource: string): Promise<boolean> } | null;
}

/** The slice of the Direct API the breakpoints route writes through. */
export interface SiteSettingsDirectApi {
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
    context: Record<string, unknown>;
    user?: { id: string };
  }): Promise<unknown>;
}

const BreakpointsBody = z.strictObject({
  breakpoints: z.unknown(),
  // Count what saving this set would drop, and save nothing.
  dryRun: z.boolean().optional(),
});

/** A refusal naming what is wrong with the breakpoints sent. */
function invalidBreakpoints(messages: readonly string[]): NextlyError {
  return NextlyError.validation({
    errors: messages.map(message => ({
      path: "breakpoints",
      code: "INVALID_VALUE",
      message,
    })),
  });
}

/** The body, parsed at the boundary: a set the site may store, or refused. */
async function readBreakpoints(req: Request): Promise<{
  breakpoints: SiteBreakpointsRequest["breakpoints"];
  dryRun: boolean;
}> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = BreakpointsBody.safeParse(raw);
  if (!parsed.success || parsed.data.breakpoints === undefined) {
    throw invalidBreakpoints(["The request is not a set of breakpoints."]);
  }
  // The Single's own check, so the route stores nothing the Single's field
  // would refuse. `null` is a set too: it clears the stored one, and the
  // site's configured breakpoints apply again.
  const { value, issues } = checkStoredBreakpoints(parsed.data.breakpoints);
  if (issues.length > 0) throw invalidBreakpoints(issues);
  return { breakpoints: value ?? null, dryRun: parsed.data.dryRun === true };
}

/**
 * The breakpoints `after` no longer defines that `before` does, by id, with
 * the name the author knows each by. Both are the sets the stylesheet is
 * emitted under, so a definition the compiler drops is in neither.
 */
export function removedBreakpoints(
  before: BreakpointSet | undefined,
  after: BreakpointSet | undefined
): Map<string, string> {
  const kept = new Set(breakpointContexts(after).map(context => context.id));
  const labels = new Map(
    [...(before?.viewport ?? []), ...(before?.container ?? [])].map(def => [
      def.id,
      def.label ?? def.id,
    ])
  );
  const removed = new Map<string, string>();
  for (const { id } of breakpointContexts(before)) {
    if (!kept.has(id)) removed.set(id, labels.get(id) ?? id);
  }
  return removed;
}

/** How the installed plugin counts what a removal would drop. */
export interface BreakpointRemoval {
  /** The site's style as it is now, the configured defaults under it. */
  readonly current: (ctx: SiteSettingsRouteContext) => Promise<SiteStyleData>;
  /** The configured site style, which a stored `null` gives back. */
  readonly defaults?: SiteStyleData;
  /** Walk the site for what removing each of these would drop. */
  readonly count: (
    removed: ReadonlyMap<string, string>,
    classes: readonly NamedClass[],
    ctx: BreakpointsRouteContext
  ) => Promise<RemovalDryRun>;
}

/** What the breakpoints route is handed: the settings context, and who asks. */
export type BreakpointsRouteContext = SiteSettingsRouteContext &
  Pick<PluginRouteContext, "caller">;

/** What a dry run answers with. */
interface SiteBreakpointsDryRun extends RemovalDryRun {
  readonly dryRun: true;
  readonly breakpoints: SiteBreakpointsRequest["breakpoints"];
}

/**
 * What saving `breakpoints` would drop, with nothing saved: the breakpoints it
 * removes from the set the site emits now, and every style and hide stored
 * under them.
 */
async function dryRunBreakpoints(
  breakpoints: SiteBreakpointsRequest["breakpoints"],
  ctx: BreakpointsRouteContext,
  removal: BreakpointRemoval
): Promise<Response> {
  const current = await removal.current(ctx);
  // The set saving this would leave: a stored `null` gives the configured
  // defaults back, as the resolved style reads it.
  const after = siteBreakpoints(
    resolveSiteStyle(removal.defaults, {
      breakpoints: breakpoints ?? undefined,
    })
  );
  const removed = removedBreakpoints(siteBreakpoints(current), after);
  const counted = await removal.count(removed, current.classes ?? [], ctx);
  return respondMutation<SiteBreakpointsDryRun>(
    "Nothing was saved: this is what saving these breakpoints would drop.",
    { dryRun: true, breakpoints, ...counted }
  );
}

/**
 * Store the site's breakpoints: the one write that may change them.
 *
 * Authorized by the route's declared permission before this runs; the write
 * itself goes past the Single's own permission, because the site permission
 * alone is what lets a role redefine its devices. Marked, so the Single's hook
 * knows which door it came through.
 */
export async function writeSiteBreakpoints(
  req: Request,
  ctx: BreakpointsRouteContext,
  nextly: SiteSettingsDirectApi,
  removal?: BreakpointRemoval
): Promise<Response> {
  const { breakpoints, dryRun } = await readBreakpoints(req);
  if (dryRun) {
    // Counted only where the installed plugin can walk the site.
    if (removal === undefined) {
      throw NextlyError.internal({
        logContext: { reason: "breakpoint-dry-run-not-installed" },
      });
    }
    return dryRunBreakpoints(breakpoints, ctx, removal);
  }
  // The Settings screen saves the whole set it shows, and this route reads
  // nothing before writing it: it sets the breakpoints whatever is stored.
  await nextly.updateSingle({
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    data: asOverwrite({ breakpoints }),
    overrideAccess: true,
    context: { ...SITE_SETTINGS_WRITE_CONTEXT },
    ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
  });
  return respondMutation<SiteBreakpointsRequest>(
    "The site's breakpoints were saved.",
    { breakpoints }
  );
}

/**
 * The route Settings writes the site's breakpoints through, and asks first
 * what a removal would drop (`dryRun`), under the same permission.
 */
export function siteBreakpointsRoute(removal?: BreakpointRemoval): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: BreakpointsRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SITE_BREAKPOINTS_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) =>
      writeSiteBreakpoints(req, ctx, await getCachedNextly(), removal),
  };
}

/** What a caller who may not manage the site is told: nothing about it. */
const NOTHING: SiteSettingsRead = {
  mayManageSite: false,
  mayChooseDefaultLayout: false,
  defaultLayout: null,
  breakpoints: null,
  layouts: [],
};

/** How many Layouts are read per page, and the most pages walked. */
const LAYOUT_PAGE_SIZE = 100;
const LAYOUT_PAGES_MAX = 50;

/**
 * What the Site tab shows, and what this caller may change there: the site
 * permission offers the tab, and with it the rights to update and publish
 * Layouts let the default Layout be chosen, as make-default asks. Read past
 * the Layouts' own read rule, as make-default's checks are, and only for a
 * caller the site permission admits.
 */
export async function readSiteSettings(
  ctx: SiteSettingsRouteContext,
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">,
  /** The configured site style, which the stored breakpoints sit over. */
  defaults?: SiteStyleData
): Promise<SiteSettingsRead> {
  const { caller } = ctx;
  if (caller === null) return NOTHING;
  if (!(await caller.can(MANAGE_SITE.action, MANAGE_SITE.resource))) {
    return NOTHING;
  }
  const slugs = {
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    settings:
      ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
      PAGE_BUILDER_SETTINGS_SLUG,
  };
  const mayChooseDefaultLayout =
    (await caller.can("update", slugs.layouts)) &&
    (await caller.can("publish", slugs.layouts));
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  // Every published Layout for a caller who may choose; otherwise only the
  // default, so it can be named.
  const only = mayChooseDefaultLayout
    ? undefined
    : defaultLayout === null
      ? []
      : [defaultLayout];
  const layouts: SiteLayoutOption[] = [];
  if (only === undefined || only.length > 0) {
    // Every page of them: an option left off would be a Layout that cannot be
    // made the default, or a default the select could not show.
    await walkPages({
      describe: "the published Layouts",
      maxPages: LAYOUT_PAGES_MAX,
      fetchPage: async page =>
        await nextly.find({
          collection: slugs.layouts,
          ...(only === undefined ? {} : { where: { id: { in: only } } }),
          status: "published",
          limit: LAYOUT_PAGE_SIZE,
          page,
          depth: 0,
          select: { id: true, title: true },
          overrideAccess: true,
        }),
      onPage: rows => {
        for (const row of rows) {
          const { id, title } = row as Record<string, unknown>;
          if (typeof id === "string" && typeof title === "string") {
            layouts.push({ id, title });
          }
        }
      },
    });
  }
  // The breakpoints as the canvas resolves them, read past Design's read:
  // the site permission admits their write, so it admits seeing them.
  const { breakpoints } = await loadSiteStyle({
    nextly,
    // The Single the route writes, renamed or not.
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    ...(defaults === undefined ? {} : { defaults }),
  });
  return {
    mayManageSite: true,
    breakpoints: breakpoints ?? null,
    mayChooseDefaultLayout,
    defaultLayout,
    layouts,
  };
}

/**
 * The route the Site tab reads before it draws. Authenticated, with no
 * required permission: the permission is what it reports on, and gating the
 * question on the answer would refuse exactly the authors it tells "no".
 */
export function siteSettingsRoute(defaults?: SiteStyleData): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: SiteSettingsRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: SITE_SETTINGS_ROUTE_PATH,
    handler: async (_req, ctx) =>
      Response.json(
        await readSiteSettings(ctx, await getCachedNextly(), defaults)
      ),
  };
}
