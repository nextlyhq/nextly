/**
 * `POST` and `GET /components/:id/delete`: Delete component, as routes.
 *
 * The calls and their answers are `contract.ts`'s; the steps are `job.ts`'s.
 *
 * ## Who may call them
 *
 * The routes admit a signed-in caller who may read the component store.
 * Starting a delete asks, before anything is written, whether they hold the
 * right to delete components at all; whether they may delete THIS one, and
 * change each document, is decided by the writes themselves, made as them
 * through the Direct API with their access enforced. A dry run asks nothing
 * past reading, and says whether they hold the right, so the dialog can say
 * so beside what the delete would do.
 *
 * @module component-delete/route
 */
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "../collections/components";
import { storeOf } from "../composition-route-kit";
import { readingAsUser, type ComponentStore } from "../library-route";

import { COMPONENT_DELETE_ROUTE_PATH } from "./contract";
import {
  componentDeleteProgress,
  planComponentDelete,
  stepComponentDelete,
  type ComponentDeleteDeps,
} from "./job";

/**
 * The request body. Unknown keys are refused rather than dropped: a typo of
 * `dryRun` silently ignored would start the delete the caller meant to
 * preview.
 */
const DeleteBody = z.strictObject({ dryRun: z.boolean().optional() });

/** The body, parsed at the boundary; an empty body is `{}`. */
async function readBody(req: Request): Promise<z.infer<typeof DeleteBody>> {
  const text = await req.text();
  let raw: unknown;
  try {
    raw = text.trim() === "" ? {} : (JSON.parse(text) as unknown);
  } catch {
    raw = undefined;
  }
  const parsed = DeleteBody.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: [
      {
        path: "body",
        code: "INVALID_TYPE",
        message: "The request is not a Delete component request.",
      },
    ],
  });
}

/** What the routes are built with: the installed plugin's parts, per call. */
export interface ComponentDeleteRouteSetup {
  /** Where components are stored, when the host keeps them itself. */
  readonly store?: ComponentStore;
  /** The job's parts that come from the installed plugin. */
  readonly install: () => Pick<ComponentDeleteDeps, "rewrite" | "runs">;
}

/** The job's dependencies for one request. */
async function depsFor(
  setup: ComponentDeleteRouteSetup,
  ctx: PluginRouteContext
): Promise<ComponentDeleteDeps> {
  const caller = ctx.caller;
  if (ctx.user === null || caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "component-delete-needs-a-person" },
    });
  }
  const components = storeOf(ctx, setup).collection;
  return {
    ...setup.install(),
    componentId: ctx.params.id ?? "",
    components,
    caller: ctx,
    nextly: await getCachedNextly(),
    asPerson: await readingAsUser(ctx),
    may: (action, resource, anyEntry) =>
      caller.can(action, resource, anyEntry ? { anyEntry } : undefined),
    mayReadSingle: slug => caller.can("read", slug),
    now: () => new Date(),
  };
}

/** The route declarations. */
export function componentDeleteRoutes(setup: ComponentDeleteRouteSetup): {
  method: "POST" | "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}[] {
  const readComponents = ({ collection }: PluginRoutePermissionScope) =>
    setup.store?.collection === undefined
      ? collection(COMPONENTS_SLUG, "read")
      : `read-${setup.store.collection}`;
  return [
    {
      method: "POST",
      path: COMPONENT_DELETE_ROUTE_PATH,
      requiredPermission: readComponents,
      handler: async (req, ctx) => {
        const body = await readBody(req);
        const deps = await depsFor(setup, ctx);
        const answer =
          body.dryRun === true
            ? await planComponentDelete(deps)
            : await stepComponentDelete(deps);
        return respondMutation(answer.message, answer.item);
      },
    },
    {
      method: "GET",
      path: COMPONENT_DELETE_ROUTE_PATH,
      requiredPermission: readComponents,
      handler: async (_req, ctx) => {
        const answer = await componentDeleteProgress(await depsFor(setup, ctx));
        return respondMutation(answer.message, answer.item);
      },
    },
  ];
}
