/**
 * The Layouts an author may choose for a page, read as that author.
 *
 * One request answers everything the editor's Layout picker and canvas need:
 * which Layouts exist and whether each is published, which one is the site's
 * default, whether the author may edit Layouts, and the PUBLISHED definitions
 * of the components a Layout's regions draw. The canvas shows what a visitor
 * gets, so the regions are read at the posture the published route reads
 * them; the published-ness and draft facts are what the picker's words say.
 *
 * Read AS THE CALLER, gated by `read` on the Layouts collection: an author who
 * may not read Layouts is refused here, and the picker then says so rather
 * than offering choices it cannot name.
 *
 * @module layout-choices-route
 */
import {
  componentIdsIn,
  DEFAULT_LIMITS,
  regionDocument,
  regionsOf,
  type BlockDocument,
  type DocumentLimits,
  type LayoutRegion,
} from "@nextlyhq/blocks-engine";
import { definitionsFor } from "@nextlyhq/blocks-react";
import {
  NextlyError,
  PENDING_CHANGE_KEY,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGES_SLUG } from "./collections/pages";
import { TEMPLATES_SLUG } from "./collections/templates";
import { publishedStoreSource } from "./component-store-source";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  starterRecordStore,
  untouchedStarterArea,
  type StarterRecord,
} from "./default-layout/starter-record";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { idsKeptByWorkflowKey } from "./entry-reads";
import {
  LAYOUT_CHOICES_DRAFTS_PARAM,
  LAYOUT_CHOICES_LOCALE_PARAM,
  LAYOUT_CHOICES_PICTURES_PARAM,
  LAYOUT_CHOICES_ROUTE_PATH,
  LAYOUT_CHOICES_SEARCH_PARAM,
  LAYOUT_CHOICES_SELECTED_PARAM,
  LAYOUT_ID_MAX,
  LAYOUT_LOCALE_MAX,
  LAYOUT_SEARCH_MAX,
  PAGE_COLLECTION_ROUTE_PATH,
  type LayoutChoice,
  type LayoutChoicesResponse,
  type PageCollectionResponse,
  type RegionComponentFacts,
} from "./layout-choices-contract";
import { fencedStateOf } from "./layout-removal/page-reference-guard";
import {
  layoutRemovalStore,
  type LayoutRemovalStore,
} from "./layout-removal/store";
import type { FencedLayoutState } from "./layout-removal/words";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
import { parseRouteQuery } from "./route-query";

/**
 * How many Layouts one answer lists. A site has a handful; the bound is there
 * so a store that grew without one cannot hold the editor's first paint. The
 * page's selected Layout and the default are answered for past it.
 */
const MAX_LAYOUT_CHOICES = 200;

/** The Direct API surface the read uses, picked from the real type. */
export type LayoutChoicesDirectApi = Pick<
  DefaultLayoutDirectApi,
  "find" | "findByID" | "findSingle"
>;

/** The route context the read uses. */
export type LayoutChoicesContext = Pick<PluginRouteContext, "caller" | "self">;

/** What the editor asked about, and how the published renderer reads. */
export interface LayoutChoicesRequest {
  /** The Layout the page has selected, by id, or null for none. */
  readonly selected: string | null;
  /**
   * Where each listed Layout stands with Remove Layout's fence, asked once for
   * the whole list. Absent, no Layout is marked.
   */
  readonly fence?: {
    removalStates(
      layoutIds: readonly string[]
    ): Promise<ReadonlyMap<string, FencedLayoutState>>;
  };
  /** Where component definitions are stored, as the plugin was told. */
  readonly store: ComponentStore;
  /**
   * The bounds the published renderer discovers definitions under, so a
   * nested component the page draws is one the editor fetched.
   */
  readonly limits: DocumentLimits;
  /** The language being edited; none is the default language. */
  readonly locale?: string | undefined;
  /** Text Layout titles must contain, to reach those past the list's bound. */
  readonly search?: string | undefined;
  /**
   * Whether every listed set's picture is asked for: the definitions of each
   * listed published set's regions, not only the two a page is drawn inside.
   */
  readonly pictures?: boolean;
  /**
   * Whether every listed published set's "changes not published" is asked
   * for, not only the two a page is drawn inside.
   */
  readonly drafts?: boolean;
  /**
   * The starter header and footer the site was seeded with, as recorded.
   * Absent, no region is told it shows the starter.
   */
  readonly starter?: () => Promise<StarterRecord | "made" | null>;
}

