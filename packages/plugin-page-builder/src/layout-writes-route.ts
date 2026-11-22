/**
 * The header & footer set writes the builder's Pages panel makes: rename a
 * set, and copy one as a draft named "Copy of" its title.
 *
 * ## Who may write
 *
 * Core, and nothing here, as for the Pages panel's page writes. Each write
 * runs through the Direct API AS THE CALLER (`readingAsUser`,
 * `overrideAccess: false`), so the sets collection's own update and create
 * rules, its row filters and its field rules decide, before anything is
 * written, exactly as for the caller's own writes in the admin: a rule that
 * lets an author update only some sets lets them rename those. A refusal is
 * core's, answered as core answered it.
 *
 * ## A rename's version
 *
 * The set is read first as it is SAVED, as the caller (its working draft
 * where one waits), and the rename carries that read's version, so a write
 * made since is not silently overwritten. The title it answers is the saved
 * one: a published set's rename is saved as a change not yet published.
 *
 * ## A new set
 *
 * Made from one of three starts, as a draft with a slug of its own, under the
 * title the author gave: a copy of the site default (core's duplicate of it,
 * as a copy above is), the starter header and footer, or empty (no areas).
 * The default is found on the server and copied AS THE CALLER, so a default
 * this caller cannot read is not found.
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
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { deleteUnplacedComponent } from "./component-delete/system-delete";
import { readBodyWith } from "./composition-route-kit";
import { createStarterComponent } from "./default-layout/create-in-area-route";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import { readLayoutSettings } from "./default-layout/store";
import { documentVersionOf, withVersionFrom } from "./document-version";
import {
  entryOf,
  findAsCaller,
  readSavedAsCaller,
  type AsCallerFindArgs,
  type AsCallerPage,
} from "./entry-reads";
import { fenceStore } from "./host-rewrite/fence";
import {
  LAYOUT_DUPLICATE_ROUTE_PATH,
  LAYOUT_NEW_ROUTE_PATH,
  LAYOUT_TITLE_MAX,
  LAYOUT_TITLE_ROUTE_PATH,
  NEW_LAYOUT_STARTS,
  type NewLayoutStart,
  type WrittenLayout,
} from "./layout-writes-contract";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
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

/** A new set's title and start. */
const NewBody = z.strictObject({
  title: z.string().trim().min(1).max(LAYOUT_TITLE_MAX),
  start: z.enum(NEW_LAYOUT_STARTS as [NewLayoutStart, ...NewLayoutStart[]]),
});

/**
 * What the writes read and write with, injected so the decisions below can
 * be tested without a server. Every call runs AS THE CALLER.
 */
