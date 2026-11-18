/**
 * The read a header & footer set's area pickers make in the builder: every
 * PUBLISHED component an author may put in the set's header or footer, the
 * ones marked "Use as" for that area first, then "Other components", each
 * group by title, with the published definitions its picture is drawn from.
 *
 * Read as the caller, so the components collection's own read rules decide
 * which they see, bounded. Published only: a set naming a component no
 * visitor can see would draw nothing in that area. The component the set
 * holds now is answered for past the bound, with its definitions whether or
 * not the pictures are asked for, since the set's own canvas draws it.
 *
 * @module set-area-choices-route
 */
import {
  DEFAULT_LIMITS,
  regionDocument,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type {
  PluginRouteContext,
  PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUT_AREAS, type LayoutArea } from "./collections/areas";
import { COMPONENTS_SLUG } from "./collections/components";
import type { DefaultLayoutDirectApi } from "./default-layout/store";
import { entryOf } from "./entry-reads";
import { LAYOUT_ID_MAX, LAYOUT_LOCALE_MAX } from "./layout-choices-contract";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
import { publishedDefinitionsOf } from "./published-definitions";
import { parseRouteQuery } from "./route-query";
import {
  MAX_SET_AREA_CHOICES,
  SET_AREA_CHOICES_AREA_PARAM,
  SET_AREA_CHOICES_LOCALE_PARAM,
  SET_AREA_CHOICES_PICTURES_PARAM,
  SET_AREA_CHOICES_ROUTE_PATH,
  SET_AREA_CHOICES_SELECTED_PARAM,
  type SetAreaChoice,
  type SetAreaChoicesResponse,
} from "./set-area-choices-contract";

/** An optional text parameter, with an empty one read as absent. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => (value === "" ? undefined : value));
}

/** What the read takes; `area` is required, the rest optional. */
const SetAreaChoicesQuery = z.object({
  [SET_AREA_CHOICES_AREA_PARAM]: z.enum(LAYOUT_AREAS),
  [SET_AREA_CHOICES_LOCALE_PARAM]: optionalText(LAYOUT_LOCALE_MAX),
  [SET_AREA_CHOICES_SELECTED_PARAM]: optionalText(LAYOUT_ID_MAX),
  // "1" or nothing: the one value the admin sends.
  [SET_AREA_CHOICES_PICTURES_PARAM]: z.literal("1").optional(),
});

/** What the read reads with: the Direct API's `find`, as the caller. */
export type SetAreaChoicesDirectApi = Pick<DefaultLayoutDirectApi, "find">;

/** What the read is asked. */
export interface SetAreaChoicesRequest {
  readonly area: LayoutArea;
  readonly locale: string | undefined;
  /** The component the set's area holds now, by id, if any. */
  readonly selected: string | undefined;
  readonly pictures: boolean;
  readonly store: ComponentStore;
  readonly limits: DocumentLimits;
}

/** The components collection, as the site resolved it or the store names it. */
function componentsCollectionOf(
  ctx: Pick<PluginRouteContext, "self">,
  store: ComponentStore
): string {
  return (
    store.collection ?? ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG
  );
}

/** A published row as a choice, or nothing for a row without an id. */
function choiceOf(row: unknown, area: LayoutArea): SetAreaChoice | undefined {
  const entry = entryOf(row, "title");
  if (entry === undefined) return undefined;
  const marked = (row as { area?: unknown }).area === area;
  return { id: entry.id, title: entry.title, marked };
}

/**
 * The published components an author may put in `area`, as the caller reads
 * them, the marked ones first, with the definitions their pictures need.
 */
export async function readSetAreaChoices(
  ctx: Pick<PluginRouteContext, "caller" | "self">,
  nextly: SetAreaChoicesDirectApi,
  request: SetAreaChoicesRequest
): Promise<SetAreaChoicesResponse> {
  const collection = componentsCollectionOf(ctx, request.store);
  const asUser = await readingAsUser(ctx);
  // As the caller, in the language being edited, published only, by title:
  // names and the "Use as" mark alone. A picture's definitions are read
  // apart, so the documents themselves are not read here.
  const listing = {
    collection,
    ...asUser,
    ...(request.locale === undefined ? {} : { locale: request.locale }),
    status: "published" as const,
    sort: "title",
    depth: 0,
    select: { id: true, title: true, area: true },
  };
  const read = (filter: {
    where?: { id: { equals: string } };
    limit: number;
  }) => nextly.find({ ...listing, ...filter });
  const found = await read({ limit: MAX_SET_AREA_CHOICES });
  const listed = found.items
    .map(row => choiceOf(row, request.area))
    .filter((item): item is SetAreaChoice => item !== undefined);
  // The one the set holds now, answered for past the bound.
  const { selected } = request;
  const missing =
    selected === undefined || listed.some(item => item.id === selected)
      ? []
      : (await read({ where: { id: { equals: selected } }, limit: 1 })).items
          .map(row => choiceOf(row, request.area))
          .filter((item): item is SetAreaChoice => item !== undefined);
  const all = [...listed, ...missing];
  const items = [
    ...all.filter(item => item.marked),
    ...all.filter(item => !item.marked),
  ];
  const drawn = request.pictures
    ? items
    : items.filter(item => item.id === selected);
  const definitions = await publishedDefinitionsOf(
    nextly,
    { collection, field: request.store.field, locale: request.locale },
    // Each drawn as the canvas draws the area: one instance.
    drawn.map(item =>
      regionDocument([{ area: request.area, componentId: item.id }])
    ),
    { reading: asUser, limits: request.limits }
  );
  return {
    items,
    meta: {
      area: request.area,
      more: found.meta.hasNext === true,
      definitions,
    },
  };
}

/** The read, as the plugin declares it. */
interface SetAreaChoicesRoute {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/** The route declaration: `read` on components, as resolved. */
export function setAreaChoicesRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  limits: () => DocumentLimits = () => DEFAULT_LIMITS
): SetAreaChoicesRoute {
  return {
    method: "GET",
    path: SET_AREA_CHOICES_ROUTE_PATH,
    requiredPermission: ({ collection }) => collection(COMPONENTS_SLUG, "read"),
    handler: async (req, ctx) => {
      const query = parseRouteQuery(
        req.url,
        [
          SET_AREA_CHOICES_AREA_PARAM,
          SET_AREA_CHOICES_LOCALE_PARAM,
          SET_AREA_CHOICES_SELECTED_PARAM,
          SET_AREA_CHOICES_PICTURES_PARAM,
        ],
        SetAreaChoicesQuery,
        "set area choices route"
      );
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return Response.json(
        await readSetAreaChoices(ctx, await getCachedNextly(), {
          area: query[SET_AREA_CHOICES_AREA_PARAM],
          locale: query[SET_AREA_CHOICES_LOCALE_PARAM],
          selected: query[SET_AREA_CHOICES_SELECTED_PARAM],
          pictures: query[SET_AREA_CHOICES_PICTURES_PARAM] === "1",
          store,
          limits: limits(),
        })
      );
    },
  };
}
