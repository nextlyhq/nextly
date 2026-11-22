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
import {
  boundSettingId,
  COMPONENT_INSTANCE_TYPE,
  componentIdsIn,
  countNodes,
  documentBytes,
  isPlainRecord,
  MAX_COMPOSED_DEPTH,
  walkNodes,
  type BlockDocument,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  unsuppliedComponentIds,
  type ComponentSource,
} from "@nextlyhq/blocks-react";
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { readableTitleText } from "nextly/config";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { componentStoreShape } from "./component-facts-route";
import {
  AS_THE_SYSTEM,
  asDocument,
  publishedStoreSource,
  type StoreSourceDirectApi,
  type SystemReading,
} from "./component-store-source";
import { asCaller, readOrNull } from "./composition-route-kit";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { asOverwrite } from "./document-version";
import { chunked, ID_BATCH_SIZE } from "./id-batches";
import { areaComponentIds, layoutAreasDocument } from "./layout-areas-document";
import { readingAsUser, type ComponentStore } from "./library-route";
import {
  MAX_PUBLISHED_DEPENDENCIES,
  PUBLISH_DEPENDENCIES_ROUTE_PATH,
  PUBLISH_READINESS_ROUTE_PATH,
  type DependencyKind,
  type PublishDependenciesResult,
  type PublishReadinessResponse,
  type RefusedDependency,
  type UnpublishedDependency,
} from "./publish-readiness-contract";

/** The reads the plan makes, every one as the system. */
export interface ReadinessReads {
  /** Published definitions, as the renderer reads them. */
  readonly published: ComponentSource;
  /** The stored form of each component among `ids` that exists, any state. */
  readonly stored: (ids: readonly string[]) => Promise<Map<string, unknown>>;
  /**
   * The working draft of each component among `ids` that has one, which a
   * publish of the component puts live. Asked only of a live component the
   * documents use a setting of that its live version lacks; without it, no
   * such component is named.
   */
  readonly drafts?: (ids: readonly string[]) => Promise<Map<string, unknown>>;
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
  /**
   * Those of `components` that are live, named because only their working
   * draft has a setting the documents use. Absent when there are none.
   */
  readonly newSettings?: readonly string[];
}

/** The components and Layout a publish of `documents` would leave unpublished. */
export async function planPublishReadiness(
  request: {
    documents: readonly BlockDocument[];
    layout: string | null;
    /**
     * Whether `layout` is the site's default, which the page names none of
     * and falls to: drawn only while it is published, so an unpublished one
     * puts no regions around the page, and a page's publish offers nothing
     * for the Layout every page without one is drawn in.
     */
    siteDefault?: boolean;
    /**
     * False where components cannot be judged (a localized store publishes
     * per language): the Layout's own state is still answered.
     */
    judgeComponents?: boolean;
  },
  reads: ReadinessReads
): Promise<ReadinessPlan> {
  const named = await namedLayout(
    request.layout,
    request.siteDefault === true,
    reads
  );
  if (request.judgeComponents === false) {
    return { components: [], layout: named.unpublished, missing: 0 };
  }
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
  siteDefault: boolean,
  reads: ReadinessReads
): Promise<{ documents: BlockDocument[]; unpublished: string | null }> {
  const named = id === null ? null : await reads.layout(id);
  if (named === null) return { documents: [], unpublished: null };
  if (siteDefault) {
    return {
      documents: named.published ? [layoutAreasDocument(named.components)] : [],
      unpublished: null,
    };
  }
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
): Promise<Omit<ReadinessPlan, "layout">> {
  // Discovery order, kept, so the answer can be published deepest first.
  const planned = new Map<string, unknown>();
  const newSettings: string[] = [];
  const gone = new Set<string>();
  const source = supplying(reads, planned);
  // Until a fixed point, as the render's own discovery runs, never for a
  // fixed number of rounds: a supplied definition can free node budget and
  // reveal another missing id at the same depth, so rounds can outnumber
  // levels. It ends on its own: a round goes on only when it names an id not
  // yet planned or gone, and both only grow, over the components the store
  // holds.
  for (;;) {
    if (await planAsked(documents, source, reads, planned, gone)) continue;
    // Then the live components whose new settings the documents use, each
    // supplied from its draft for the next round, which may place more.
    const drafted = await settingsOnlyDrafted(
      documents,
      planned,
      reads,
      source
    );
    if (drafted.size === 0) break;
    for (const [id, draft] of drafted) {
      planned.set(id, draft);
      newSettings.push(id);
    }
  }
  return {
    components: dependencyOrder(planned),
    missing: gone.size,
    ...(newSettings.length === 0 ? {} : { newSettings }),
  };
}

