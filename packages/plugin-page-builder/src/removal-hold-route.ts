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
  DEFAULT_LIMITS,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { componentStoreShape } from "./component-facts-route";
import { readingAsUser, type ComponentStore } from "./library-route";
import { countGrew, HOLD_MS, type RemovalHoldStore } from "./removal-hold";
import {
  REMOVAL_HOLD_ROUTE_PATH,
  type RemovalHoldResult,
} from "./removal-hold-contract";
import type { UsageCount } from "./usage-count";

/** An id, bounded as every id this plugin reads from outside. */
const ID = z.string().trim().min(1).max(256);

/**
 * The body a hold is asked with, parsed at the boundary. A field or slot id
 * is kept exactly as written, since the fence matches it against a
 * placement's own keys, and bounded only as the envelope holding it is: no
 * id outgrows the document it is stored in.
 */
function holdBody(limits: DocumentLimits) {
  const exposureId = z.string().min(1).max(limits.maxBytes);
  return z.object({
    id: ID,
    // As many as an envelope may hold.
    properties: z.array(exposureId).max(MAX_ENVELOPE_ENTRIES),
    slots: z.array(exposureId).max(MAX_ENVELOPE_ENTRIES),
    confirmed: z.number().int().min(0),
    confirmedComplete: z.boolean(),
  });
}

/** The body a hold is asked with, once parsed. */
type HoldBody = z.infer<ReturnType<typeof holdBody>>;

/** What the routes are wired with. */
export interface RemovalHoldRouteArgs {
  readonly store: ComponentStore;
  readonly holds: () => RemovalHoldStore;
  /** How many documents place a component: the count the removal dialog says. */
  readonly countPlacements: (
    ctx: PluginRouteContext
  ) => (id: string) => Promise<UsageCount>;
  /** The site's document bounds, which bound an id as its envelope does. */
  readonly limits?: () => DocumentLimits;
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
        const body = parsed(
          await req.json().catch(() => undefined),
          args.limits?.() ?? DEFAULT_LIMITS
        );
        const slug = componentsSlug(ctx, args.store);
        // Preconditions, before anything is held: the caller reads the
        // component, and may publish the removal a hold is for, which the
        // route's update permission alone does not grant.
        await requireReadable(ctx, slug, body.id);
        // Asked with no entry named, a publish right a filter limits to some
        // entries answers no. Such a caller may not be allowed to publish
        // THIS component, and a hold fences other people's writes, so only a
        // right that holds for every component may take one; the SDK asks
        // nothing about one named entry.
        if ((await ctx.caller?.can("publish", slug)) !== true) {
          throw NextlyError.forbidden({
            logContext: { reason: "removal-hold-cannot-publish", id: body.id },
          });
        }
        const count = () => args.countPlacements(ctx)(body.id);
        // A localized store retires nothing, publishing per language, so a
        // removal there loses no value and nothing is held.
        if (await isLocalized(ctx, slug)) {
          return held(await count());
        }
        const hold = {
          properties: body.properties,
          slots: body.slots,
          confirmed: body.confirmed,
          confirmedComplete: body.confirmedComplete,
          until: now() + HOLD_MS,
          token: globalThis.crypto.randomUUID(),
        };
        // Held BEFORE the count, so no write judged after the count can set a
        // removed field unseen. A write already past its check when the hold
        // landed is caught by the count taken again as the publish is written
        // (`registerPublishRecount`). Only this request's own hold is ended
        // or renewed below; another asked for at once keeps its own.
        await args.holds().hold(body.id, hold);
        let counted: UsageCount;
        try {
          counted = await count();
        } catch (error) {
          await args.holds().release(body.id, hold.token);
          throw error;
        }
        if (countGrew(counted, hold)) {
          // The designer is asked again, so nothing stays held meanwhile.
          await args.holds().release(body.id, hold.token);
          return recount(counted);
        }
        // The lease ran while counting, so it is run again from now, and only
        // while this request's hold is still in force: one that ran out
        // during a slow count fenced nothing for part of it, so "held" would
        // not be true.
        if (!(await args.holds().renew(body.id, hold.token, now() + HOLD_MS))) {
          await args.holds().release(body.id, hold.token);
          throw NextlyError.conflict({
            reason: "state",
            message:
              "Counting the documents that place this component took too long. Publish again.",
            logContext: { reason: "removal-hold-lapsed", id: body.id },
          });
        }
        return held(counted);
      },
    },
  ];
}

/** The answer for a count grown past the one confirmed. */
function recount(counted: UsageCount): Response {
  return respondMutation<RemovalHoldResult>(
    "More documents place this component than you confirmed.",
    {
      kind: "recount",
      reach: { count: counted.documents, complete: counted.complete },
    }
  );
}

/** The answer for a removal held, or one that needs no hold. */
function held(counted: UsageCount): Response {
  return respondMutation<RemovalHoldResult>(
    "The removal is held until it is published.",
    {
      kind: "held",
      reach: { count: counted.documents, complete: counted.complete },
    }
  );
}

/** The component store's RESOLVED slug: a configured one, else the plugin's. */
function componentsSlug(
  ctx: PluginRouteContext,
  store: ComponentStore
): string {
  return (
    store.collection ?? ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG
  );
}

/** Whether the component store stores definitions per language. */
async function isLocalized(
  ctx: PluginRouteContext,
  slug: string
): Promise<boolean> {
  return (await componentStoreShape(ctx.services.collections, slug, ctx.user))
    .localized;
}

/** The hold body, or the validation error naming what is wrong. */
function parsed(value: unknown, limits: DocumentLimits): HoldBody {
  const body = holdBody(limits).safeParse(value);
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
  slug: string,
  id: string
): Promise<void> {
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