type Row = Record<string, unknown>;
type AsUser = Awaited<ReturnType<typeof readingAsUser>>;

/** The rows of a list read, whatever shape a double answers with. */
function rowsOf(found: { items?: unknown }): Row[] {
  return Array.isArray(found.items)
    ? found.items.filter(
        (item): item is Row => typeof item === "object" && item !== null
      )
    : [];
}

/**
 * Whether a by-id draft read surfaced a pending working draft: the query
 * service marks the row it overlays, and only a published row with a newer
 * draft is overlaid.
 */
function hasPendingDraft(row: unknown): boolean {
  return (
    typeof row === "object" &&
    row !== null &&
    (row as { _isWorkingDraft?: unknown })._isWorkingDraft === true
  );
}

/**
 * Read the Layout choices for the caller.
 *
 * A FIXED number of reads, whatever the number of Layouts: the list, the
 * selected and default Layouts when the list's bound cut them, the draft
 * facts of those two and their region components, and the definitions in
 * batches. Draft facts need a read by id, since only that read overlays a
 * working draft, so they are asked only of the two Layouts a page can be drawn
 * inside and their components. Each is read as this author: the service shows
 * a working draft only to a caller who may update or publish that row, so the
 * read tells anyone else nothing.
 */
export async function readLayoutChoices(
  ctx: LayoutChoicesContext,
  nextly: LayoutChoicesDirectApi,
  request: LayoutChoicesRequest
): Promise<LayoutChoicesResponse> {
  const layouts = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const components =
    request.store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  const settings =
    ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ?? PAGE_BUILDER_SETTINGS_SLUG;
  // AS THE CALLER, every read below: a route reading as the instance would
  // answer every author with every Layout, whatever their rights say.
  const asUser = await readingAsUser(ctx);

  // In the language being edited: a Layout's regions are region content.
  const inLocale =
    request.locale === undefined ? {} : { locale: request.locale };
  const listing = await nextly.find({
    collection: layouts,
    ...asUser,
    ...inLocale,
    ...(request.search === undefined
      ? {}
      : { where: { title: { contains: request.search } } }),
    // Every lifecycle state the caller may read: an unpublished Layout is a
    // choice the picker offers, marked as such.
    status: "all",
    sort: "title",
    limit: MAX_LAYOUT_CHOICES,
    depth: 0,
  });
  const listed = rowsOf(listing);
  const { defaultLayout } = await readLayoutSettings(nextly, {
    layouts,
    settings,
  });
  // The two Layouts the page can be drawn inside, in that order.
  const focus = [
    ...new Set(
      [request.selected, defaultLayout].filter(
        (id): id is string => id !== null
      )
    ),
  ];
  const rows = [
    ...listed,
    ...(await rowsPastTheBound(nextly, layouts, focus, listed, {
      ...asUser,
      ...inLocale,
    })),
  ];
  const items = rows
    .map(choiceOf)
    .filter((item): item is LayoutChoice => item !== null);
  // The default, named only when the caller's own reads returned it: one
  // they cannot read is hidden from them or gone, and either way its id is
  // not theirs to learn. That one is set is all they are told.
  const defaultReadable =
    defaultLayout !== null && items.some(item => item.id === defaultLayout);

  const canUpdateLayouts = (await ctx.caller?.can("update", layouts)) === true;
  const canCreateLayouts = (await ctx.caller?.can("create", layouts)) === true;
  // Asked of any row, so a rule that lets an author update only some sets
  // still offers Rename; which ones is the write's to judge.
  const canUpdateAnyLayout =
    (await ctx.caller?.can("update", layouts, { anyEntry: true })) === true;
  const focused = items.filter(item => focus.includes(item.id));
  // Asked of each focused row as this author, whatever the collection-wide
  // answer: a rule may let them update this Layout and not others, and only
  // a read of the row can apply it. The service overlays a working draft only
  // for a caller who may update or publish that row, the one rule for who sees
  // a draft, so one who may do neither learns nothing.
  const drafts = await pendingDrafts(
    nextly,
    layouts,
    focused.filter(item => item.published).map(item => item.id),
    { ...asUser, ...inLocale }
  );
  const focusedComponents = [
    ...new Set(focused.flatMap(item => item.regions.map(r => r.componentId))),
  ];
  // Only the Layouts a page can be drawn inside: the canvas draws no other,
  // and every other Layout's graph would only grow the answer. The menu's
  // pictures draw every listed set, so asked for them, every one's is sent,
  // the two the page is drawn inside first. An unpublished set lists no
  // regions, so nothing of it is read.
  // Each picture is one set's own drawing, so each is discovered under its own
  // node bound: one bound across the whole menu would leave the sets past it
  // with no definitions, and their pictures drawn as broken.
  const regionDefinitions = await publishedDefinitions(
    nextly,
    {
      collection: components,
      field: request.store.field,
      locale: request.locale,
    },
    [
      focused.flatMap(item => item.regions),
      ...(request.pictures === true
        ? items
            .filter(item => !focus.includes(item.id))
            .map(item => item.regions)
        : []),
    ],
    { reading: asUser, limits: request.limits }
  );
  const reachable = reachableComponents(
    focusedComponents,
    regionDefinitions,
    request.limits
  );
  // Asked as this author of each component, for the reason the Layouts are.
  const componentDrafts = await pendingDrafts(
    nextly,
    components,
    // Each region's own component first, so a deep header cannot crowd the
    // footer's out of the bound.
    [
      ...new Set([...focusedComponents, ...[...reachable.values()].flat()]),
    ].slice(0, MAX_NESTED_DRAFT_READS),
    { ...asUser, ...inLocale }
  );

  // Asked for every listed set: one read of core's workflow filter, the
  // versions domain's one statement of a working draft with changes not yet
  // published, read as the caller, rather than a read by id per set.
  // Only for a caller who may update sets: a working draft is overlaid for
  // one who may change it, so one who may not learns nothing of a draft.
  const listedDrafts =
    request.drafts === true && canUpdateLayouts
      ? await idsKeptByWorkflowKey(
          async args => {
            const found = await nextly.find({
              collection: args.collection,
              ...(args.where === undefined ? {} : { where: args.where }),
              select: args.select,
              limit: args.limit,
              ...asUser,
              ...inLocale,
            });
            return { items: rowsOf(found), meta: found.meta };
          },
          layouts,
          items.filter(item => item.published).map(item => item.id),
          PENDING_CHANGE_KEY
        )
      : new Set<string>();

  const fenced =
    (await request.fence?.removalStates(items.map(item => item.id))) ??
    new Map<string, FencedLayoutState>();
  const starter =
    focusedComponents.length === 0
      ? null
      : ((await request.starter?.()) ?? null);

  return {
    items: items.map(item => {
      const removal = fenced.get(item.id);
      return {
        ...item,
        draftChangesNotLive: drafts.has(item.id) || listedDrafts.has(item.id),
        ...(removal === undefined ? {} : { removal }),
      };
    }),
    meta: {
      defaultLayout: defaultReadable ? defaultLayout : null,
      defaultUnreadable: defaultLayout !== null && !defaultReadable,
      layoutsCollection: layouts,
      canUpdateLayouts,
      canCreateLayouts,
      canUpdateAnyLayout,
      more:
        (listing as { meta?: { hasNext?: unknown } }).meta?.hasNext === true,
      // The rows the list read itself returned, which for a search are the
      // ones its query matched by the database's own collation. The page's
      // Layout and the default, added whatever the query, are not among them.
      matched: listed.flatMap(row => {
        const id = rowId(row);
        return id === null ? [] : [id];
      }),
      // A region has edits not live when ANY component it draws does: the
      // one it names, or one that component places, however deep.
      regionComponents: Object.fromEntries(
        focusedComponents.map((id): [string, RegionComponentFacts] => [
          id,
          {
            draftChangesNotLive: (reachable.get(id) ?? []).some(reached =>
              componentDrafts.has(reached)
            ),
            ...untouchedStarterFact(starter, id, regionDefinitions),
          },
        ])
      ),
      regionDefinitions,
    },
  };
}

