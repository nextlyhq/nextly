/**
 * `POST /default-layout/areas/:area`: "Create a header" (or footer) on the
 * band the builder's canvas draws where the site's default header & footer
 * set has nothing in that area.
 *
 * ## What it does, in order
 *
 * 1. Refuses a caller who may not update AND publish sets, before anything is
 *    read: the default's areas are what every page following it shows, so
 *    filling one is a site-wide publish (`putInArea`'s own first check).
 * 2. Finds the default set on the server, never from the request, and reads
 *    it as it is saved, AS THE CALLER. A set holding unpublished changes, or
 *    not published, is refused as `putInArea` refuses it, and so is an area
 *    that already holds a component: the band the author saw is out of date,
 *    and creating would replace what is there.
 * 3. Only then creates the component AS THE CALLER: the starter's design for
 *    that area, marked "Use as" for it, published, under the first title and
 *    slug no component holds. The components collection's own create and
 *    publish rules judge it.
 * 4. Puts it in the default's area through `putInArea`, the one write that
 *    changes a set's area, which refuses again, in every attempt, an area
 *    someone filled while the header was created. Should that refuse, the
 *    component just created is deleted again, best effort, so a refused fill
 *    leaves nothing behind.
 *
 * Publishing a header the first time can fill the seeded default by itself
 * (`first-fill-hook`); that names this same component in this same area, so
 * the write in step 4 finds it there and changes nothing else.
 *
 * @module default-layout/create-in-area-route
 */
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { LAYOUT_AREAS, type LayoutArea } from "../collections/areas";
import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { deleteUnplacedComponent } from "../component-delete/system-delete";
import { fenceStore } from "../host-rewrite/fence";
import {
  DEFAULT_AREA_ROUTE_PATH,
  type WrittenArea,
} from "../layout-area-contract";
import {
  directLayoutAreaWrites,
  putInArea,
  refuseFilledArea,
  refuseUnlessPublishedAsSaved,
  type LayoutAreaWrites,
} from "../layout-area-route";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "../library-route";
import { parseRouteParams } from "../route-query";

import { createdSlug, createdTitle } from "./seed-names";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./settings-single";
import { starterDocument } from "./starter-documents";
import { readLayoutSettings, relationId } from "./store";
import { takenNames } from "./taken-names";

const AreaParams = z.object({ area: z.enum(LAYOUT_AREAS) });

/**
 * How many slugs a create tries when the database refuses one the scan saw as
 * free (MySQL compares slugs without case or accents), as the seed does.
 */
const SLUG_ATTEMPTS = 5;

/**
 * What the create reads and writes with, injected so its order can be tested
 * without a server. Every call but `removeCreated` runs AS THE CALLER.
 */
export interface CreateInAreaWrites extends LayoutAreaWrites {
  /** The site's default set, read on the server; null when there is none. */
  defaultSet(): Promise<string | null>;
  /** Create the starter's design for `area` as a published component. */
  createStarter(area: LayoutArea): Promise<{ id: string; title: string }>;
  /** Delete a component this request created and nothing places. */
  removeCreated(id: string): Promise<void>;
  warn(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Create a header (or footer) and put it in the default's empty `area`, as
 * the module docblock describes.
 */
export async function createInDefaultArea(
  area: LayoutArea,
  writes: CreateInAreaWrites
): Promise<WrittenArea> {
  // Preconditions first, whatever they cost: nothing below is read or
  // created for a caller who may not change sets.
  if (!(await writes.mayChange())) {
    throw NextlyError.forbidden({
      logContext: { reason: "default-area-needs-set-publish" },
    });
  }
  const setId = await writes.defaultSet();
  if (setId === null) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "This site has no default header & footer set. Choose one in Header & footer first.",
      logContext: { reason: "default-area-no-default" },
    });
  }
  const saved = await writes.readSaved(setId);
  if (saved === null) {
    throw NextlyError.notFound({
      logContext: { route: DEFAULT_AREA_ROUTE_PATH },
    });
  }
  refuseUnlessPublishedAsSaved(saved, area);
  // Asked before anything is created, and again in every attempt of the
  // write: someone may fill the area while the header is being created.
  refuseFilledArea(saved, area);

  const created = await writes.createStarter(area);
  try {
    return await putInArea(setId, area, created.id, writes, {
      onlyIntoEmpty: true,
    });
  } catch (error) {
    await writes.removeCreated(created.id).catch((removal: unknown) => {
      writes.warn(
        "[page-builder] a header or footer created for the default could not be removed after the default refused it; delete it by hand",
        {
          component: created.id,
          error: removal instanceof Error ? removal.message : String(removal),
        }
      );
    });
    throw error;
  }
}

