/**
 * Whether this author may create a pattern, asked before the form is offered.
 *
 * ## Why the server has to answer
 *
 * The grant is seeded against the RESOLVED collection slug, and a host may
 * rename a plugin collection. The browser knows only the declared name, so a
 * client-side check would refuse an author on a renamed site — hiding a feature
 * that works, which is worse than the late failure it replaces. It is also the
 * reason `savePatternRoute` declares no `requiredPermission` and reads
 * `ctx.self.collections[PATTERNS_SLUG]` instead: the resolved slug is knowable
 * on this side and nowhere else.
 *
 * The resolved slug could not travel to the browser instead. Renames resolve in
 * `init`, where `ctx` is in scope; `contributes.admin` is a static object built
 * without one, and there is no init-time API to add to it. So the question
 * travels rather than the fact it is asked about.
 *
 * ## Why it asks rather than computes
 *
 * `ctx.caller.can` is the framework's own answer — a scoped API key judged on
 * its own stamped grants and the code-defined rule, a session through the RBAC
 * service with its super-admin bypass. Deriving permissions here from a user id
 * would be a second implementation of "what may this caller do", which drifts
 * silently from the one the write is judged by, and would answer differently
 * for the API keys the first one exists to hold.
 *
 * ## NOT a security boundary
 *
 * `savePatternRoute` authorizes its own write. This only decides whether a
 * control is offered, so a caller who never asks, or who disbelieves the
 * answer, gains nothing by it.
 *
 * @module capability-route
 */

import { COMPONENT_DOCUMENT_FIELD } from "@nextlyhq/blocks-react";

import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";
import { isHostStore } from "./composition-route-kit";
import {
  CAPABILITY_ROUTE_PATH,
  type PatternCapabilityResponse,
} from "./library-contract";
import type { ComponentStore } from "./library-route";
import { SAVED_PATTERN_STATUS } from "./save-pattern-route";

/**
 * What this route needs of the plugin route context.
 *
 * Structural rather than the published `PluginRouteContext`, matching
 * `LibraryRouteContext` beside it: it names exactly what is read, so a test can
 * supply it without booting a server and a reader can see the whole dependency.
 */
export interface CapabilityRouteContext {
  readonly self: { readonly collections: Record<string, string | undefined> };
  readonly caller: {
    can: (action: string, resource: string) => Promise<boolean>;
  } | null;
}

/**
 * Answer whether this caller may create a pattern.
 *
 * A `null` caller cannot be anybody, so it may not create. That branch is not
 * reachable through this route — it is authenticated, so the dispatcher has
 * resolved a caller before the handler runs — but the type admits `null` for
 * the `public` routes that share the context, and reading it as "allowed" is
 * the direction that offers a control to a caller nobody identified.
 */
export async function readPatternCapability(
  ctx: CapabilityRouteContext
): Promise<PatternCapabilityResponse> {
  if (ctx.caller === null) return { mayCreate: false };
  return { mayCreate: await mayCreatePattern(ctx, ctx.caller) };
}

/**
 * Answer what this caller may do from the editor: create a pattern, and open
 * a component in its own view. A `null` caller may do neither.
 */
export async function readEditorCapability(
  ctx: CapabilityRouteContext,
  store: ComponentEditingStore = {}
): Promise<PatternCapabilityResponse> {
  if (ctx.caller === null) return { mayCreate: false, componentEditing: null };
  const [pattern, componentEditing] = await Promise.all([
    readPatternCapability(ctx),
    componentEditingFor(ctx, ctx.caller, store),
  ]);
  return { ...pattern, componentEditing };
}

/** Where component definitions live, as far as the editor's offer needs. */
type ComponentEditingStore = Partial<
  Pick<ComponentStore, "collection" | "field">
>;

type Caller = NonNullable<CapabilityRouteContext["caller"]>;

/** Whether this caller may create a pattern in the resolved collection. */
async function mayCreatePattern(
  ctx: CapabilityRouteContext,
  caller: Caller
): Promise<boolean> {
  const slug = ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG;
  // EVERY permission the save requires, not just the obvious one. The route
  // creates the row already published, and core resolves the publish grant
  // separately from create for exactly that transition — so an author holding
  // `create` and not `publish` would be told yes and refused by the write, which
  // is the failure this answer exists to prevent rather than relocate.
  //
  // DERIVED from the status the save persists, so a future save that stored a
  // draft stops asking for a grant it no longer needs. `every` rather than a
  // chain of `&&` because the list is the rule.
  const needed: string[] =
    SAVED_PATTERN_STATUS === "published" ? ["create", "publish"] : ["create"];
  for (const action of needed) {
    // Sequential, and it short-circuits: the second question costs a permission
    // read, and an author refused the first has already been answered.
    if (!(await caller.can(action, slug))) return false;
  }
  return true;
}

/**
 * Where this caller may open a component in its own view: the store the
 * definitions are read from (a configured one literally, the plugin's own
 * under the host's name for it) and the field they live in, when they may
 * read and update it; `null` otherwise. Both, because the view reads the
 * entry before it lets anyone edit it: an author who may update but not read
 * would be offered a screen that refuses them.
 */
async function componentEditingFor(
  ctx: CapabilityRouteContext,
  caller: Caller,
  store: ComponentEditingStore
): Promise<{ readonly collection: string; readonly field: string } | null> {
  const collection =
    store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  for (const action of ["read", "update"]) {
    if (!(await caller.can(action, collection))) return null;
  }
  return { collection, field: store.field ?? COMPONENT_DOCUMENT_FIELD };
}

/**
 * Whether this caller may make a component from a selection: `create` and
 * `publish` on the plugin's own components (under the host's name for them),
 * since the component is created published. Never where the host keeps its
 * components in a store of its own, which the route refuses.
 */
export async function mayCreateComponent(
  ctx: CapabilityRouteContext,
  store: Pick<ComponentStore, "collection"> = {}
): Promise<boolean> {
  // A host's own store is not one this plugin makes components in.
  if (ctx.caller === null || isHostStore(ctx, store)) return false;
  const slug = ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG;
  return (
    (await ctx.caller.can("create", slug)) &&
    (await ctx.caller.can("publish", slug))
  );
}

/**
 * Whether this caller may replace a pattern's content from a selection:
 * `read` (to choose the pattern and for the route's own read of it),
 * `update` and `publish` on the collection the host resolved.
 */
export async function mayUpdatePattern(
  ctx: CapabilityRouteContext
): Promise<boolean> {
  if (ctx.caller === null) return false;
  const slug = ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG;
  return (
    (await ctx.caller.can("read", slug)) &&
    (await ctx.caller.can("update", slug)) &&
    (await ctx.caller.can("publish", slug))
  );
}

/**
 * The route declaration.
 *
 * No `public: true`, so it is authenticated: the answer is about the caller and
 * a shared one would be wrong for everybody. No `requiredPermission` either —
 * the permission it reports on is the one being ASKED about, and gating the
 * question on the answer would return 403 to exactly the authors this exists to
 * tell "no" gracefully.
 */
export function patternCapabilityRoute(store: ComponentEditingStore = {}): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: CapabilityRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: CAPABILITY_ROUTE_PATH,
    handler: async (_req, ctx) =>
      Response.json({
        ...(await readEditorCapability(ctx, store)),
        mayCreateComponent: await mayCreateComponent(ctx, store),
        mayUpdatePattern: await mayUpdatePattern(ctx),
      } satisfies PatternCapabilityResponse),
  };
}
