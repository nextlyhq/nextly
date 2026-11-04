/**
 * `POST /layouts/:id/remove`: Remove Layout, as a route.
 *
 * The body names the action, `delete` or `unpublish`, and may ask for a dry
 * run, which answers what stands in the way and writes nothing. The steps
 * themselves are `remove-layout.ts`'s.
 *
 * With `move: true` it is one tick of a move instead (`move-pages.ts`): the
 * first starts it, the next ones carry the `token` and the cursor (`after`)
 * the last one answered, and `stop` ends it. A move's page saves are made as
 * the caller too, so a page they may not edit is left, and reported.
 *
 * ## Who may call it
 *
 * The route admits a signed-in caller who may read Layouts. Whether they may
 * delete or unpublish this one is decided once, by the write itself, made as
 * the caller through the Direct API with their access enforced: a right
 * expressed as a rule over the row is judged against the row. A caller it
 * refuses changes nothing; the fence the removal put up comes down again.
 *
 * @module layout-removal/remove-route
 */
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { readingAsUser } from "../library-route";

import { movePages } from "./move-pages";
import { removeLayout, type RemoveResult } from "./remove-layout";
import { layoutRemovalStore } from "./store";

/** Where the route answers, under the plugin's namespace. */
const REMOVE_ROUTE_PATH = "/layouts/:id/remove";

/**
 * The request body. Unknown keys are refused rather than dropped: a typo of
 * `dryRun` silently ignored would perform the removal the caller meant to
 * preview.
 */
const RemoveBody = z.union([
  z.strictObject({
    action: z.enum(["delete", "unpublish"]),
    dryRun: z.boolean().optional(),
  }),
  z.strictObject({
    action: z.enum(["delete", "unpublish"]),
    move: z.literal(true),
    token: z.uuid().optional(),
    // A page id, as the previous tick answered it.
    after: z.string().min(1).max(255).optional(),
    stop: z.literal(true).optional(),
  }),
]);

/** The body, parsed at the boundary. */
async function readBody(req: Request): Promise<z.infer<typeof RemoveBody>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = RemoveBody.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: [
      {
        path: "body",
        code: "INVALID_TYPE",
        message: "The request is not a Remove Layout request.",
      },
    ],
  });
}

/**
 * The caller's user id. No permission is asked here: a delete or unpublish
 * right can be a rule over the row, which a question with no row in it would
 * answer "no" for a writer it admits. The write itself, made as the caller,
 * is the one decision; the route's own gate admits only those who may read
 * Layouts.
 */
function requireSignedIn(ctx: PluginRouteContext): string {
  if (ctx.user !== null) return ctx.user.id;
  throw NextlyError.forbidden({
    logContext: { reason: "layout-removal-needs-a-person" },
  });
}

/** Handle one request, as the module docblock describes. */
async function handle(
  req: Request,
  ctx: PluginRouteContext
): Promise<Response> {
  const slugs = {
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    settings:
      ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
      PAGE_BUILDER_SETTINGS_SLUG,
    pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
  };
  const userId = requireSignedIn(ctx);
  const body = await readBody(req);
  const deps = {
    nextly: await getCachedNextly(),
    store: layoutRemovalStore(ctx.db, ctx.dialect),
    slugs,
    person: { userId, as: await readingAsUser(ctx) },
    warn: (message: string, meta?: Record<string, unknown>) =>
      ctx.logger.warn(message, meta),
    now: () => new Date(),
    newToken: () => globalThis.crypto.randomUUID(),
  };
  const layoutId = ctx.params.id ?? "";
  const answer =
    "move" in body
      ? await movePages(deps, {
          layoutId,
          action: body.action,
          ...(body.token === undefined ? {} : { token: body.token }),
          ...(body.after === undefined ? {} : { after: body.after }),
          ...(body.stop === undefined ? {} : { stop: body.stop }),
        })
      : await removeLayout(deps, {
          layoutId,
          action: body.action,
          dryRun: body.dryRun === true,
        });
  return respondMutation<RemoveResult>(answer.message, answer.item);
}

/** The route declaration. */
export function removeLayoutRoute(): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: REMOVE_ROUTE_PATH,
    requiredPermission: ({ collection }) => collection(LAYOUTS_SLUG, "read"),
    handler: handle,
  };
}