/**
 * The row a created header (or footer) is stored as: its names, marked for
 * its area, published, with the starter's design under the component store's
 * own document field, which a host may name otherwise.
 */
export function starterComponentData(
  area: LayoutArea,
  names: {
    readonly title: string;
    readonly slug: string;
    readonly field: string;
    readonly pagesSlug: string;
  }
): Record<string, unknown> {
  return {
    title: names.title,
    slug: names.slug,
    area,
    [names.field]: starterDocument(area, names.pagesSlug),
    status: "published",
  };
}

/** The Direct API for the create, as the caller except for the cleanup. */
function directCreateInAreaWrites(
  ctx: PluginRouteContext,
  store: ComponentStore
): CreateInAreaWrites {
  const components =
    store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  const pages = ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG;
  return {
    ...directLayoutAreaWrites(ctx, store),
    defaultSet: async () =>
      (
        await readLayoutSettings(requireNextly(), {
          layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
          settings:
            ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
            PAGE_BUILDER_SETTINGS_SLUG,
        })
      ).defaultLayout,
    createStarter: async area => {
      const nextly = requireNextly();
      // Every title and slug a component holds, read as the system: a name
      // the caller cannot see still holds its unique slug.
      const taken = await takenNames(nextly, components);
      const title = createdTitle(area, taken.titles);
      for (let attempt = 1; ; attempt += 1) {
        const slug = createdSlug(area, taken.slugs);
        try {
          const created = await nextly.create({
            collection: components,
            data: starterComponentData(area, {
              title,
              slug,
              field: store.field,
              pagesSlug: pages,
            }),
            ...(await readingAsUser(ctx)),
          });
          const id = relationId(created.item);
          if (id === null) {
            throw NextlyError.internal({
              logContext: { reason: "default-area-create-without-id", area },
            });
          }
          return { id, title };
        } catch (error) {
          if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
          if (attempt >= SLUG_ATTEMPTS) throw error;
          taken.slugs.add(slug);
        }
      }
    },
    removeCreated: id =>
      deleteUnplacedComponent(
        {
          nextly: requireNextly(),
          runs: fenceStore(ctx.db, ctx.dialect),
          components,
        },
        id
      ),
    warn: (message, meta) => ctx.logger.warn(message, meta),
  };
}

/** The route, as the plugin declares it. */
interface CreateInAreaRoute {
  method: "POST";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The route declaration. No `requiredPermission`: its own check above, then
 * core's judgement of the component create and the set write, decide, as for
 * the other set writes. It takes no body: the area is in the path and the set
 * is found on the server.
 */
export function createInAreaRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): CreateInAreaRoute {
  return {
    method: "POST",
    path: DEFAULT_AREA_ROUTE_PATH,
    checksAccess: true, // Checked above, then core judges each write.
    handler: async (_req, ctx) => {
      const { area } = parseRouteParams(
        ctx.params,
        AreaParams,
        "default area route"
      );
      const written = await createInDefaultArea(
        area,
        directCreateInAreaWrites(ctx, store)
      );
      return respondMutation<WrittenArea>(
        `${written.component.title} was created. It is now the ${area} of every page that uses the ${written.set.title} header & footer.`,
        written
      );
    },
  };
}
