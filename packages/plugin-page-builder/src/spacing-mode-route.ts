/**
 * The owner's choice of spacing model: `POST /site/style/spacing-mode`.
 *
 * The model is part of the site's design, so it is changed by whoever may
 * change the Site Style document: the caller must be allowed to `update` that
 * Single, asked through `ctx.caller.can` before the body is read. The choice is
 * written to the plugin's own table (see `spacing-mode-store`), where the
 * one-time step at start can never replace it.
 *
 * @module spacing-mode-route
 */
import { isSpacingMode, type SpacingMode } from "@nextlyhq/blocks-engine";
import { NextlyError, respondMutation } from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import { z } from "nextly/zod";

import {
  SPACING_MODE_ROUTE_PATH,
  type SpacingModeResult,
} from "./library-contract";
import { siteStyleExpiry, type SiteStyleExpiry } from "./site-style-expiry";
import { SITE_STYLE_SLUG } from "./site-style-storage";
import { spacingModeStore } from "./spacing-mode-store";

/**
 * The request body. Unknown keys are refused rather than dropped, and the mode
 * is judged by the engine's own test of what a spacing model is.
 */
const SpacingModeBody = z.strictObject({
  mode: z.custom<SpacingMode>(isSpacingMode),
});

/** The capabilities this route uses, named rather than imported whole. */
export interface SpacingModeRouteContext {
  self: { singles: Readonly<Record<string, string | undefined>> };
  caller: { can(action: string, resource: string): Promise<boolean> } | null;
  /** The plugin's own tables, where the model is kept. */
  db: PluginDatabase;
  dialect: Parameters<typeof spacingModeStore>[1];
}

/**
 * Record the owner's choice, once the caller is admitted, then expire the
 * cached pages that read the site style, so the next render is drawn under
 * the new model.
 */
export async function chooseSpacingMode(
  req: Request,
  ctx: SpacingModeRouteContext,
  expire: SiteStyleExpiry = siteStyleExpiry(() => undefined)
): Promise<Response> {
  // A precondition, so first: nothing is read or written for a caller who may
  // not change the site's design.
  const style = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  if (ctx.caller === null || !(await ctx.caller.can("update", style))) {
    throw NextlyError.forbidden({
      logContext: { reason: "spacing-mode-needs-site-style-update" },
    });
  }
  const { mode } = await readBody(req);
  await spacingModeStore(ctx.db, ctx.dialect).choose(mode);
  await expire(style);
  return respondMutation<SpacingModeResult>(
    "The space between blocks was changed.",
    { spacingMode: mode }
  );
}

/** The body, parsed at the boundary. */
async function readBody(
  req: Request
): Promise<z.infer<typeof SpacingModeBody>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = SpacingModeBody.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: [
      {
        path: "mode",
        code: "INVALID_VALUE",
        message: 'The space between blocks is "classic" or "gaps".',
      },
    ],
  });
}

/**
 * The route declaration. Authenticated (no `public`), and no
 * `requiredPermission`: the permission is the Site Style Single's own update,
 * whose slug a host may rename, so the handler asks for it by resolved slug.
 */
export function spacingModeRoute(expire?: SiteStyleExpiry): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: SpacingModeRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SPACING_MODE_ROUTE_PATH,
    handler: (req, ctx) => chooseSpacingMode(req, ctx, expire),
  };
}
