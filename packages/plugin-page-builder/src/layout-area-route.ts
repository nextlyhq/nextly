/**
 * The header & footer area routes the builder's "Use a component ▾" menu
 * makes: the PUBLISHED components marked "Use as" for an area, and the write
 * that puts one of them in a set's area.
 *
 * ## The list
 *
 * Read as the caller, so the components collection's own read rules decide
 * which they see, bounded and sorted by title. It also says whether the caller
 * may choose (update AND publish sets), so the menu is offered only to
 * someone whose choice can be written. Each component's picture is drawn from
 * the published definitions it reaches, sent only when the menu asks for its
 * pictures, under the renderer's own bounds.
 *
 * ## The write
 *
 * A set's areas are what every page using it shows, so changing one is a
 * site-wide publish: the caller must be allowed to update AND publish sets,
 * checked before anything is read, as choosing the site default is. Then the
 * write itself runs through the Direct API AS THE CALLER, so the sets
 * collection's own rules, row filters and field rules judge it, and every
 * check a set write meets (the removal fence, the component guards, the
 * composition judge) and the cache refresh after it apply.
 *
 * The component must be published and readable by the caller: a set naming
 * anything else would draw nothing in that area. The set is read as it is
 * SAVED and the write carries that read's version; a save made in between is
 * read again and only this area is changed on it. A set holding changes not
 * published yet is refused: publishing the area would ship them too, and
 * those are the author's own choice in progress.
 *
 * @module layout-area-route
 */