/**
 * One round of the render's discovery: each id the documents ask for that is
 * neither planned nor gone, planned from its stored form or counted gone.
 * Whether the round asked for anything.
 */
async function planAsked(
  documents: readonly BlockDocument[],
  source: ComponentSource,
  reads: ReadinessReads,
  planned: Map<string, unknown>,
  gone: Set<string>
): Promise<boolean> {
  const asked = await askedFor(
    documents,
    source,
    reads.limits,
    id => planned.has(id) || gone.has(id)
  );
  if (asked.length === 0) return false;
  const stored = await reads.stored(asked);
  for (const id of asked) {
    if (stored.has(id)) planned.set(id, stored.get(id));
    else gone.add(id);
  }
  return true;
}

/**
 * The live components a placement in the documents uses a setting of, binds
 * it or sets it, that only the component's working draft has, by id with
 * that draft.
 *
 * A setting made from a page is written to the component's draft with the
 * page's Save, so a page published later binds a setting its live component
 * lacks, and a visitor would see the component as if it were not bound.
 * Asked of what is stored at every publish rather than remembered by the
 * editor that made it, so it holds after a Save, a reload or the form. Named
 * as any component the page needs, and published only when the author
 * chooses to in the dialog, which publishes the draft's other changes too.
 */
async function settingsOnlyDrafted(
  documents: readonly BlockDocument[],
  planned: ReadonlyMap<string, unknown>,
  reads: ReadinessReads,
  /** The definitions the render would compose with, the planned ones over the live. */
  source: ComponentSource
): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>();
  if (reads.drafts === undefined) return found;
  const used = new Map<string, Set<string>>();
  for (const document of await composedFrom(documents, planned, reads)) {
    settingsUsedIn(document, used);
  }
  for (const id of planned.keys()) used.delete(id);
  if (used.size === 0) return found;
  const live = await reads.published([...used.keys()]);
  // An unpublished component is named by the render's own discovery; only a
  // live one lacking a setting the documents use asks for its draft.
  const lacking = new Map<string, string[]>();
  for (const [id, settings] of used) {
    if (!live.has(id)) continue;
    const liveHas = settingIdsOf(live.get(id));
    const missing = [...settings].filter(setting => !liveHas.has(setting));
    if (missing.length > 0) lacking.set(id, missing);
  }
  if (lacking.size === 0) return found;
  const drafts = await reads.drafts([...lacking.keys()]);
  for (const [id, missing] of lacking) {
    const draft = drafts.get(id);
    const draftHas = settingIdsOf(draft);
    if (!missing.some(setting => draftHas.has(setting))) continue;
    if (await composes(documents, id, source, reads.limits)) {
      found.set(id, draft);
    }
  }
  return found;
}

/**
 * The documents, and every definition they compose: each planned one in the
 * form it goes live in, and each live one reached, level by level to the
 * depth the render composes. A setting bound inside a component placed on
 * the page is one the page needs as much as its own.
 */
async function composedFrom(
  documents: readonly BlockDocument[],
  planned: ReadonlyMap<string, unknown>,
  reads: ReadinessReads
): Promise<BlockDocument[]> {
  const all = [...documents];
  for (const stored of planned.values()) {
    const definition = asDocument(stored);
    if (definition !== null) all.push(definition);
  }
  const seen = new Set(planned.keys());
  const unseen = (from: readonly BlockDocument[]): string[] => [
    ...new Set(
      from.flatMap(document =>
        componentIdsIn(document.nodes).filter(id => !seen.has(id))
      )
    ),
  ];
  let frontier = unseen(all);
  for (let depth = 0; frontier.length > 0 && depth < MAX_COMPOSED_DEPTH; ) {
    depth += 1;
    for (const id of frontier) seen.add(id);
    const live = [...(await reads.published(frontier)).values()];
    all.push(...live);
    frontier = unseen(live);
  }
  return all;
}

