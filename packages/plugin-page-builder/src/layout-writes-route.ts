/**
 * The header & footer set writes the builder's Pages panel makes: rename a
 * set, and copy one as a draft named "Copy of" its title.
 *
 * ## Who may write
 *
 * Each route is gated by the set write it makes, on the sets' collection as
 * the site named it: `update` to rename, `create` to copy, checked by the
 * dispatcher before the handler runs, as every collection write's own gate
 * is. The write itself then runs through the Direct API AS THE CALLER
 * (`readingAsUser`, `overrideAccess: false`), so the collection's own rules,
 * row filters and field rules apply exactly as to the caller's own writes in
 * the admin, and a refusal is core's.
 *
 * ## What a copy holds
 *
 * Everything the set holds, by core's own duplicate, as a draft, titled
 * "Copy of" its title, with a slug of its own made by the rule a page's copy
 * is given (`writeWithSlug`): the sets collection's slug is required and
 * unique.
 *
 * @module layout-writes-route
 */
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "./collections/layouts";
import { readBodyWith } from "./composition-route-kit";
import {
  entryOf,
  findAsCaller,
  type AsCallerFindArgs,
  type AsCallerPage,
} from "./entry-reads";
import {
  LAYOUT_DUPLICATE_ROUTE_PATH,
  LAYOUT_TITLE_MAX,
  LAYOUT_TITLE_ROUTE_PATH,
  type WrittenLayout,
} from "./layout-writes-contract";
import { readingAsUser } from "./library-route";
import { writeWithSlug } from "./pages-write-route";
import { parseRouteParams } from "./route-query";

/** How a copy's title begins. */
const COPY_PREFIX = "Copy of ";

/** The sets collection's slug field, required and unique. */
const SLUG_FIELD = { name: "slug", unique: true } as const;

/** A title as a set may be given it: trimmed, not empty, bounded. */
const TitleBody = z.strictObject({
  title: z.string().trim().min(1).max(LAYOUT_TITLE_MAX),
});
const LayoutParams = z.object({ id: z.string().trim().min(1).max(200) });

/**
 * What the writes read and write with, injected so the decisions below can
 * be tested without a server. Every call runs AS THE CALLER.
 */
export interface LayoutWrites {
  find(args: AsCallerFindArgs): Promise<AsCallerPage>;
  /** Each answers the row core wrote, as core returns it to this caller. */
  update(
    collection: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<unknown>;
  duplicate(
    collection: string,
    id: string,
    overrides: Record<string, unknown>
  ): Promise<unknown>;
}

/** The set core wrote, as the panel lists it. */
function written(row: unknown, collection: string): WrittenLayout {
  const entry = entryOf(row, "title");
  if (entry === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "layout-write-without-id", collection },
    });
  }
  return { id: entry.id, title: entry.title };
}

/** Rename a set: its title and nothing else. */
export async function renameLayout(
  collection: string,
  id: string,
  title: string,
  writes: LayoutWrites
): Promise<WrittenLayout> {
  return written(await writes.update(collection, id, { title }), collection);
}

/**
 * Copy a set through core's own duplicate, as a draft titled "Copy of" its
 * title, with a slug of its own.
 *
 * The set is read first, as the caller, for its title: one this caller
 * cannot read is not found, the answer core's duplicate gives it too.
 */
export async function duplicateLayout(
  collection: string,
  id: string,
  writes: LayoutWrites
): Promise<WrittenLayout> {
  const read = await writes.find({
    collection,
    where: { id: { equals: id } },
    select: { id: true, title: true },
    limit: 1,
  });
  const original = entryOf(read.items[0], "title");
  if (original === undefined) {
    throw NextlyError.notFound({
      logContext: { route: LAYOUT_DUPLICATE_ROUTE_PATH, collection },
    });
  }
  const copy = `${COPY_PREFIX}${original.title}`.slice(0, LAYOUT_TITLE_MAX);
  const row = await writeWithSlug(
    { slug: collection, slugField: SLUG_FIELD },
    copy,
    writes,
    slug =>
      writes.duplicate(collection, id, {
        title: copy,
        ...slug,
        status: "draft",
      })
  );
  return written(row, collection);
}

/** The Direct API, as the caller, for the sets collection. */
function directLayoutWrites(ctx: PluginRouteContext): LayoutWrites {
  // Resolved per call: the caller resolves its own identity once per request.
  const asUser = () => readingAsUser(ctx);
  return {
    find: args => findAsCaller(ctx, args),
    update: async (collection, id, data) =>
      (
        await requireNextly().update({
          collection,
          id,
          data,
          ...(await asUser()),
        })
      ).item,
    duplicate: async (collection, id, overrides) =>
      (
        await requireNextly().duplicate({
          collection,
          id,
          overrides,
          ...(await asUser()),
        })
      ).item,
  };
}

/** One of the routes, as the plugin declares it. */
interface LayoutWriteRoute {
  method: "POST" | "PATCH";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The two route declarations. Each permission is COMPUTED, so a host that
 * renamed the sets collection still has routes its authors can call, and the
 * dispatcher checks it before the handler reads or writes anything.
 */
export function layoutWriteRoutes(): LayoutWriteRoute[] {
  const setsOf = (ctx: PluginRouteContext) =>
    ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  return [
    {
      method: "PATCH",
      path: LAYOUT_TITLE_ROUTE_PATH,
      requiredPermission: ({ collection }) =>
        collection(LAYOUTS_SLUG, "update"),
      handler: async (req, ctx) => {
        // The path first, then the body, so a bad address is refused before
        // anything else is read.
        const { id } = parseRouteParams(ctx.params, LayoutParams, "set route");
        const { title } = await readBodyWith(req, TitleBody, "rename set");
        return respondMutation<WrittenLayout>(
          "The header & footer set was renamed.",
          await renameLayout(setsOf(ctx), id, title, directLayoutWrites(ctx))
        );
      },
    },
    {
      method: "POST",
      path: LAYOUT_DUPLICATE_ROUTE_PATH,
      requiredPermission: ({ collection }) =>
        collection(LAYOUTS_SLUG, "create"),
      handler: async (_req, ctx) => {
        const { id } = parseRouteParams(ctx.params, LayoutParams, "set route");
        return respondMutation<WrittenLayout>(
          "The header & footer set was copied.",
          await duplicateLayout(setsOf(ctx), id, directLayoutWrites(ctx))
        );
      },
    },
  ];
}