import {
  DEFAULT_LIMITS,
  regionDocument,
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

import { LAYOUT_AREAS, type LayoutArea } from "./collections/areas";
import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { readBodyWith } from "./composition-route-kit";
import type { DefaultLayoutDirectApi } from "./default-layout/store";
import { documentVersionOf, withVersionFrom } from "./document-version";
import { entryOf, readSavedAsCaller } from "./entry-reads";
import {
  AREA_COMPONENTS_AREA_PARAM,
  AREA_COMPONENTS_LOCALE_PARAM,
  AREA_COMPONENTS_PICTURES_PARAM,
  AREA_COMPONENTS_ROUTE_PATH,
  LAYOUT_AREA_ROUTE_PATH,
  MAX_AREA_COMPONENTS,
  type AreaComponent,
  type AreaComponentsResponse,
  type WrittenArea,
} from "./layout-area-contract";
import { areaRowsOf, withArea } from "./layout-area-rows";
import { LAYOUT_ID_MAX, LAYOUT_LOCALE_MAX } from "./layout-choices-contract";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
import { publishedDefinitionsOf } from "./published-definitions";
import { parseRouteParams, parseRouteQuery } from "./route-query";
import { retryOnStale } from "./stale-retry";

/** An area, as the routes accept it. */
const Area = z.enum(LAYOUT_AREAS);

/** What the read takes; `area` is required, the rest optional. */
const AreaComponentsQuery = z.object({
  [AREA_COMPONENTS_AREA_PARAM]: Area,
  [AREA_COMPONENTS_LOCALE_PARAM]: z
    .string()
    .trim()
    .max(LAYOUT_LOCALE_MAX)
    .optional()
    .transform(value => (value === "" ? undefined : value)),
  // "1" or nothing: the one value the admin sends.
  [AREA_COMPONENTS_PICTURES_PARAM]: z.literal("1").optional(),
});

const AreaParams = z.object({
  id: z.string().trim().min(1).max(LAYOUT_ID_MAX),
  area: Area,
});

const AreaBody = z.strictObject({
  component: z.string().trim().min(1).max(LAYOUT_ID_MAX),
});

/** The words for an area inside a sentence. */
const AREA_WORDS: Readonly<Record<LayoutArea, string>> = {
  header: "header",
  footer: "footer",
};

/** Whether the caller may update AND publish sets: the right to choose. */
async function mayChangeSets(
  ctx: Pick<PluginRouteContext, "caller" | "self">
): Promise<boolean> {
  const sets = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const caller = ctx.caller;
  return (
    caller !== null &&
    (await caller.can("update", sets)) &&
    (await caller.can("publish", sets))
  );
}

/** What the list reads with: the Direct API's `find`, as the caller. */
export type AreaComponentsDirectApi = Pick<DefaultLayoutDirectApi, "find">;

/** What the list is asked. */
export interface AreaComponentsRequest {
  readonly area: LayoutArea;
  readonly locale: string | undefined;
  readonly pictures: boolean;
  readonly store: ComponentStore;
  readonly limits: DocumentLimits;
}

/**
 * The published components marked for `area`, as the caller reads them,
 * with whether they may choose one and, when asked, each one's picture.
 */
export async function readAreaComponents(
  ctx: Pick<PluginRouteContext, "caller" | "self">,
  nextly: AreaComponentsDirectApi,
  request: AreaComponentsRequest
): Promise<AreaComponentsResponse> {
  const collection =
    request.store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  const asUser = await readingAsUser(ctx);
  const inLocale =
    request.locale === undefined ? {} : { locale: request.locale };
  const found = await nextly.find({
    collection,
    ...asUser,
    ...inLocale,
    where: { area: { equals: request.area } },
    // Published only: a set naming a component no visitor can see would draw
    // nothing in that area.
    status: "published",
    sort: "title",
    limit: MAX_AREA_COMPONENTS,
    depth: 0,
  });
  const items = found.items
    .map(row => entryOf(row, "title"))
    .filter((item): item is AreaComponent => item !== undefined);
  const definitions = request.pictures
    ? await publishedDefinitionsOf(
        nextly,
        { collection, field: request.store.field, locale: request.locale },
        // Each picture drawn as the canvas draws the area: one instance.
        items.map(item =>
          regionDocument([{ area: request.area, componentId: item.id }])
        ),
        { reading: asUser, limits: request.limits }
      )
    : {};
  return {
    items,
    meta: {
      area: request.area,
      more: found.meta.hasNext === true,
      mayChoose: await mayChangeSets(ctx),
      definitions,
    },
  };
}

/**
 * What the write reads and writes with, injected so its decisions can be
 * tested without a server. Every call runs AS THE CALLER.
 */
export interface LayoutAreaWrites {
  /** Whether the caller may update AND publish sets. */
  mayChange(): Promise<boolean>;
  /** The component as published, or null when it is not or is not theirs. */
  publishedComponent(
    id: string
  ): Promise<{ readonly id: string; readonly title: string } | null>;
  /** The set as it is saved, or null where the caller may not read it. */
  readSaved(id: string): Promise<Record<string, unknown> | null>;
  /** Answers the row core wrote, as core returns it to this caller. */
  update(id: string, data: Record<string, unknown>): Promise<unknown>;
}

/** Refuse a set this write would publish more than the area of. */
function refuseUnlessPublishedAsSaved(
  saved: Record<string, unknown>,
  area: LayoutArea
): void {
  const title = entryOf(saved, "title")?.title ?? "";
  const word = AREA_WORDS[area];
  if (saved._isWorkingDraft === true) {
    throw NextlyError.conflict({
      reason: "state",
      message: `The ${title} header & footer has changes that aren't published yet. Publish or discard them first, then choose its ${word}.`,
      logContext: { reason: "layout-area-pending-changes" },
    });
  }
  if (saved.status !== "published") {
    throw NextlyError.conflict({
      reason: "state",
      message: `The ${title} header & footer isn't published. Publish it first, then choose its ${word}.`,
      logContext: { reason: "layout-area-unpublished-set" },
    });
  }
}

/**
 * Put `componentId` in `area` of set `setId`, published, as the module
 * docblock describes.
 */
export async function putInArea(
  setId: string,
  area: LayoutArea,
  componentId: string,
  writes: LayoutAreaWrites
): Promise<WrittenArea> {
  if (!(await writes.mayChange())) {
    throw NextlyError.forbidden({
      logContext: { reason: "layout-area-needs-set-publish" },
    });
  }
  const component = await writes.publishedComponent(componentId);
  if (component === null) {
    throw NextlyError.notFound({
      message: "That component isn't published, or isn't there any more.",
      logContext: { route: LAYOUT_AREA_ROUTE_PATH },
    });
  }
  const row = await retryOnStale(
    () => writes.readSaved(setId),
    async saved => {
      if (saved === null) {
        throw NextlyError.notFound({
          logContext: { route: LAYOUT_AREA_ROUTE_PATH },
        });
      }
      refuseUnlessPublishedAsSaved(saved, area);
      return writes.update(
        setId,
        withVersionFrom(
          {
            areas: withArea(areaRowsOf(saved.areas), area, component.id),
            status: "published",
          },
          documentVersionOf(saved)
        )
      );
    }
  );
  const set = entryOf(row, "title");
  if (set === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "layout-area-write-without-id" },
    });
  }
  return { set, area, component };
}

