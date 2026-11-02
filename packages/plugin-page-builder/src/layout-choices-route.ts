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
import {
  COMPONENT_DOCUMENT_FIELD,
  definitionsFor,
} from "@nextlyhq/blocks-react";
import type {
  PluginRouteContext,
  PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import {
  LAYOUT_CHOICES_ROUTE_PATH,
  type LayoutChoice,
  type LayoutChoicesResponse,
  type RegionComponentFacts,
} from "./layout-choices-contract";
import { readingAsUser } from "./library-route";

/**
 * How many Layouts one answer lists. A site has a handful; the bound is there
 * so a store that grew without one cannot hold the editor's first paint, and
 * the answer says when it was reached.
 */
const MAX_LAYOUT_CHOICES = 200;

/** The Direct API surface the read uses, picked from the real type. */
export type LayoutChoicesDirectApi = Pick<
  DefaultLayoutDirectApi,
  "find" | "findByID" | "findSingle"
>;

/** The route context the read uses. */
export type LayoutChoicesContext = Pick<PluginRouteContext, "caller" | "self">;

type Row = Record<string, unknown>;

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

/** Read the Layout choices for the caller. */
export async function readLayoutChoices(
  ctx: LayoutChoicesContext,
  nextly: LayoutChoicesDirectApi
): Promise<LayoutChoicesResponse> {
  const layouts = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const components = ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG;
  const settings =
    ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ?? PAGE_BUILDER_SETTINGS_SLUG;
  // AS THE CALLER, every read below: a route reading as the instance would
  // answer every author with every Layout, whatever their rights say.
  const asUser = await readingAsUser(ctx);

  const listed = await nextly.find({
    collection: layouts,
    ...asUser,
    // Every lifecycle state the caller may read: an unpublished Layout is a
    // choice the picker offers, marked as such.
    status: "all",
    sort: "title",
    limit: MAX_LAYOUT_CHOICES,
    depth: 0,
  });
  const rows = rowsOf(listed);

  const items: LayoutChoice[] = [];
  for (const row of rows) {
    const item = await choiceOf(row, nextly, layouts, asUser);
    if (item !== null) items.push(item);
  }

  const regionIds = [
    ...new Set(items.flatMap(item => item.regions.map(r => r.componentId))),
  ];
  return {
    items,
    meta: {
      defaultLayout: (await readLayoutSettings(nextly, { layouts, settings }))
        .defaultLayout,
      layoutsCollection: layouts,
      canUpdateLayouts: (await ctx.caller?.can("update", layouts)) === true,
      truncated:
        (listed as { meta?: { hasNext?: unknown } }).meta?.hasNext === true,
      regionComponents: await componentFacts(
        nextly,
        components,
        regionIds,
        asUser
      ),
      regionDefinitions: await publishedDefinitions(
        nextly,
        components,
        items.flatMap(item => item.regions),
        asUser
      ),
    },
  };
}

/** A row id is a string or a number, by dialect; anything else is no row. */
function rowId(row: Row): string | null {
  if (typeof row.id === "string" && row.id !== "") return row.id;
  if (typeof row.id === "number") return String(row.id);
  return null;
}

/** One listed Layout as a choice, or null for a row with no id. */
async function choiceOf(
  row: Row,
  nextly: LayoutChoicesDirectApi,
  layouts: string,
  asUser: Awaited<ReturnType<typeof readingAsUser>>
): Promise<LayoutChoice | null> {
  const id = rowId(row);
  if (id === null) return null;
  const published = row.status === "published";
  return {
    id,
    title:
      typeof row.title === "string" && row.title.trim() !== "" ? row.title : id,
    published,
    // Asked only of a published Layout: one never published has nothing live
    // for its draft to differ from. The service shows a working draft only to
    // a caller who may update the Layout, so an author who may not is told
    // nothing about edits they could not see.
    draftChangesNotLive:
      published && hasPendingDraft(await draftOf(nextly, layouts, id, asUser)),
    // The main row of a published Layout IS its published version; a pending
    // edit lives in the working draft, which this read did not ask for.
    regions: published ? regionsOf(row) : [],
  };
}

/** One row by id with its pending working draft overlaid, or null. */
async function draftOf(
  nextly: LayoutChoicesDirectApi,
  collection: string,
  id: string,
  asUser: Awaited<ReturnType<typeof readingAsUser>>
): Promise<unknown> {
  try {
    return await nextly.findByID({
      collection,
      id,
      ...asUser,
      status: "all",
      draft: true,
      depth: 0,
    });
  } catch {
    // A row the caller cannot read by id says nothing about a draft.
    return null;
  }
}

/** Whether each region component holds edits a visitor does not see yet. */
async function componentFacts(
  nextly: LayoutChoicesDirectApi,
  components: string,
  ids: readonly string[],
  asUser: Awaited<ReturnType<typeof readingAsUser>>
): Promise<Record<string, RegionComponentFacts>> {
  const facts: Record<string, RegionComponentFacts> = {};
  for (const id of ids) {
    facts[id] = {
      draftChangesNotLive: hasPendingDraft(
        await draftOf(nextly, components, id, asUser)
      ),
    };
  }
  return facts;
}

/**
 * The PUBLISHED definitions the regions reach, nested ones included.
 *
 * Discovered by the render's own discovery (`definitionsFor`), so a nested
 * component the canvas will draw is one this read fetched. Read as the caller
 * at the published posture: the canvas shows what a visitor gets. A caller who
 * may not read components gets none, and each region then draws the marker a
 * missing component draws.
 */
async function publishedDefinitions(
  nextly: LayoutChoicesDirectApi,
  components: string,
  regions: readonly LayoutRegion[],
  asUser: Awaited<ReturnType<typeof readingAsUser>>
): Promise<Record<string, BlockDocument>> {
  if (regions.length === 0) return {};
  const found = await definitionsFor(
    regionDocument(regions),
    async ids => {
      const read = new Map<string, BlockDocument>();
      try {
        const rows = rowsOf(
          await nextly.find({
            collection: components,
            where: { id: { in: [...ids] } },
            ...asUser,
            status: "published",
            limit: ids.length,
            depth: 0,
          })
        );
        for (const row of rows) {
          if (typeof row.id !== "string") continue;
          read.set(row.id, row[COMPONENT_DOCUMENT_FIELD] as BlockDocument);
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

/** The route declaration: `read` on the Layouts collection, as resolved. */
export function layoutChoicesRoute(): {
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
    handler: async (_req, ctx) => {
      // The Direct API through the plugin SDK, resolved per request, as the
      // plugin's other paths resolve it.
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return Response.json(
        await readLayoutChoices(ctx, await getCachedNextly())
      );
    },
  };
}
