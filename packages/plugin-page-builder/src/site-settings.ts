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
  getCachedNextly,
  NextlyError,
  respondMutation,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "./collections/layouts";
import {
  SITE_BREAKPOINTS_ROUTE_PATH,
  SITE_CAPABILITY_ROUTE_PATH,
  type SiteBreakpointsRequest,
  type SiteCapabilityResponse,
} from "./library-contract";
import { checkStoredBreakpoints } from "./site-style-record";
import {
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

const BreakpointsBody = z.strictObject({ breakpoints: z.unknown() });

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
async function readBreakpoints(
  req: Request
): Promise<SiteBreakpointsRequest["breakpoints"]> {
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
  return value ?? null;
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
  ctx: SiteSettingsRouteContext,
  nextly: SiteSettingsDirectApi
): Promise<Response> {
  const breakpoints = await readBreakpoints(req);
  await nextly.updateSingle({
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    data: { breakpoints },
    overrideAccess: true,
    context: { ...SITE_SETTINGS_WRITE_CONTEXT },
    ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
  });
  return respondMutation<SiteBreakpointsRequest>(
    "The site's breakpoints were saved.",
    { breakpoints }
  );
}

/** The route Settings writes the site's breakpoints through. */
export function siteBreakpointsRoute(): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: SiteSettingsRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SITE_BREAKPOINTS_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) =>
      writeSiteBreakpoints(req, ctx, await getCachedNextly()),
  };
}

/**
 * What this caller may change in the Site tab, asked of the same grants each
 * write is judged by: the site permission for the tab, and with it the rights
 * to update and publish Layouts for the default Layout, as make-default asks.
 */
export async function readSiteCapability(
  ctx: SiteSettingsRouteContext
): Promise<SiteCapabilityResponse> {
  const { caller } = ctx;
  if (caller === null) {
    return { mayManageSite: false, mayChooseDefaultLayout: false };
  }
  const mayManageSite = await caller.can(
    MANAGE_SITE.action,
    MANAGE_SITE.resource
  );
  if (!mayManageSite) {
    return { mayManageSite: false, mayChooseDefaultLayout: false };
  }
  const layouts = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const mayChooseDefaultLayout =
    (await caller.can("update", layouts)) &&
    (await caller.can("publish", layouts));
  return { mayManageSite, mayChooseDefaultLayout };
}

/**
 * The route the Site tab asks before it draws. Authenticated, with no
 * required permission: the permission is what it reports on, and gating the
 * question on the answer would refuse exactly the authors it tells "no".
 */
export function siteCapabilityRoute(): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: SiteSettingsRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: SITE_CAPABILITY_ROUTE_PATH,
    handler: async (_req, ctx) => Response.json(await readSiteCapability(ctx)),
  };
}