export interface LayoutWrites {
  find(args: AsCallerFindArgs): Promise<AsCallerPage>;
  /** The set as it is saved, or null where the caller may not read it. */
  readSaved(
    collection: string,
    id: string
  ): Promise<Record<string, unknown> | null>;
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
  create(collection: string, data: Record<string, unknown>): Promise<unknown>;
  /** The site default, by id, or null where none is set. */
  defaultLayout(): Promise<string | null>;
  /**
   * A new starter header and footer, made as the caller and published, as
   * the areas a set names them in.
   */
  starterAreas(): Promise<readonly { area: string; component: string }[]>;
  /**
   * Delete components this request made and nothing places, best effort:
   * the starter's, when the set that was to name them was refused.
   */
  removeCreated(ids: readonly string[]): Promise<void>;
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

/**
 * Rename a set: its title and nothing else, made from the set as it is saved
 * and carrying that read's version.
 */
export async function renameLayout(
  collection: string,
  id: string,
  title: string,
  writes: LayoutWrites
): Promise<WrittenLayout> {
  const saved = await writes.readSaved(collection, id);
  if (saved === null) {
    throw NextlyError.notFound({
      logContext: { route: LAYOUT_TITLE_ROUTE_PATH, collection },
    });
  }
  const row = await writes.update(
    collection,
    id,
    withVersionFrom({ title }, documentVersionOf(saved))
  );
  return written(row, collection);
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

/**
 * Make a new set titled `title`, from `start`, as a draft with a slug of its
 * own: a copy of the site default, a new starter header and footer, or no
 * areas at all.
 */
export async function createLayout(
  collection: string,
  request: { readonly title: string; readonly start: NewLayoutStart },
  writes: LayoutWrites
): Promise<WrittenLayout> {
  const { title, start } = request;
  const target = { slug: collection, slugField: SLUG_FIELD };
  if (start === "copy-default") {
    const defaultId = await writes.defaultLayout();
    if (defaultId === null) {
      throw NextlyError.notFound({
        message: "This site has no default header & footer set to copy.",
        logContext: { route: LAYOUT_NEW_ROUTE_PATH, collection },
      });
    }
    const row = await writeWithSlug(target, title, writes, slug =>
      writes.duplicate(collection, defaultId, {
        title,
        ...slug,
        status: "draft",
      })
    );
    return written(row, collection);
  }
  const areas = start === "starter" ? await writes.starterAreas() : [];
  try {
    const row = await writeWithSlug(target, title, writes, slug =>
      writes.create(collection, { title, ...slug, areas, status: "draft" })
    );
    return written(row, collection);
  } catch (error) {
    // A refused set leaves no starter components of its own behind.
    await writes
      .removeCreated(areas.map(row => row.component))
      .catch(() => undefined);
    throw error;
  }
}

/** The Direct API, as the caller, for the sets collection. */
function directLayoutWrites(
  ctx: PluginRouteContext,
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): LayoutWrites {
  // Resolved per call: the caller resolves its own identity once per request.
  const asUser = () => readingAsUser(ctx);
  return {
    find: args => findAsCaller(ctx, args),
    readSaved: (collection, id) =>
      readSavedAsCaller(ctx, {
        collection,
        id,
        select: { id: true, title: true },
      }),
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
    create: async (collection, data) =>
      (
        await requireNextly().create({
          collection,
          data,
          ...(await asUser()),
        })
      ).item,
    // A new starter header and footer of the set's own, made as the band's
    // "Create a header" makes one, each published as the caller.
    starterAreas: async () => {
      const header = await createStarterComponent(
        ctx,
        store,
        "header",
        "own set"
      );
      try {
        const footer = await createStarterComponent(
          ctx,
          store,
          "footer",
          "own set"
        );
        return [
          { area: "header", component: header.id },
          { area: "footer", component: footer.id },
        ];
      } catch (error) {
        await removeUnplaced(ctx, store, [header.id]).catch(() => undefined);
        throw error;
      }
    },
    removeCreated: ids => removeUnplaced(ctx, store, ids),
    defaultLayout: async () =>
      (
        await readLayoutSettings(requireNextly(), {
          layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
          settings:
            ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
            PAGE_BUILDER_SETTINGS_SLUG,
        })
      ).defaultLayout,
  };
}

/** Delete components nothing places, as the system, one after another. */
async function removeUnplaced(
  ctx: PluginRouteContext,
  store: ComponentStore,
  ids: readonly string[]
): Promise<void> {
  const components =
    store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  for (const id of ids) {
    await deleteUnplacedComponent(
      {
        nextly: requireNextly(),
        runs: fenceStore(ctx.db, ctx.dialect),
        components,
      },
      id
    );
  }
}

/** One of the routes, as the plugin declares it. */
interface LayoutWriteRoute {
  method: "POST" | "PATCH";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The two route declarations, thin on purpose. No `public`, which makes each
 * authenticated, and no `requiredPermission`: the permission is core's to
 * judge on the write itself, per set, as for the page writes.
 */
export function layoutWriteRoutes(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): LayoutWriteRoute[] {
  const setsOf = (ctx: PluginRouteContext) =>
    ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG;
  return [
    {
      method: "PATCH",
      path: LAYOUT_TITLE_ROUTE_PATH,
      checksAccess: true, // Core judges each write, as the caller.
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
      checksAccess: true, // Core judges each write, as the caller.
      handler: async (_req, ctx) => {
        const { id } = parseRouteParams(ctx.params, LayoutParams, "set route");
        return respondMutation<WrittenLayout>(
          "The header & footer set was copied.",
          await duplicateLayout(setsOf(ctx), id, directLayoutWrites(ctx))
        );
      },
    },
    {
      method: "POST",
      path: LAYOUT_NEW_ROUTE_PATH,
      checksAccess: true, // Core judges each write, as the caller.
      handler: async (req, ctx) => {
        const request = await readBodyWith(req, NewBody, "new set");
        return respondMutation<WrittenLayout>(
          "The header & footer set was made.",
          await createLayout(
            setsOf(ctx),
            request,
            directLayoutWrites(ctx, store)
          ),
          { status: 201 }
        );
      },
    },
  ];
}