/**
 * Whether component `id` is the site's untouched starter, judged by its
 * PUBLISHED definition as read for the canvas: what a visitor sees.
 */
function untouchedStarterFact(
  starter: StarterRecord | "made" | null,
  id: string,
  definitions: Readonly<Record<string, BlockDocument>>
): Pick<RegionComponentFacts, "untouchedStarter"> {
  if (starter === null || starter === "made") return {};
  const area = untouchedStarterArea(starter, id, definitions[id]);
  return area === null ? {} : { untouchedStarter: area };
}

/**
 * How many components a region's draft facts are asked of, nested ones
 * included. Each is a read by id, so the bound keeps a deep header from
 * costing a read per component it reaches; the first ones reached, the ones a
 * visitor sees first, are asked.
 */
const MAX_NESTED_DRAFT_READS = 25;

/**
 * Every component each region reaches, in the order reached: the one it names,
 * then those its definition places, and theirs, through the definitions read.
 */
function reachableComponents(
  tops: readonly string[],
  definitions: Readonly<Record<string, BlockDocument>>,
  limits: DocumentLimits
): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  for (const top of tops) {
    const order: string[] = [top];
    const seen = new Set(order);
    for (let at = 0; at < order.length; at += 1) {
      const nodes = (definitions[order[at]] as { nodes?: unknown })?.nodes;
      if (!Array.isArray(nodes)) continue;
      for (const id of componentIdsIn(nodes, limits.maxNodes)) {
        if (seen.has(id)) continue;
        seen.add(id);
        order.push(id);
      }
    }
    reached.set(top, order);
  }
  return reached;
}

