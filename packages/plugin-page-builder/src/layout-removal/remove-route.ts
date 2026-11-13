/**
 * `POST /layouts/:id/remove`: Remove Layout, as a route.
 *
 * The body names the action, `delete` or `unpublish`, and may ask for a dry
 * run, which answers what stands in the way and writes nothing. The steps
 * themselves are `remove-layout.ts`'s.
 *
 * With `move: true` it is one tick of a move instead (`move-pages.ts`): the
 * first starts it, the next ones carry the `token` and the cursor (`after`)
 * the last one answered, and `stop` ends it. A move's page writes are made as
 * the caller too: its field rewrites through the plugin's own collection
 * service, so each page's history names the Page Builder beside them, and a
 * page they may not edit is left, and reported.
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
  type FieldRewriteRequest,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import type { ActionBy } from "../component-actions-contract";
import { actionByOf } from "../composition-route-kit";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { asServiceCaller, readingAsUser } from "../library-route";

import { movePages } from "./move-pages";
import { removeLayout, type RemoveResult } from "./remove-layout";
import { layoutRemovalStore, type RemovalAction } from "./store";

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
 * Who the caller is. No permission is asked here: a delete or unpublish
 * right can be a rule over the row, which a question with no row in it would
 * answer "no" for a writer it admits. The write itself, made as the caller,
 * is the one decision; the route's own gate admits only those who may read
 * Layouts.
 */
function requireSignedIn(ctx: PluginRouteContext): ActionBy {
  if (ctx.user !== null) return actionByOf(ctx.user, ctx.caller ?? {});
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
  const by = requireSignedIn(ctx);
  const body = await readBody(req);
  const deps = {
    nextly: await getCachedNextly(),
    store: layoutRemovalStore(ctx.db, ctx.dialect),
    slugs,
    person: { userId: by.userId, as: await readingAsUser(ctx) },
    warn: (message: string, meta?: Record<string, unknown>) =>
      ctx.logger.warn(message, meta),
    now: () => new Date(),
    newToken: () => globalThis.crypto.randomUUID(),
    mayRemove: (action: RemovalAction) =>
      holdsRemovalGrants(ctx.caller, action, slugs.layouts),
    // As the caller, with an API key's own scope, through the service bound
    // to this plugin, which names it in each rewritten page's history.
    rewrite: (request: FieldRewriteRequest) =>
      ctx.services.collections.rewriteField(request, asServiceCaller(ctx)),
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
  // The answer says who acted, a person or an API key, as every composition
  // route's answer does.
  return respondMutation<RemoveResult & { by: ActionBy }>(answer.message, {
    ...answer.item,
    by,
  });
}

/**
 * Whether the caller holds the grants core judges a removal's final write by:
 * `delete`, or `update` and `unpublish` for an unpublish. Asked before a move
 * writes any page, so a caller without them changes nothing.
 *
 * Asked as `anyEntry`: a right expressed as a rule over Layout rows answers
 * yes here, as it must with no row named, and the final write, made as the
 * caller, still judges this Layout against that rule.
 */
export async function holdsRemovalGrants(
  caller: Pick<NonNullable<PluginRouteContext["caller"]>, "can"> | null,
  action: RemovalAction,
  layouts: string
): Promise<boolean> {
  if (caller === null) return false;
  const asked = action === "delete" ? ["delete"] : ["update", "unpublish"];
  for (const grant of asked) {
    if (!(await caller.can(grant, layouts, { anyEntry: true }))) return false;
  }
  return true;
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