/** The Direct API, as the caller, for the write. */
function directLayoutAreaWrites(
  ctx: PluginRouteContext,
  store: ComponentStore
): LayoutAreaWrites {
  const sets = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const components =
    store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  return {
    mayChange: () => mayChangeSets(ctx),
    publishedComponent: async id => {
      const found = await requireNextly().find({
        collection: components,
        ...(await readingAsUser(ctx)),
        where: { id: { equals: id } },
        status: "published",
        limit: 1,
        depth: 0,
      });
      return entryOf(found.items[0], "title") ?? null;
    },
    readSaved: id =>
      readSavedAsCaller(ctx, {
        collection: sets,
        id,
        select: { id: true, title: true, status: true, areas: true },
      }),
    update: async (id, data) =>
      (
        await requireNextly().update({
          collection: sets,
          id,
          data,
          ...(await readingAsUser(ctx)),
        })
      ).item,
  };
}

/** The read, as the plugin declares it. */
interface AreaComponentsRoute {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/** The write, as the plugin declares it. */
interface LayoutAreaRoute {
  method: "PATCH";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The two route declarations. The read needs `read` on components, as
 * resolved. The write has no `requiredPermission`: its own check above and
 * core's judgement of the set write decide, as for the other set writes.
 */
export function layoutAreaRoutes(
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  limits: () => DocumentLimits = () => DEFAULT_LIMITS
): [AreaComponentsRoute, LayoutAreaRoute] {
  return [
    {
      method: "GET",
      path: AREA_COMPONENTS_ROUTE_PATH,
      requiredPermission: ({ collection }) =>
        collection(COMPONENTS_SLUG, "read"),
      handler: async (req, ctx) => {
        const query = parseRouteQuery(
          req.url,
          [
            AREA_COMPONENTS_AREA_PARAM,
            AREA_COMPONENTS_LOCALE_PARAM,
            AREA_COMPONENTS_PICTURES_PARAM,
          ],
          AreaComponentsQuery,
          "area components route"
        );
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        return Response.json(
          await readAreaComponents(ctx, await getCachedNextly(), {
            area: query[AREA_COMPONENTS_AREA_PARAM],
            locale: query[AREA_COMPONENTS_LOCALE_PARAM],
            pictures: query[AREA_COMPONENTS_PICTURES_PARAM] === "1",
            store,
            limits: limits(),
          })
        );
      },
    },
    {
      method: "PATCH",
      path: LAYOUT_AREA_ROUTE_PATH,
      checksAccess: true, // Checked above, then core judges the write.
      handler: async (req, ctx) => {
        // The path first, then the body, so a bad address is refused before
        // anything else is read.
        const { id, area } = parseRouteParams(
          ctx.params,
          AreaParams,
          "set area route"
        );
        const { component } = await readBodyWith(
          req,
          AreaBody,
          "choose a component"
        );
        const written = await putInArea(
          id,
          area,
          component,
          directLayoutAreaWrites(ctx, store)
        );
        return respondMutation<WrittenArea>(
          `${written.component.title} is now the ${AREA_WORDS[area]} of every page that uses the ${written.set.title} header & footer.`,
          written
        );
      },
    },
  ];
}
