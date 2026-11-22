/**
 * `POST /layouts/areas/:area/component`: "+ Create a header" (or footer) in a
 * header & footer set's picker on its own screen in the builder.
 *
 * It makes the component only: the starter's design for the area, marked
 * "Use as" for it and published, under the first title and slug no component
 * holds, AS THE CALLER, so the components collection's own create and publish
 * rules decide. No set is written: the picker puts the new component in the
 * set's form, and the set changes through its own Save and Publish. So no set
 * right is asked, and nothing needs undoing when a later step is refused.
 *
 * The create itself is the one "Create a header" on the canvas's band makes
 * (`createStarterComponent`).
 *
 * @module area-component-route
 */
import { respondMutation, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUT_AREAS } from "./collections/areas";
import { createStarterComponent } from "./default-layout/create-in-area-route";
import {
  AREA_COMPONENT_ROUTE_PATH,
  type CreatedAreaComponent,
} from "./layout-area-contract";
import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";
import { parseRouteParams } from "./route-query";

const AreaParams = z.object({ area: z.enum(LAYOUT_AREAS) });

/** The route, as the plugin declares it. */
interface AreaComponentRoute {
  method: "POST";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The route declaration. No `requiredPermission`: core judges the component
 * create and its publish, as the caller. It takes no body: the area is in the
 * path, and the names are the first free ones.
 */
export function areaComponentRoute(
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  create: typeof createStarterComponent = createStarterComponent
): AreaComponentRoute {
  return {
    method: "POST",
    path: AREA_COMPONENT_ROUTE_PATH,
    checksAccess: true, // Core judges the create and its publish.
    handler: async (_req, ctx) => {
      const { area } = parseRouteParams(
        ctx.params,
        AreaParams,
        "area component route"
      );
      // Made for this set's own use: the site default never takes it.
      const made = await create(ctx, store, area, "own set");
      return respondMutation<CreatedAreaComponent>(
        `${made.title} was created.`,
        { ...made, area },
        { status: 201 }
      );
    },
  };
}
