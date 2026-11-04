/**
 * What the component editor needs to know about the component it edits that
 * the component's own document does not hold: the ids its LIVE definition
 * uses, and how many documents place it.
 *
 * ## Why the live ids
 *
 * A designer editing a draft can remove a field the published definition
 * still has. Placements keep values under that field's id until the
 * published definition drops it, so a field added to the draft must never be
 * minted under the same id. The draft in the editor has forgotten it; the
 * live row has not.
 *
 * ## Why the retired ids are derived as well as read
 *
 * A retirement is recorded after the publish that drops the field, and a
 * record that fails leaves the id in neither the definition nor the table.
 * This answer is what the editor mints against, so it is the place a lost
 * record must not reach: the ids are derived again from the component's
 * published history, and any the table lacks are recorded on the way
 * (`retired-history`).
 *
 * ## Why the count may be a floor
 *
 * It comes from the usage index, which may not yet cover every document, and
 * reads a capped number of rows. The answer says when it is a floor, and the
 * editor says "at least".
 *
 * ## NOT a security boundary
 *
 * The save judges every write on its own. The read of the row is made as the
 * caller, so it answers only what the caller may read anyway.
 *
 * @module component-facts-route
 */
import { isPlainRecord, type RetiredExposures } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import {
  COMPONENT_FACTS_ID_PARAM,
  COMPONENT_FACTS_ROUTE_PATH,
  COMPONENT_LIBRARY_LOCALE_PARAM,
  type ComponentFactsResponse,
} from "./library-contract";
import {
  componentReadPermission,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
import type { UsageCount } from "./usage-count";

/** What answering needs, injected so a test can supply each part. */
export interface ComponentFactsSources {
  /** The component's LIVE row, as the caller may read it, or null. */
  readonly readLive: (id: string) => Promise<unknown>;
  /** How many documents place the component. */
  readonly countPlacements: (id: string) => Promise<UsageCount>;
  /**
   * How many pages a change to it reaches, through components and Layouts
   * too. Optional, so a source with no Layouts or index to read answers
   * `null` rather than a number it did not count.
   */
  readonly countPages?: (id: string) => Promise<UsageCount>;
  /**
   * The ids the component has retired, or `null` where they are not recorded.
   * A failure here fails the answer: the editor then waits rather than minting
   * without them.
   */
  readonly readRetired: (id: string) => Promise<RetiredExposures | null>;
  /** The field of the row the definition lives in. */
  readonly field: string;
}

/**
 * The ids a stored definition holds, read defensively: a row written by hand
 * or by an older version may hold anything, and an id this cannot read is one
 * nobody can be holding values under either.
 */
export function liveIdsOf(
  row: unknown,
  field: string
): ComponentFactsResponse["live"] {
  const definition = isPlainRecord(row) ? row[field] : undefined;
  if (!isPlainRecord(definition)) return { properties: [], slots: [] };
  const exposed = Array.isArray(definition.exposed) ? definition.exposed : [];
  const properties = exposed
    .map(entry => (isPlainRecord(entry) ? entry.id : undefined))
    .filter((id): id is string => typeof id === "string");
  const slots = isPlainRecord(definition.slots)
    ? Object.keys(definition.slots)
    : [];
  return { properties, slots };
}

/**
 * Answer for one component.
 *
 * The caller's own read comes FIRST, and the count only for a component it
 * answered: the count reads the index as the system, so asking it of a
 * component the caller may not read would tell them how widely it is used.
 *
 * A count that fails leaves `reach` null rather than failing the answer: the
 * count is said to the author, while the live ids keep a draft from reusing an
 * id, which is the part that matters.
 */
export async function readComponentFacts(
  id: string,
  sources: ComponentFactsSources
): Promise<ComponentFactsResponse> {
  const row = await sources.readLive(id);
  if (row === null || row === undefined) {
    return { live: NONE, retired: NONE, reach: null, pages: null };
  }
  const retired = await sources.readRetired(id);
  const count = await sources.countPlacements(id).then(
    found => found,
    () => null
  );
  // Like the direct count, a page count that fails leaves its answer null
  // rather than failing the live ids beside it.
  const pages =
    sources.countPages === undefined
      ? null
      : await sources.countPages(id).then(
          found => found,
          () => null
        );
  return {
    live: liveIdsOf(row, sources.field),
    retired:
      retired === null
        ? null
        : { properties: [...retired.properties], slots: [...retired.slots] },
    reach:
      count === null
        ? null
        : { count: count.documents, complete: count.complete },
    pages:
      pages === null
        ? null
        : { count: pages.documents, complete: pages.complete },
  };
}

const NONE: ComponentFactsResponse["live"] = { properties: [], slots: [] };

/**
 * The query this route reads, parsed at the boundary: the component's id and,
 * optionally, the language its definition is read in. Bounded, so an outside
 * value reaches neither read unexamined.
 */
const FACTS_QUERY = z.object({
  [COMPONENT_FACTS_ID_PARAM]: z.string().trim().min(1).max(256),
  [COMPONENT_LIBRARY_LOCALE_PARAM]: z.string().trim().min(1).max(35).optional(),
});

/** The parsed query, or the validation error naming what is wrong. */
export function factsQuery(url: string): {
  readonly id: string;
  readonly locale: string | undefined;
} {
  const params = new URL(url).searchParams;
  // An absent or empty language is the app default, as everywhere in the admin.
  const locale = params.get(COMPONENT_LIBRARY_LOCALE_PARAM);
  const parsed = FACTS_QUERY.safeParse({
    [COMPONENT_FACTS_ID_PARAM]:
      params.get(COMPONENT_FACTS_ID_PARAM) ?? undefined,
    [COMPONENT_LIBRARY_LOCALE_PARAM]:
      locale === null || locale === "" ? undefined : locale,
  });
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join("."),
        code: "INVALID",
        message: "Name the component with ?id=, and a language with ?locale=.",
      })),
    });
  }
  return {
    id: parsed.data[COMPONENT_FACTS_ID_PARAM],
    locale: parsed.data[COMPONENT_LIBRARY_LOCALE_PARAM],
  };
}

