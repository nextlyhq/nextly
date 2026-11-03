/**
 * What a publish would leave unpublished, asked before it, and the offer to
 * publish those documents too.
 *
 * A page, its components and its Layout are separate documents with separate
 * lifecycles. Publishing the page says nothing about the others, so a visitor
 * meets a missing-component marker, or the site's default Layout, where the
 * author expected their work. The editor asks this route before a publish,
 * warns, and offers to publish what the page needs. It never blocks: publishing
 * a page first is an ordinary order of work.
 *
 * ## Which components it names
 *
 * The render's own discovery answers, through `unsuppliedComponentIds`, so a
 * component named here is one a visitor would actually miss: not a gated
 * instance, not slot content the chosen definition discards. A component that
 * is itself unpublished hides the components IT places, since an unpublished
 * definition is never read, so the walk is repeated with each named component
 * supplied from its stored form until nothing new is asked for. Publishing the
 * first round alone would leave the page holed one level down.
 *
 * Read as the system, because the question is about lifecycles, not about what
 * this author may read: an author who cannot read a component still needs to
 * know their page has a hole there. What the author may read and publish is
 * asked separately, as the author.
 *
 * ## Publishing them as the author, never with more
 *
 * The second route publishes each chosen document through the same write the
 * document's own screen makes, as the caller, with a key's own scope. Core
 * judges each one, so an author who may publish the page but not a component
 * publishes the page and is told the component stayed unpublished, and why.
 * The readiness answer's `mayPublish` only decides what the dialog offers.
 *
 * @module publish-readiness
 */
import type { BlockDocument, DocumentLimits } from "@nextlyhq/blocks-engine";
import {
  unsuppliedComponentIds,
  type ComponentSource,
} from "@nextlyhq/blocks-react";
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { storeIsLocalized } from "./component-facts-route";
import {
  AS_THE_SYSTEM,
  asDocument,
  publishedStoreSource,
  type StoreSourceDirectApi,
  type SystemReading,
} from "./component-store-source";
import {
  asCaller,
  type CompositionRouteContext,
} from "./composition-route-kit";
import { areaComponentIds, layoutAreasDocument } from "./layout-areas-document";
import { componentReadPermission, type ComponentStore } from "./library-route";
import {
  MAX_PUBLISHED_DEPENDENCIES,
  MAX_READINESS_DOCUMENTS,
  PUBLISH_DEPENDENCIES_ROUTE_PATH,
  PUBLISH_READINESS_ROUTE_PATH,
  type DependencyKind,
  type PublishDependenciesResult,
  type PublishReadinessResponse,
  type RefusedDependency,
  type UnpublishedDependency,
} from "./publish-readiness-contract";

/**
 * How many times the walk is repeated with newly named components supplied.
 * Each round reaches one level deeper; the composition depth limit stops far
 * sooner, so this only guards the loop.
 */
const MAX_ROUNDS = 16;

/** The reads the plan makes, every one as the system. */
export interface ReadinessReads {
  /** Published definitions, as the renderer reads them. */
  readonly published: ComponentSource;
  /** The stored form of each component among `ids` that exists, any state. */
  readonly stored: (ids: readonly string[]) => Promise<Map<string, unknown>>;
  /** The Layout `id`: whether it is live and what its areas name; null if gone. */
  readonly layout: (
    id: string
  ) => Promise<{ published: boolean; components: string[] } | null>;
  readonly limits: DocumentLimits;
}

/** What a publish would leave unpublished. */
export interface ReadinessPlan {
  /** Deepest first, so each goes live before anything that places it. */
  readonly components: readonly string[];
  /** The Layout the page names, when it is not published. */
  readonly layout: string | null;
  /** Placed components that no longer exist. */
  readonly missing: number;
}

/** The components and Layout a publish of `documents` would leave unpublished. */
export async function planPublishReadiness(
  request: { documents: readonly BlockDocument[]; layout: string | null },
  reads: ReadinessReads
): Promise<ReadinessPlan> {
  const named = await namedLayout(request.layout, reads);
  const documents = [...request.documents, ...named.documents];
  const walk = await unpublishedComponents(documents, reads);
  return { ...walk, layout: named.unpublished };
}

/**
 * The Layout a page names: its areas as a document, since they draw around
 * the page and a component they name is one the page needs as much as its
 * own, and its id when it is not published.
 */
async function namedLayout(
  id: string | null,
  reads: ReadinessReads
): Promise<{ documents: BlockDocument[]; unpublished: string | null }> {
  const named = id === null ? null : await reads.layout(id);
  if (named === null) return { documents: [], unpublished: null };
  return {
    documents: [layoutAreasDocument(named.components)],
    unpublished: named.published ? null : id,
  };
}

/**
 * Every unpublished component the documents need, deepest first, and how
 * many they place that no longer exist.
 *
 * Each round supplies the components named so far from their stored form, so
 * the next round sees what THEY place; it stops when a round names nothing
 * new.
 */