/**
 * The selected and default Layouts the list's bound left out, in one read.
 *
 * Without them a page whose Layout sorts past the bound would be drawn inside
 * the default in the editor while the published route draws its own Layout.
 */
async function rowsPastTheBound(
  nextly: LayoutChoicesDirectApi,
  layouts: string,
  focus: readonly string[],
  listed: readonly Row[],
  reading: AsUser & { locale?: string }
): Promise<Row[]> {
  const have = new Set(listed.map(rowId));
  const missing = focus.filter(id => !have.has(id));
  if (missing.length === 0) return [];
  return rowsOf(
    await nextly.find({
      collection: layouts,
      where: { id: { in: missing } },
      ...reading,
      status: "all",
      limit: missing.length,
      depth: 0,
    })
  );
}

/** A row id is a string or a number, by dialect; anything else is no row. */
function rowId(row: Row): string | null {
  if (typeof row.id === "string" && row.id !== "") return row.id;
  if (typeof row.id === "number") return String(row.id);
  return null;
}

/**
 * One listed Layout as a choice, or null for a row with no id. Its draft fact
 * is filled in afterwards, for the Layouts it is asked of.
 */
function choiceOf(row: Row): LayoutChoice | null {
  const id = rowId(row);
  if (id === null) return null;
  const published = row.status === "published";
  // The main row of a published Layout IS its published version; a pending
  // edit lives in the working draft, which this read did not ask for. The
  // main row of one never published holds its own areas.
  const stored = regionsOf(row);
  return {
    id,
    title:
      typeof row.title === "string" && row.title.trim() !== "" ? row.title : id,
    published,
    draftChangesNotLive: false,
    regions: published ? stored : [],
    areasFilled: stored.map(region => region.area),
  };
}

/**
 * Which of `ids` hold a pending working draft.
 *
 * One read by id each, because only a read by id overlays a working draft: a
 * list read returns the live row whatever its `status`. The callers hand this
 * a bounded set, never a list's worth of rows.
 */
async function pendingDrafts(
  nextly: LayoutChoicesDirectApi,
  collection: string,
  ids: readonly string[],
  // In the language being edited: a working draft is kept per language.
  reading: AsUser & { locale?: string }
): Promise<Set<string>> {
  const found = await Promise.all(
    ids.map(async id => {
      try {
        const row = await nextly.findByID({
          collection,
          id,
          ...reading,
          status: "all",
          draft: true,
          depth: 0,
        });
        return hasPendingDraft(row) ? id : null;
      } catch (error) {
        // A row the caller may not read says nothing about a draft. Any
        // other failure fails the request, so the editor offers to try again
        // rather than silently dropping a warning the author needed.
        if (NextlyError.isForbidden(error) || NextlyError.isNotFound(error)) {
          return null;
        }
        throw error;
      }
    })
  );
  return new Set(found.filter((id): id is string => id !== null));
}

