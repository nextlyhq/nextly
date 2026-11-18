/**
 * `POST /default-layout/fill-notices`: the fills of the default waiting to be
 * told to the caller, taken.
 *
 * The fill runs on the server, after the publish commits (`first-fill-hook`),
 * whichever screen or API published, and records who published. The screen
 * the author published from asks here once its publish has landed, and again
 * when the author opens the component, so a publish from somewhere that could
 * not say it is told the next time they are back. Each fill is answered once,
 * to its publisher only (`fill-mark`): a second tab, or a second ask, is told
 * nothing.
 *
 * ## What it checks
 *
 * `read` on components, declared, enforced by core before the handler runs:
 * whoever published a component can read components. The answer is only ever
 * about the caller's own publishes, and names each component by its title,
 * which the caller just published.
 *
 * @module default-layout/fill-notice-route
 */
import {
  getCachedNextly,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";

import { fillMarkStore, type FillMarkStore } from "./fill-mark";
import {
  FILL_NOTICES_ROUTE_PATH,
  type FillNotice,
  type FillNoticesResult,
} from "./fill-notice-contract";
import type { DefaultLayoutDirectApi } from "./store";

/** The capabilities the route uses, named rather than taken whole. */
export type FillNoticesContext = Pick<PluginRouteContext, "user" | "self">;

/**
 * Take the caller's fills and name each one's component, as the system: the
 * caller published it, and a title that cannot be read is not withheld from
 * the person who wrote it.
 */
export async function takeFillNotices(
  ctx: FillNoticesContext,
  marks: Pick<FillMarkStore, "take">,
  nextly: Pick<DefaultLayoutDirectApi, "find">
): Promise<FillNoticesResult> {
  const layouts = ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  const setsAddress = `/admin/collections/${encodeURIComponent(layouts)}`;
  const user = ctx.user?.id;
  if (typeof user !== "string" || user === "") {
    return { fills: [], setsAddress };
  }
  const taken = await marks.take(user);
  if (taken.length === 0) return { fills: [], setsAddress };
  const components = ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG;
  const found = await nextly.find({
    collection: components,
    where: { id: { in: taken.map(fill => fill.component) } },
    status: "all",
    limit: taken.length,
    depth: 0,
    select: { id: true, title: true },
    overrideAccess: true,
  });
  const titles = new Map(
    (found.items as { id?: unknown; title?: unknown }[]).map(row => [
      row.id,
      row.title,
    ])
  );
  const fills: FillNotice[] = taken.map(fill => {
    const title = titles.get(fill.component);
    return {
      area: fill.area,
      component: {
        id: fill.component,
        title:
          typeof title === "string" && title !== ""
            ? title
            : `Your ${fill.area}`,
      },
    };
  });
  return { fills, setsAddress };
}

/** The route declaration. */
export function fillNoticesRoute(): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: FILL_NOTICES_ROUTE_PATH,
    requiredPermission: ({ collection }) => collection(COMPONENTS_SLUG, "read"),
    handler: async (_req, ctx) => {
      const result = await takeFillNotices(
        ctx,
        fillMarkStore(ctx.db, ctx.dialect),
        await getCachedNextly()
      );
      return respondMutation<FillNoticesResult>(
        result.fills.length === 0
          ? "Nothing is waiting to be told."
          : "The default header & footer set was filled.",
        result
      );
    },
  };
}
