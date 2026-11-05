/**
 * The route the component editor asks at publish for a removal's hold
 * (`removal-hold`).
 *
 * Gated on updating the component store, the permission a publish of the
 * component needs, and on the caller reading the component itself, asked
 * first: the count reads the usage index as the system, so asking it of a
 * component the caller may not read would say how widely it is used.
 *
 * @module removal-hold-route
 */
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { readingAsUser, type ComponentStore } from "./library-route";
import { HOLD_MS, type RemovalHoldStore } from "./removal-hold";
import {
  REMOVAL_HOLD_ROUTE_PATH,
  type RemovalHoldResult,
} from "./removal-hold-contract";
import type { UsageCount } from "./usage-count";

/** An id, bounded as every id this plugin reads from outside. */
const ID = z.string().trim().min(1).max(256);

/** The body a hold is asked with, parsed at the boundary. */
const HOLD_BODY = z.object({
  id: ID,
  properties: z.array(ID).max(500),
  slots: z.array(ID).max(500),
  confirmed: z.number().int().min(0),
});

/** What the routes are wired with. */
export interface RemovalHoldRouteArgs {
  readonly store: ComponentStore;
  readonly holds: () => RemovalHoldStore;
  /** How many documents place a component: the count the removal dialog says. */
  readonly countPlacements: (
    ctx: PluginRouteContext
  ) => (id: string) => Promise<UsageCount>;
  /** The live clock, injected so a test can move it. */
  readonly clock?: () => number;
}

/** One route declaration. */
interface RouteDeclaration {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/** The route declaration, in a list as the plugin contributes routes. */
export function removalHoldRoutes(
  args: RemovalHoldRouteArgs
): RouteDeclaration[] {
  const updatePermission = ({ collection }: PluginRoutePermissionScope) =>
    args.store.collection === undefined
      ? collection(COMPONENTS_SLUG, "update")
      : `update-${args.store.collection}`;
  const now = args.clock ?? (() => Date.now());
  return [
    {
      method: "POST",
      path: REMOVAL_HOLD_ROUTE_PATH,
      requiredPermission: updatePermission,
      handler: async (req, ctx) => {
        const body = parsed(await req.json().catch(() => undefined));
        await requireReadable(ctx, args.store, body.id);
        const count = await args.countPlacements(ctx)(body.id);
        const reach = { count: count.documents, complete: count.complete };
        if (count.documents > body.confirmed) {
          // The designer is asked again, so nothing stays held meanwhile.
          await args.holds().release(body.id);
          return respondMutation<RemovalHoldResult>(
            "More documents place this component than you confirmed.",
            { kind: "recount", reach }
          );
        }
        await args.holds().hold(body.id, {
          properties: body.properties,
          slots: body.slots,
          confirmed: body.confirmed,
          until: now() + HOLD_MS,
        });
        return respondMutation<RemovalHoldResult>(
          "The removal is held until it is published.",
          { kind: "held", reach }
        );
      },
    },
  ];
}

/** The hold body, or the validation error naming what is wrong. */
function parsed(value: unknown): z.infer<typeof HOLD_BODY> {
  const body = HOLD_BODY.safeParse(value);
  if (!body.success) {
    throw invalid(
      "Name the component, the fields and slots being removed, and the count confirmed."
    );
  }
  return body.data;
}

function invalid(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "body", code: "INVALID", message }],
  });
}

/**
 * Refuse, as not found, a component the caller may not read: the precondition
 * for counting where it is used.
 */
async function requireReadable(
  ctx: PluginRouteContext,
  store: ComponentStore,
  id: string
): Promise<void> {
  const slug =
    store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  try {
    const row = await requireNextly().findByID({
      collection: slug,
      id,
      depth: 0,
      status: "all",
      ...(await readingAsUser(ctx)),
    });
    if (row !== null && row !== undefined) return;
  } catch (error) {
    if (!NextlyError.isNotFound(error) && !NextlyError.isForbidden(error)) {
      throw error;
    }
  }
  throw NextlyError.notFound({
    logContext: { reason: "removal-hold-unreadable-component", id },
  });
}