/**
 * The PUBLISHED definitions the regions reach, nested ones included.
 *
 * Discovered by the render's own discovery (`definitionsFor`) under the
 * renderer's own bounds, through the store read the readiness notice shares
 * with it, in the language being edited, so the canvas draws the graph the
 * published page draws. Read as the caller: a caller who may not read
 * components gets none, and each region then draws the marker a missing
 * component draws.
 */
async function publishedDefinitions(
  nextly: LayoutChoicesDirectApi,
  store: { collection: string; field: string; locale: string | undefined },
  drawings: readonly (readonly LayoutRegion[])[],
  read: { reading: AsUser; limits: DocumentLimits }
): Promise<Record<string, BlockDocument>> {
  const groups = drawings.filter(regions => regions.length > 0);
  if (groups.length === 0) return {};
  const source = publishedStoreSource(nextly, {
    ...store,
    reading: read.reading,
  });
  // The ids every drawing asks for in the same turn, read together: the
  // drawings start at once, so their reads coalesce into one batched read
  // rather than one store query per set.
  let gathering: {
    ids: string[];
    read: Promise<ReadonlyMap<string, BlockDocument>>;
  } | null = null;
  const gather = (
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, BlockDocument>> => {
    let current = gathering;
    if (current === null) {
      const batch: string[] = [];
      const read = new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      }).then(() => {
        gathering = null;
        return source(batch).catch(
          (error: unknown): ReadonlyMap<string, BlockDocument> => {
            // Refused: the caller may not read these, and the regions draw as
            // missing, which is what they are to this caller. Anything else is
            // a failure, not an answer, and fails the request, so the picker
            // says it could not load rather than calling the components missing.
            if (
              NextlyError.isForbidden(error) ||
              NextlyError.isNotFound(error)
            ) {
              return new Map<string, BlockDocument>();
            }
            throw error;
          }
        );
      });
      current = { ids: batch, read };
      gathering = current;
    }
    current.ids.push(...ids);
    return current.read;
  };
  // One answer per id across every drawing, kept as it is asked for, so a
  // component that many sets place (a shared logo) is read once, and two
  // drawings asking for it at the same moment share that read.
  const asked = new Map<string, Promise<BlockDocument | undefined>>();
  const readOnce = async (
    ids: readonly string[]
  ): Promise<Map<string, BlockDocument>> => {
    const fresh = [...new Set(ids.filter(id => !asked.has(id)))];
    if (fresh.length > 0) {
      const batch = gather(fresh);
      for (const id of fresh) {
        asked.set(
          id,
          batch.then(found => found.get(id))
        );
      }
    }
    const answers = await Promise.all(
      ids.map(async id => [id, await asked.get(id)] as const)
    );
    return new Map(
      answers.filter(
        (answer): answer is readonly [string, BlockDocument] =>
          answer[1] !== undefined
      )
    );
  };
  // Each drawing discovered under its own bound, as the renderer draws it.
  const found = await Promise.all(
    groups.map(regions =>
      definitionsFor(regionDocument(regions), readOnce, read.limits)
    )
  );
  return Object.fromEntries(found.flatMap(definitions => [...definitions]));
}

/** An optional text parameter, where an empty value is none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => (value === "" ? undefined : value));

/**
 * The query the choices route accepts: the selected Layout, the language
 * being edited, a title search, and whether every set's picture is asked
 * for. Every one is optional.
 */