/**
 * Whether the render composing the documents reaches component `id`, asked
 * of the render's own discovery with `id` withheld: it names a component it
 * reached and was not given. The walk that found the setting reads stored
 * trees, slot content a definition discards included; this is what decides
 * whether a visitor meets the component at all.
 */
async function composes(
  documents: readonly BlockDocument[],
  id: string,
  source: ComponentSource,
  limits: DocumentLimits
): Promise<boolean> {
  const withheld: ComponentSource = async ids => {
    const found = new Map(await source(ids.filter(each => each !== id)));
    found.delete(id);
    return found;
  };
  for (const document of documents) {
    if (
      (await unsuppliedComponentIds(document, withheld, limits)).includes(id)
    ) {
      return true;
    }
  }
  return false;
}

/** Each placement's component, with the settings it binds or sets, into `used`. */
function settingsUsedIn(
  document: BlockDocument,
  used: Map<string, Set<string>>
): void {
  walkNodes(document.nodes, node => {
    if (node.type !== COMPONENT_INSTANCE_TYPE) return;
    const componentId = isPlainRecord(node.props)
      ? node.props.componentId
      : undefined;
    if (typeof componentId !== "string") return;
    const settings = used.get(componentId) ?? new Set<string>();
    const overrides = isPlainRecord(node.props) ? node.props.overrides : null;
    if (isPlainRecord(overrides)) {
      for (const id of Object.keys(overrides)) settings.add(id);
    }
    if (isPlainRecord(node.bindings)) {
      for (const key of Object.keys(node.bindings)) {
        const id = boundSettingId(key);
        if (id !== undefined) settings.add(id);
      }
    }
    if (settings.size > 0) used.set(componentId, settings);
  });
}

/** The ids of the settings a component definition declares. */
function settingIdsOf(definition: unknown): Set<string> {
  const ids = new Set<string>();
  const exposed = isPlainRecord(definition) ? definition.exposed : undefined;
  if (!Array.isArray(exposed)) return ids;
  for (const entry of exposed) {
    if (isPlainRecord(entry) && typeof entry.id === "string") ids.add(entry.id);
  }
  return ids;
}

/**
 * The planned components, each after every planned component it places, so
 * publishing them in turn never puts one live naming one that is not.
 *
 * From the placements each stored form holds rather than from discovery
 * order: two components found in the same round can place one another. A
 * loop, which the publish itself refuses, is broken where it is met.
 */
function dependencyOrder(planned: ReadonlyMap<string, unknown>): string[] {
  const ordered: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const document = asDocument(planned.get(id));
    for (const placed of componentIdsIn(document?.nodes ?? [])) {
      if (planned.has(placed)) visit(placed);
    }
    visiting.delete(id);
    done.add(id);
    ordered.push(id);
  };
  for (const id of planned.keys()) visit(id);
  return ordered;
}