async function unpublishedComponents(
  documents: readonly BlockDocument[],
  reads: ReadinessReads
): Promise<{ components: string[]; missing: number }> {
  // Discovery order, kept, so the answer can be published deepest first.
  const planned = new Map<string, unknown>();
  const gone = new Set<string>();
  const source = supplying(reads, planned);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const asked = await askedFor(
      documents,
      source,
      reads.limits,
      id => planned.has(id) || gone.has(id)
    );
    if (asked.length === 0) break;
    const stored = await reads.stored(asked);
    for (const id of asked) {
      if (stored.has(id)) planned.set(id, stored.get(id));
      else gone.add(id);
    }
  }
  return { components: [...planned.keys()].reverse(), missing: gone.size };
}

/** The published definitions, with the planned ones supplied from storage. */
function supplying(
  reads: ReadinessReads,
  planned: ReadonlyMap<string, unknown>
): ComponentSource {
  return async ids => {
    const found = new Map(await reads.published(ids));
    for (const id of ids) {
      if (!found.has(id) && planned.has(id)) {
        found.set(id, planned.get(id) as BlockDocument);
      }
    }
    return found;
  };
}

/** The ids the documents ask for that the source does not supply, new ones only. */
async function askedFor(
  documents: readonly BlockDocument[],
  source: ComponentSource,
  limits: DocumentLimits,
  known: (id: string) => boolean
): Promise<string[]> {
  const asked = new Set<string>();
  for (const document of documents) {
    const missing = await unsuppliedComponentIds(document, source, limits);
    for (const id of missing) if (!known(id)) asked.add(id);
  }
  return [...asked];
}

/** The Direct API reads the routes make. */
type Reader = StoreSourceDirectApi<SystemReading> & {
  find(args: Record<string, unknown>): Promise<{ items: unknown[] }>;
};

/** The resolved slugs and store a request is answered against. */
interface Stores {
  readonly components: string;
  readonly componentField: string;
  readonly layouts: string;
}

function storesOf(
  ctx: Pick<PluginRouteContext, "self">,
  store: ComponentStore
): Stores {
  return {
    components:
      store.collection ??
      ctx.self.collections[COMPONENTS_SLUG] ??
      COMPONENTS_SLUG,
    componentField: store.field,
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
  };
}

/** The system reads of one request. */
function systemReads(
  nextly: Reader,
  stores: Stores,
  limits: DocumentLimits
): ReadinessReads {
  return {
    published: publishedStoreSource(nextly, {
      collection: stores.components,
      field: stores.componentField,
      reading: AS_THE_SYSTEM,
    }),
    stored: async ids => {
      const found = await nextly.find({
        ...AS_THE_SYSTEM,
        collection: stores.components,
        where: { id: { in: [...ids] } },
        limit: ids.length,
        status: "all",
        depth: 0,
      });
      const byId = new Map<string, unknown>();
      for (const item of found.items) {
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string") continue;
        const stored = row[stores.componentField];
        byId.set(row.id, asDocument(stored) ?? stored);
      }
      return byId;
    },
    layout: async id => {
      const found = await nextly.find({
        ...AS_THE_SYSTEM,
        collection: stores.layouts,
        where: { id: { equals: id } },
        limit: 1,
        status: "all",
        depth: 0,
      });
      const row = found.items[0] as Record<string, unknown> | undefined;
      if (row === undefined) return null;
      return {
        published: row.status === "published",
        components: areaComponentIds(row.areas),
      };
    },
    limits,
  };
}

/** The titles of `ids` the caller may read; an id absent here is hidden. */
async function titlesAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  nextly: Reader,
  collection: string,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (ids.length === 0) return titles;
  const identity = await ctx.caller?.identity();
  const found = await nextly.find({
    collection,
    where: { id: { in: [...ids] } },
    limit: ids.length,
    status: "all",
    depth: 0,
    overrideAccess: false,
    user: identity?.user,
    ...(identity?.authenticatedScope === undefined
      ? {}
      : { actor: identity.authenticatedScope }),
  });
  for (const item of found.items) {
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    titles.set(row.id, title === "" ? "Untitled" : title);
  }
  return titles;
}

/** Whether the caller holds every grant named, on `resource`. */
async function holds(
  ctx: Pick<PluginRouteContext, "caller">,
  actions: readonly string[],
  resource: string
): Promise<boolean> {
  if (ctx.caller === null) return false;
  for (const action of actions) {
    if (!(await ctx.caller.can(action, resource))) return false;
  }
  return true;
}

const READINESS_BODY = z
  .object({
    documents: z.array(z.unknown()).max(MAX_READINESS_DOCUMENTS),
    layout: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .strict();

const PUBLISH_BODY = z
  .object({
    dependencies: z
      .array(
        z
          .object({
            kind: z.enum(["component", "layout"]),
            id: z.string().trim().min(1).max(256),
          })
          .strict()
      )
      .min(1)
      .max(MAX_PUBLISHED_DEPENDENCIES),
  })
  .strict();

/** A request body, or the refusal that names what is wrong with it. */
async function bodyOf<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "The request body is not JSON.",
      logContext: { reason: "publish-readiness-body-not-json" },
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: {
        reason: "publish-readiness-body-invalid",
        issues: parsed.error.issues.map(issue => issue.path.join(".")),
      },
    });
  }
  return parsed.data;
}