const choicesQuery = z.object({
  [LAYOUT_CHOICES_SELECTED_PARAM]: z
    .string()
    .trim()
    .min(1)
    .max(LAYOUT_ID_MAX)
    .optional(),
  [LAYOUT_CHOICES_LOCALE_PARAM]: optionalText(LAYOUT_LOCALE_MAX),
  [LAYOUT_CHOICES_SEARCH_PARAM]: optionalText(LAYOUT_SEARCH_MAX),
  // "1" or nothing: the one value the admin sends, so a typo is refused
  // rather than read as "no pictures".
  [LAYOUT_CHOICES_PICTURES_PARAM]: z.literal("1").optional(),
  [LAYOUT_CHOICES_DRAFTS_PARAM]: z.literal("1").optional(),
});

/** What the request asks, as the route reads it. */
export interface LayoutChoicesQuery {
  readonly selected: string | null;
  readonly locale: string | undefined;
  readonly search: string | undefined;
  readonly pictures: boolean;
  readonly drafts: boolean;
}

/**
 * The request's query, parsed at the boundary. A value the route cannot take
 * is refused as a validation error naming the parameter, never echoing it.
 */
export function parseChoicesQuery(url: string | URL): LayoutChoicesQuery {
  const query = parseRouteQuery(
    url,
    [
      LAYOUT_CHOICES_SELECTED_PARAM,
      LAYOUT_CHOICES_LOCALE_PARAM,
      LAYOUT_CHOICES_SEARCH_PARAM,
      LAYOUT_CHOICES_PICTURES_PARAM,
      LAYOUT_CHOICES_DRAFTS_PARAM,
    ],
    choicesQuery,
    "header & footer choices route"
  );
  return {
    selected: query[LAYOUT_CHOICES_SELECTED_PARAM] ?? null,
    locale: query[LAYOUT_CHOICES_LOCALE_PARAM],
    search: query[LAYOUT_CHOICES_SEARCH_PARAM],
    pictures: query[LAYOUT_CHOICES_PICTURES_PARAM] === "1",
    drafts: query[LAYOUT_CHOICES_DRAFTS_PARAM] === "1",
  };
}

/** Where each of some Layouts stands with the fence, from one read of it. */
export function fenceStates(
  store: Pick<LayoutRemovalStore, "removalsOf">
): NonNullable<LayoutChoicesRequest["fence"]> {
  return {
    removalStates: async ids =>
      new Map(
        (await store.removalsOf(ids)).map(removal => [
          removal.layoutId,
          fencedStateOf(removal),
        ])
      ),
  };
}

/**
 * The route declaration: `read` on the Layouts collection, as resolved, with
 * component definitions read from the store the plugin was told about, under
 * the bounds the published renderer draws with.
 */
export function layoutChoicesRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  limits: () => DocumentLimits = () => DEFAULT_LIMITS
): {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: LAYOUT_CHOICES_ROUTE_PATH,
    // A COMPUTED permission, so a host that renamed the collection still has
    // a route its authors can call.
    requiredPermission: ({ collection }) => collection(LAYOUTS_SLUG, "read"),
    handler: async (req, ctx) => {
      const query = parseChoicesQuery(req.url);
      // The Direct API through the plugin SDK, resolved per request, as the
      // plugin's other paths resolve it.
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return Response.json(
        await readLayoutChoices(ctx, await getCachedNextly(), {
          ...query,
          fence: fenceStates(layoutRemovalStore(ctx.db, ctx.dialect)),
          starter: () => starterRecordStore(ctx.db, ctx.dialect).read(),
          store,
          // Asked per request, as the renderer asks, so both read one answer.
          limits: limits(),
        })
      );
    },
  };
}

/**
 * Which collections hold the plugin's pages, Layouts and templates, as this
 * site resolved them.
 */
export function readPageCollection(
  ctx: Pick<PluginRouteContext, "self">
): PageCollectionResponse {
  return {
    pagesCollection: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    layoutsCollection: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    templatesCollection: ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG,
  };
}

/**
 * The route declaration. Authenticated, with no permission of its own: the
 * answer is a slug every author's own forms already carry, and the picker
 * needs it before it knows whether to ask anything else.
 */
export function pageCollectionRoute(): {
  method: "GET";
  siteWide: false;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: PAGE_COLLECTION_ROUTE_PATH,
    siteWide: false, // Acts on no site content; signing in is enough.
    handler: (_req, ctx) =>
      Promise.resolve(Response.json(readPageCollection(ctx))),
  };
}