/** The published definitions, with the planned ones supplied from storage. */
function supplying(
  reads: ReadinessReads,
  planned: ReadonlyMap<string, unknown>
): ComponentSource {
  // A planned component goes live in its planned form, over any live one: a
  // live component named for its draft's new setting is drawn as that draft.
  return async ids => {
    const found = new Map(await reads.published(ids));
    for (const id of ids) {
      if (planned.has(id)) found.set(id, planned.get(id) as BlockDocument);
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
type Reader = StoreSourceDirectApi<SystemReading> &
  Pick<DefaultLayoutDirectApi, "findSingle"> & {
    find(args: Record<string, unknown>): Promise<{ items: unknown[] }>;
    findByID(args: Record<string, unknown>): Promise<unknown>;
  };

/** The one read the reads by id need. */
type FindReader = Pick<Reader, "find">;

/** The resolved slugs and store a request is answered against. */
interface Stores {
  readonly components: string;
  readonly componentField: string;
  readonly layouts: string;
  /** The settings Single naming the site's default Layout. */
  readonly settings: string;
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
    settings:
      ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
      PAGE_BUILDER_SETTINGS_SLUG,
  };
}

/**
 * The rows among `ids`, in batches under the query clamp (see `id-batches`):
 * one query naming more answers for its first page only, and a row left off
 * it would read as gone, or as one the caller may not read.
 */
async function findByIds(
  nextly: FindReader,
  read: Record<string, unknown>,
  ids: readonly string[]
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const chunk of chunked(ids, ID_BATCH_SIZE)) {
    const found = await nextly.find({
      ...read,
      where: { id: { in: [...chunk] } },
      limit: chunk.length,
    });
    rows.push(...found.items);
  }
  return rows;
}

/** The system reads of one request. Exported for its tests. */
export function systemReads(
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
      const found = await findByIds(
        nextly,
        {
          ...AS_THE_SYSTEM,
          collection: stores.components,
          status: "all",
          depth: 0,
        },
        ids
      );
      const byId = new Map<string, unknown>();
      for (const item of found) {
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string") continue;
        const stored = row[stores.componentField];
        byId.set(row.id, asDocument(stored) ?? stored);
      }
      return byId;
    },
    // One read per id, as `draft` is a read of one document; asked only of
    // the few live components lacking a setting the page uses.
    drafts: async ids => {
      const byId = new Map<string, unknown>();
      for (const id of ids) {
        const row = await readOrNull(() =>
          nextly.findByID({
            ...AS_THE_SYSTEM,
            collection: stores.components,
            id,
            status: "all",
            draft: true,
            depth: 0,
          })
        );
        if (!isPlainRecord(row)) continue;
        const stored = row[stores.componentField];
        byId.set(id, asDocument(stored) ?? stored);
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

/**
 * The titles of `ids` the caller may read; an id absent here is hidden.
 * Exported for its tests and the address report.
 */
export async function titlesAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  nextly: FindReader,
  collection: string,
  ids: readonly string[],
  /** The field naming the collection's entries (`titleFieldIn`). */
  titleField = "title"
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (ids.length === 0) return titles;
  for (const item of await readableAsCaller(ctx, nextly, collection, ids)) {
    const row = item as Record<string, unknown>;
    if (typeof row.id === "string") {
      titles.set(row.id, titleOf(row[titleField]));
    }
  }
  return titles;
}

/**
 * A stored title as the dialog names it: core's reading of a title value
 * (`readableTitleText`, a nominated number included), as the admin and the
 * entries route name an entry, or "Untitled".
 */
function titleOf(value: unknown): string {
  return readableTitleText(value) ?? "Untitled";
}

/**
 * The rows among `ids` the caller may read, through core's read access, as
 * every route in this package reads as the caller (`readingAsUser`).
 */
async function readableAsCaller(
  ctx: Pick<PluginRouteContext, "caller">,
  nextly: FindReader,
  collection: string,
  ids: readonly string[]
): Promise<unknown[]> {
  const asUser = await readingAsUser(ctx);
  try {
    return await findByIds(
      nextly,
      { ...asUser, collection, status: "all", depth: 0 },
      ids
    );
  } catch (error) {
    // A caller who may not read the collection at all reads none of it.
    if (NextlyError.isForbidden(error)) return [];
    throw error;
  }
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
    // Bounded by the work they ask for, not by how many: see `documentsWithin`.
    documents: z.array(z.unknown()),
    layout: z.string().trim().min(1).max(256).nullable().optional(),
    siteDefault: z.boolean().optional(),
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
 * The work one readiness request may ask for, in documents of the largest
 * size the site allows.
 */
const READINESS_BUDGET_IN_DOCUMENTS = 8;

/**
 * The request's block documents, refused past the work one request may ask
 * for: as many nodes, and as many bytes, as `READINESS_BUDGET_IN_DOCUMENTS`
 * documents of the largest size the site allows. Bounded by size rather than
 * by documents, because a form may hold any number of blocks fields, each one
 * document, and every one of them is asked about; each counts as at least one
 * node, so a flood of empty ones is bounded too, and bytes as well as nodes,
 * so a few nodes carrying large props are bounded as well. Exported for its
 * tests.
 */
export function documentsWithin(
  values: readonly unknown[],
  limits: DocumentLimits
): BlockDocument[] {
  const nodeBudget = READINESS_BUDGET_IN_DOCUMENTS * limits.maxNodes;
  const byteBudget = READINESS_BUDGET_IN_DOCUMENTS * limits.maxBytes;
  const documents: BlockDocument[] = [];
  let nodes = 0;
  let bytes = 0;
  for (const value of values) {
    const document = asDocument(value);
    const size = document === null ? null : sizeOf(document);
    nodes += Math.max(1, size?.nodes ?? 0);
    bytes += size?.bytes ?? 0;
    if (nodes > nodeBudget || bytes > byteBudget) {
      throw NextlyError.invalidInput({
        message: "The request asks about more than one request may.",
        logContext: { reason: "publish-readiness-over-budget" },
      });
    }
    if (document !== null) documents.push(document);
  }
  return documents;
}

/**
 * A document's nodes and serialized bytes, or more than any budget when it is
 * too large to measure.
 */
function sizeOf(document: BlockDocument): { nodes: number; bytes: number } {
  try {
    return {
      nodes: countNodes(document.nodes),
      bytes: documentBytes(document),
    };
  } catch {
    // Both refuse only a document too large to measure.
    return {
      nodes: Number.POSITIVE_INFINITY,
      bytes: Number.POSITIVE_INFINITY,
    };
  }
}

/**
 * `POST /publish-readiness`.
 *
 * Authenticated, with no declared permission of its own: it is asked before
 * any publish, including a site manager's choice of the default Layout, who
 * need not read the component library. It writes nothing, names only what
 * the caller may read (a part they may not is counted under an opaque key),
 * and decides nothing: each publish is judged by core.
 */
export function publishReadinessRoute(setup: PublishReadinessSetup): {
  method: "POST";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: PUBLISH_READINESS_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    handler: async (req, ctx) => {
      const body = await bodyOf(req, READINESS_BODY);
      if (!setup.enabled || ctx.caller === null) {
        return Response.json(NOTHING);
      }
      const limits = setup.limits();
      const documents = documentsWithin(body.documents, limits);
      const stores = storesOf(ctx, setup.store);
      const nextly = requireNextly() as unknown as Reader;
      const plan = await planPublishReadiness(
        {
          documents,
          ...(await layoutAsked(body, nextly, stores)),
          // A localized store publishes per language, and a published read
          // answers for none in particular: components are not judged there,
          // as the readiness notice does not judge them, rather than named
          // as missing while live. The Layout's own state still is.
          // Read through the store's one shape reader, which says whether it
          // is localized, as the component facts route reads it.
          judgeComponents: !(
            await componentStoreShape(
              ctx.services.collections,
              stores.components,
              ctx.user
            )
          ).localized,
        },
        systemReads(nextly, stores, limits)
      );
      return Response.json(await describePlan(ctx, nextly, stores, plan));
    },
  };
}

/**
 * The Layout a request asks about: the one the page names, or, for a page
 * that names none and still draws its header and footer, the site's default,
 * read as the published page reads it.
 */
async function layoutAsked(
  body: { layout?: string | null; siteDefault?: boolean },
  nextly: Reader,
  stores: Stores
): Promise<{ layout: string | null; siteDefault: boolean }> {
  if (typeof body.layout === "string" || body.siteDefault !== true) {
    return { layout: body.layout ?? null, siteDefault: false };
  }
  const { defaultLayout } = await readLayoutSettings(nextly, stores);
  return { layout: defaultLayout, siteDefault: true };
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
  // A component the author may not read is counted, never identified: its id
  // came from a system read, and naming it would tell them what the
  // access-enforced reads do not.
  let hidden = 0;
  const newSettings = new Set(plan.newSettings);
  const dependencies: UnpublishedDependency[] = plan.components.map(id => {
    const title = componentTitles.get(id) ?? null;
    return title === null
      ? {
          kind: "component",
          id: `hidden-${String((hidden += 1))}`,
          title,
          mayPublish: false,
        }
      : {
          kind: "component",
          id,
          title,
          mayPublish: mayPublishComponents,
          ...(newSettings.has(id) ? { newSettings: true } : {}),
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
      // The page names this id itself, but its title is still the caller's.
      id: title === null ? "hidden-layout" : plan.layout,
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
 * document's own validation decide each one. That is the route's whole
 * authorization: it names no permission of its own, since a Layout's author
 * may publish a Layout without reading any component, and a permission on
 * one collection would refuse a write core allows on the other. One refusal
 * does not stop the rest: the author asked for each of them, and the page
 * publishes regardless. Nothing here reads the documents it publishes, so
 * each write chooses to publish whatever is stored (`_overwrite`) rather than
 * sending a version.
 */
export function publishDependenciesRoute(setup: PublishReadinessSetup): {
  method: "POST";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: PUBLISH_DEPENDENCIES_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
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
            asOverwrite({ status: "published" }),
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
