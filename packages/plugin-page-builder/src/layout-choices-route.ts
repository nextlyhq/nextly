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
  DEFAULT_LIMITS,
  regionDocument,
  regionsOf,
  type BlockDocument,
  type LayoutRegion,
} from "@nextlyhq/blocks-engine";
import { definitionsFor } from "@nextlyhq/blocks-react";
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGES_SLUG } from "./collections/pages";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { chunked, ID_BATCH_SIZE } from "./id-batches";
import {
  LAYOUT_CHOICES_ROUTE_PATH,
  LAYOUT_CHOICES_SELECTED_PARAM,
  LAYOUT_ID_MAX,
  PAGE_COLLECTION_ROUTE_PATH,
  type LayoutChoice,
  type LayoutChoicesResponse,
  type PageCollectionResponse,
  type RegionComponentFacts,
} from "./layout-choices-contract";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "./library-route";

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

/** What the editor asked about, and where component definitions live. */
export interface LayoutChoicesRequest {
  /** The Layout the page has selected, by id, or null for none. */
  readonly selected: string | null;
  /** Where component definitions are stored, as the plugin was told. */
  readonly store: ComponentStore;
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
 * inside, and only for an author who may update what is asked about: the
 * service shows a working draft to no one else, so the read would tell anyone
 * else nothing.
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