/** What the component store's configuration says about its retirements. */
export interface ComponentStoreShape {
  /**
   * A localized store records no retirements, since publishing there is per
   * language.
   */
  readonly localized: boolean;
  /** Whether it has the Draft/Published lifecycle. */
  readonly lifecycle: boolean;
}

/**
 * The component store's shape, read from its own configuration as the
 * request's user. The service is named structurally, as the write hooks name
 * it, for the one method read.
 */
export async function componentStoreShape(
  collections: {
    getCollection(name: string, context: unknown): Promise<unknown>;
  },
  slug: string,
  user: unknown
): Promise<ComponentStoreShape> {
  const store = (await collections.getCollection(slug, {
    user: user ?? undefined,
  })) as { localized?: unknown; status?: unknown } | null;
  return {
    localized: store?.localized === true,
    lifecycle: store?.status === true,
  };
}

/**
 * The retired ids the editor is told: the table's, and those the component's
 * published history implies, which `reconcile` records where the table lacks
 * them. `null` for a localized store, which records none.
 */
export function reconciledRetired(args: {
  readonly shape: () => Promise<ComponentStoreShape>;
  readonly reconcile: (
    id: string,
    lifecycle: boolean
  ) => Promise<RetiredExposures>;
}): (id: string) => Promise<RetiredExposures | null> {
  return async id => {
    const shape = await args.shape();
    if (shape.localized) return null;
    return args.reconcile(id, shape.lifecycle);
  };
}

/** The live row, read as the caller; null when it is gone or not theirs. */
function liveRowReader(
  ctx: Pick<PluginRouteContext, "caller">,
  slug: string,
  locale: string | undefined
): (id: string) => Promise<unknown> {
  return async id => {
    try {
      return await requireNextly().findByID({
        collection: slug,
        id,
        ...(await readingAsUser(ctx)),
        // The language being edited: a localized definition can expose
        // different fields in each.
        ...(locale === undefined ? {} : { locale }),
        // Every lifecycle state, so a component never published answers too,
        // and NO draft overlay: the live row is the one placements resolve.
        status: "all",
      });
    } catch (error) {
      if (NextlyError.isNotFound(error) || NextlyError.isForbidden(error)) {
        return null;
      }
      throw error;
    }
  };
}

/**
 * The route declaration. Gated on reading the component store, the same
 * permission the component library asks.
 */
export function componentFactsRoute(args: {
  store: ComponentStore;
  countPlacements: (
    ctx: PluginRouteContext
  ) => (id: string) => Promise<UsageCount>;
  /** How many pages a change reaches, through components and Layouts too. */
  countPages?: (ctx: PluginRouteContext) => (id: string) => Promise<UsageCount>;
  readRetired: (
    ctx: PluginRouteContext
  ) => (id: string) => Promise<RetiredExposures | null>;
}): {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: COMPONENT_FACTS_ROUTE_PATH,
    requiredPermission: componentReadPermission(args.store),
    handler: async (req, ctx) => {
      const { id, locale } = factsQuery(req.url);
      const slug =
        args.store.collection ??
        ctx.self.collections[COMPONENTS_SLUG] ??
        COMPONENTS_SLUG;
      return Response.json(
        await readComponentFacts(id, {
          readLive: liveRowReader(ctx, slug, locale),
          countPlacements: args.countPlacements(ctx),
          ...(args.countPages === undefined
            ? {}
            : { countPages: args.countPages(ctx) }),
          readRetired: args.readRetired(ctx),
          field: args.store.field,
        })
      );
    },
  };
}