/** What the routes need from the plugin's setup. */
export interface PublishReadinessSetup {
  readonly store: ComponentStore;
  /** False where the host renders components from a source of its own. */
  readonly enabled: boolean;
  readonly limits: () => DocumentLimits;
}

const NOTHING: PublishReadinessResponse = { dependencies: [], missing: 0 };

/**
 * `POST /publish-readiness`. Gated on reading the component store, as the
 * component library is; the editor that asks has already read it.
 */
export function publishReadinessRoute(setup: PublishReadinessSetup): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: PUBLISH_READINESS_ROUTE_PATH,
    requiredPermission: componentReadPermission(setup.store),
    handler: async (req, ctx) => {
      const body = await bodyOf(req, READINESS_BODY);
      if (!setup.enabled) return Response.json(NOTHING);
      const stores = storesOf(ctx, setup.store);
      // A localized store publishes per language, and a published read
      // answers for none in particular: the readiness notice says nothing
      // there either, rather than naming live components as missing.
      if (
        await storeIsLocalized(
          ctx.services.collections,
          stores.components,
          ctx.user
        )
      ) {
        return Response.json(NOTHING);
      }
      const nextly = requireNextly() as unknown as Reader;
      const plan = await planPublishReadiness(
        {
          documents: body.documents
            .map(asDocument)
            .filter((document): document is BlockDocument => document !== null),
          layout: body.layout ?? null,
        },
        systemReads(nextly, stores, setup.limits())
      );
      return Response.json(await describePlan(ctx, nextly, stores, plan));
    },
  };
}

/** The plan in the author's terms: titles they may read, and their rights. */
async function describePlan(
  ctx: Pick<PluginRouteContext, "caller">,
  nextly: Reader,
  stores: Stores,
  plan: ReadinessPlan
): Promise<PublishReadinessResponse> {
  const componentTitles = await titlesAsCaller(
    ctx,
    nextly,
    stores.components,
    plan.components
  );
  const mayPublishComponents = await holds(ctx, ["publish"], stores.components);
  const dependencies: UnpublishedDependency[] = plan.components.map(id => {
    const title = componentTitles.get(id) ?? null;
    return {
      kind: "component",
      id,
      title,
      mayPublish: mayPublishComponents && title !== null,
    };
  });
  if (plan.layout !== null) {
    const title =
      (await titlesAsCaller(ctx, nextly, stores.layouts, [plan.layout])).get(
        plan.layout
      ) ?? null;
    // A Layout wraps every page naming it, so offering to publish one asks
    // for update as well as publish on Layouts, as choosing the default does.
    const mayPublishLayouts = await holds(
      ctx,
      ["update", "publish"],
      stores.layouts
    );
    dependencies.push({
      kind: "layout",
      id: plan.layout,
      title,
      mayPublish: mayPublishLayouts && title !== null,
    });
  }
  return { dependencies, missing: plan.missing };
}

/** The author's words for a publish core refused. */
function refusalReason(error: unknown): string {
  if (NextlyError.isForbidden(error)) {
    return "You don't have permission to publish it.";
  }
  if (NextlyError.isNotFound(error)) return "It no longer exists.";
  if (NextlyError.is(error)) return error.publicMessage;
  return "It couldn't be published.";
}

/**
 * `POST /publish-dependencies`. Publishes each chosen document as the caller,
 * in the order given, and reports each one it did not.
 *
 * Every write is a status-only update through core's collection service, the
 * same write a document's own Publish makes, so core's publish rule and the
 * document's own validation decide each one. One refusal does not stop the
 * rest: the author asked for each of them, and the page publishes regardless.
 */
export function publishDependenciesRoute(setup: PublishReadinessSetup): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: PUBLISH_DEPENDENCIES_ROUTE_PATH,
    requiredPermission: componentReadPermission(setup.store),
    handler: async (req, ctx) => {
      const body = await bodyOf(req, PUBLISH_BODY);
      const stores = storesOf(ctx, setup.store);
      const published: { kind: DependencyKind; id: string }[] = [];
      const refused: RefusedDependency[] = [];
      const seen = new Set<string>();
      for (const { kind, id } of body.dependencies) {
        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await ctx.services.collections.updateEntry(
            kind === "component" ? stores.components : stores.layouts,
            id,
            { status: "published" },
            asCaller(ctx)
          );
          published.push({ kind, id });
        } catch (error) {
          refused.push({ kind, id, reason: refusalReason(error) });
        }
      }
      return respondMutation<PublishDependenciesResult>(
        refused.length === 0
          ? "Published."
          : `${String(refused.length)} could not be published.`,
        { published, refused }
      );
    },
  };
}