  const listed = rowsOf(
    await nextly.find({
      collection: layouts,
      ...asUser,
      // Every lifecycle state the caller may read: an unpublished Layout is a
      // choice the picker offers, marked as such.
      status: "all",
      sort: "title",
      limit: MAX_LAYOUT_CHOICES,
      depth: 0,
    })
  );
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
    ...(await rowsPastTheBound(nextly, layouts, focus, listed, asUser)),
  ];
  const items = rows
    .map(choiceOf)
    .filter((item): item is LayoutChoice => item !== null);

  const canUpdateLayouts = (await ctx.caller?.can("update", layouts)) === true;
  const focused = items.filter(item => focus.includes(item.id));
  const drafts = canUpdateLayouts
    ? await pendingDrafts(
        nextly,
        layouts,
        focused.filter(item => item.published).map(item => item.id),
        asUser
      )
    : new Set<string>();
  const focusedComponents = [
    ...new Set(focused.flatMap(item => item.regions.map(r => r.componentId))),
  ];
  const componentDrafts =
    (await ctx.caller?.can("update", components)) === true
      ? await pendingDrafts(nextly, components, focusedComponents, asUser)
      : new Set<string>();

  return {
    items: items.map(item => ({
      ...item,
      draftChangesNotLive: drafts.has(item.id),
    })),
    meta: {
      defaultLayout,
      layoutsCollection: layouts,
      canUpdateLayouts,
      regionComponents: Object.fromEntries(
        focusedComponents.map((id): [string, RegionComponentFacts] => [
          id,
          { draftChangesNotLive: componentDrafts.has(id) },
        ])
      ),
      regionDefinitions: await publishedDefinitions(
        nextly,
        { collection: components, field: request.store.field },
        items.flatMap(item => item.regions),
        asUser
      ),
    },
  };
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
  asUser: AsUser
): Promise<Row[]> {
  const have = new Set(listed.map(rowId));
  const missing = focus.filter(id => !have.has(id));
  if (missing.length === 0) return [];
  return rowsOf(
    await nextly.find({
      collection: layouts,
      where: { id: { in: missing } },
      ...asUser,
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
  return {
    id,
    title:
      typeof row.title === "string" && row.title.trim() !== "" ? row.title : id,
    published,
    draftChangesNotLive: false,
    // The main row of a published Layout IS its published version; a pending
    // edit lives in the working draft, which this read did not ask for.
    regions: published ? regionsOf(row) : [],
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
  asUser: AsUser
): Promise<Set<string>> {
  const found = await Promise.all(
    ids.map(async id => {
      try {
        const row = await nextly.findByID({
          collection,
          id,
          ...asUser,
          status: "all",
          draft: true,
          depth: 0,
        });
        return hasPendingDraft(row) ? id : null;
      } catch {
        // A row the caller cannot read by id says nothing about a draft.
        return null;
      }
    })
  );
  return new Set(found.filter((id): id is string => id !== null));
}

/**
 * The PUBLISHED definitions the regions reach, nested ones included.
 *
 * Discovered by the render's own discovery (`definitionsFor`), so a nested
 * component the canvas will draw is one this read fetched, from the store the
 * plugin was told about. Read in batches under the collection's row clamp, so
 * every requested id is answered rather than the first page of them. Read as
 * the caller at the published posture: the canvas shows what a visitor gets.
 * A caller who may not read components gets none, and each region then draws
 * the marker a missing component draws.
 */
async function publishedDefinitions(
  nextly: LayoutChoicesDirectApi,
  store: { collection: string; field: string },
  regions: readonly LayoutRegion[],
  asUser: AsUser
): Promise<Record<string, BlockDocument>> {
  if (regions.length === 0) return {};
  const found = await definitionsFor(
    regionDocument(regions),
    async ids => {
      const read = new Map<string, BlockDocument>();
      try {
        for (const batch of chunked([...ids], ID_BATCH_SIZE)) {
          const rows = rowsOf(
            await nextly.find({
              collection: store.collection,
              where: { id: { in: batch } },
              ...asUser,
              status: "published",
              limit: batch.length,
              depth: 0,
            })
          );
          for (const row of rows) {
            const id = rowId(row);
            if (id !== null) read.set(id, row[store.field] as BlockDocument);
          }
        }
      } catch {
        // Refused or failed: the regions draw as missing rather than failing
        // the whole answer, which the picker needs either way.
      }
      return read;
    },
    DEFAULT_LIMITS
  );
  return Object.fromEntries(found);
}

/** The query the choices route accepts: an optional selected Layout id. */
const selectedQuery = z.object({
  [LAYOUT_CHOICES_SELECTED_PARAM]: z
    .string()
    .trim()
    .min(1)
    .max(LAYOUT_ID_MAX)
    .optional(),
});

/**
 * The selected Layout the request names, or null, parsed at the boundary.
 * A value that is not an id is refused as a validation error naming the
 * parameter, never echoing it.
 */
export function parseSelectedLayout(url: string | URL): string | null {
  const value = new URL(url).searchParams.get(LAYOUT_CHOICES_SELECTED_PARAM);
  const parsed = selectedQuery.safeParse(
    value === null ? {} : { [LAYOUT_CHOICES_SELECTED_PARAM]: value }
  );
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: LAYOUT_CHOICES_SELECTED_PARAM,
          code: "INVALID_QUERY",
          message: "This parameter is not a Layout id.",
        },
      ],
    });
  }
  return parsed.data[LAYOUT_CHOICES_SELECTED_PARAM] ?? null;
}

/**
 * The route declaration: `read` on the Layouts collection, as resolved, with
 * component definitions read from the store the plugin was told about.
 */
export function layoutChoicesRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
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
      const selected = parseSelectedLayout(req.url);
      // The Direct API through the plugin SDK, resolved per request, as the
      // plugin's other paths resolve it.
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return Response.json(
        await readLayoutChoices(ctx, await getCachedNextly(), {
          selected,
          store,
        })
      );
    },
  };
}

/** Which collection holds the plugin's pages, as this site resolved it. */
export function readPageCollection(
  ctx: Pick<PluginRouteContext, "self">
): PageCollectionResponse {
  return { pagesCollection: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG };
}

/**
 * The route declaration. Authenticated, with no permission of its own: the
 * answer is a slug every author's own forms already carry, and the picker
 * needs it before it knows whether to ask anything else.
 */
export function pageCollectionRoute(): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: PAGE_COLLECTION_ROUTE_PATH,
    handler: (_req, ctx) =>
      Promise.resolve(Response.json(readPageCollection(ctx))),
  };
}
