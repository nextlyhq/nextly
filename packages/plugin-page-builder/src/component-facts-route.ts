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
import { isPlainRecord } from "@nextlyhq/blocks-engine";
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
  asTheCaller,
  componentReadPermission,
  type ComponentStore,
} from "./library-route";
import type { UsageCount } from "./usage-count";

/** What answering needs, injected so a test can supply each part. */
export interface ComponentFactsSources {
  /** The component's LIVE row, as the caller may read it, or null. */
  readonly readLive: (id: string) => Promise<unknown>;
  /** How many documents place the component. */
  readonly countPlacements: (id: string) => Promise<UsageCount>;
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
    return { live: { properties: [], slots: [] }, reach: null };
  }
  const count = await sources.countPlacements(id).then(
    found => found,
    () => null
  );
  return {
    live: liveIdsOf(row, sources.field),
    reach:
      count === null
        ? null
        : { count: count.documents, complete: count.complete },
  };
}

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
        ...(await asTheCaller(ctx)),
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
          field: args.store.field,
        })
      );
    },
  };
}
