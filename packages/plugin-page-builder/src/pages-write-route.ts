/**
 * The Pages panel's writes: create a page, duplicate one, rename one, delete
 * one, without leaving the editor.
 *
 * ## Which collections they write
 *
 * Only a page collection, by the reading the pages search lists pages by
 * (`findPageCollection`): a collection with an addressable Page Builder field
 * that holds pages, whose schema is live, and that is not one of the plugin's
 * composition stores. Any other slug is refused with the generic refusal the
 * read routes give, the same for a collection that does not exist, so the
 * answer never says which it was.
 *
 * ## Who decides what the caller may write
 *
 * Core, and nothing here. Every write runs through the Direct API AS THE
 * CALLER (`readingAsUser`): `overrideAccess: false` with the identity the
 * dispatcher resolved, so each collection's create, update and delete rules,
 * row filters and field rules apply exactly as to the caller's own writes, and
 * a refusal is core's, answered as core answered it. The routes declare no
 * permission and make no access decision of their own. The collection check
 * runs first, before anything is read or written.
 *
 * ## What a new page holds
 *
 * Its title; a slug made from the title where the collection stores one, made
 * unique where the collection requires it; the Draft status where the
 * collection has the lifecycle; and the Page Builder field's own empty
 * document (`emptyBlockDocument`, the value the field type seeds an entry
 * with), so the editor opens on a document its field accepts.
 *
 * @module pages-write-route
 */
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { slugify } from "nextly";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { readBodyWith } from "./composition-route-kit";
import { withVersionFrom } from "./document-version";
import {
  entryOf,
  findAsCaller,
  type AsCallerFindArgs,
  type AsCallerPage,
} from "./entry-reads";
import { emptyBlockDocument } from "./fields/blocks-document";
import {
  DEFAULT_COMPONENT_STORE,
  readingAsUser,
  type ComponentStore,
} from "./library-route";
import type { PageItem, PageReference } from "./pages-search-contract";
import {
  findPageCollection,
  pageItemOf,
  type PageCollection,
  type PageCollectionsContext,
} from "./pages-search-route";
import {
  PAGE_DUPLICATE_ROUTE_PATH,
  PAGE_ROUTE_PATH,
  PAGE_TITLE_MAX,
  PAGES_ROUTE_PATH,
  type CreatePageRequest,
  type RenamePageRequest,
} from "./pages-write-contract";
import { parseRouteParams } from "./route-query";

/** The status a new or duplicated page starts in, where the collection has the lifecycle. */
const DRAFT = "draft";

/** What a duplicate's title starts with. */
const COPY_PREFIX = "Copy of ";

/** The slug a title that holds no letter or digit is given. */
const UNTITLED_SLUG = "page";

/** The longest slug made from a title, before any `-2` suffix. */
const SLUG_BASE_MAX = 80;

/** How many slugs, the base and `-2` up to this, one write considers. */
const SLUG_CANDIDATES = 20;

/**
 * How many of the free slugs a write tries before it gives up. A slug the
 * caller cannot see may still be taken, and core's unique rule then refuses
 * it; the write moves to the next, a bounded number of times.
 */
const WRITE_ATTEMPTS = 3;

/** The longest collection slug or id a path or body may name. */
const NAME_MAX = 200;

/** A collection slug or an id, trimmed and bounded. */
const name = z.string().trim().min(1).max(NAME_MAX);

/** A title as a page may be given it: trimmed, not empty, bounded. */
const title = z.string().trim().min(1).max(PAGE_TITLE_MAX);

const CreateBody = z.strictObject({ collection: name, title });
const RenameBody = z.strictObject({ title, rev: z.string().min(1).optional() });
const PageParams = z.object({ collection: name, id: name });

/** One page as the route's path names it, checked at the boundary. */
export function parsePageParams(
  params: Readonly<Record<string, string>> | undefined
): PageReference {
  return parseRouteParams(params, PageParams, "pages route");
}

/** A create's body, checked at the boundary. */
export async function readCreateBody(req: Request): Promise<CreatePageRequest> {
  return readBodyWith(req, CreateBody, "create page");
}

/**
 * A rename's body, checked at the boundary: its title, and the version of the
 * page it was made from.
 */
export async function readRenameBody(req: Request): Promise<RenamePageRequest> {
  return readBodyWith(req, RenameBody, "rename page");
}

/**
 * What the writes read and write with, injected so the decisions below can be
 * tested without a server. Every call but `collection` runs AS THE CALLER.
 */
export interface PagesWrites {
  /** The page collection `slug` names, or `undefined` for none. */
  collection(slug: string): Promise<PageCollection | undefined>;
  find(args: AsCallerFindArgs): Promise<AsCallerPage>;
  /** Each answers the row core wrote, as core returns it to this caller. */
  create(collection: string, data: Record<string, unknown>): Promise<unknown>;
  duplicate(
    collection: string,
    id: string,
    overrides: Record<string, unknown>
  ): Promise<unknown>;
  update(
    collection: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<unknown>;
  remove(collection: string, id: string): Promise<void>;
}

/**
 * The generic refusal, the same for every slug the routes will not write. The
 * slug goes to the log and nowhere else, as the entries route's does.
 */
function refusal(collection: string): NextlyError {
  return NextlyError.forbidden({
    logContext: { route: PAGES_ROUTE_PATH, collection },
  });
}

/** The page collection `slug` names, or the generic refusal. Runs before any write. */
async function pageSource(
  writes: PagesWrites,
  slug: string
): Promise<PageCollection> {
  const source = await writes.collection(slug);
  if (source === undefined) throw refusal(slug);
  return source;
}

/** A write this collection's pages cannot take, said plainly. */
function cannot(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "collection", code: "INVALID", message }],
  });
}

/** Title field types that take any words an author types. */
const FREE_TEXT_TITLE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
]);

/**
 * The title field's name, where a page's title is free text. A title field of
 * a constrained kind (an email, a URL, a slug) is searched as text but would
 * refuse "About us", so a write leaves it alone.
 */
function textTitleOf(source: PageCollection): string | undefined {
  const title = source.title;
  if (title === undefined || title.kind !== "text") return undefined;
  return title.type === undefined || FREE_TEXT_TITLE_TYPES.has(title.type)
    ? title.name
    : undefined;
}

/**
 * The slug a title is stored under: core's `slugify`, the rule its auto-slug
 * hook makes slugs by, bounded so a `-2` still fits, and a neutral word for a
 * title with no letter or digit in it.
 */
export function slugBaseOf(text: string): string {
  const base = slugify(text).slice(0, SLUG_BASE_MAX).replace(/-+$/, "");
  return base === "" ? UNTITLED_SLUG : base;
}

/** The slugs a write considers, in the order it tries them: `base`, `base-2`, … */
function slugCandidates(base: string): string[] {
  return [
    base,
    ...Array.from(
      { length: SLUG_CANDIDATES - 1 },
      (_, index) => `${base}-${index + 2}`
    ),
  ];
}

/**
 * The candidates for `base` no page this caller can see holds, in order: one
 * read, of the candidates only, as the caller.
 *
 * A caller core lets see none of them (it may not read the collection, or
 * filter on its slug) learns nothing taken; core's unique rule still refuses
 * a taken slug, and the write moves to the next.
 */
async function freeSlugs(
  source: PageCollection,
  field: string,
  base: string,
  writes: PagesWrites
): Promise<string[]> {
  const candidates = slugCandidates(base);
  let rows: readonly unknown[] = [];
  try {
    rows = (
      await writes.find({
        collection: source.slug,
        where: { [field]: { in: candidates } },
        select: { id: true, [field]: true },
        limit: candidates.length,
      })
    ).items;
  } catch (error) {
    if (!NextlyError.isForbidden(error) && !NextlyError.isValidation(error)) {
      throw error;
    }
  }
  const taken = new Set(
    rows.flatMap(row => {
      const value = (row as Record<string, unknown> | null)?.[field];
      return typeof value === "string" ? [value] : [];
    })
  );
  return candidates.filter(candidate => !taken.has(candidate));
}

/**
 * Write a page whose slug is made from `text`: once with the slug where the
 * collection's slugs need not be unique, and otherwise with each free slug in
 * turn, at most {@link WRITE_ATTEMPTS} times, until core does not refuse it as
 * taken. A collection without a slug field is written without one.
 */
async function writeWithSlug(
  source: PageCollection,
  text: string,
  writes: PagesWrites,
  write: (slug: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  const field = source.slugField;
  if (field === undefined) return write({});
  const base = slugBaseOf(text);
  if (!field.unique) return write({ [field.name]: base });
  const free = await freeSlugs(source, field.name, base, writes);
  for (const slug of free.slice(0, WRITE_ATTEMPTS)) {
    try {
      return await write({ [field.name]: slug });
    } catch (error) {
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    }
  }
  throw NextlyError.conflict({
    message: "Every slug this title could take is in use.",
    logContext: {
      reason: "page-slug-taken",
      collection: source.slug,
      considered: SLUG_CANDIDATES,
    },
  });
}

/** `value` stored at a form path: `{ hero: { body: value } }` for `hero.body`. */
function atPath(path: string, value: unknown): Record<string, unknown> {
  const [head = path, ...rest] = path.split(".");
  return { [head]: rest.length === 0 ? value : atPath(rest.join("."), value) };
}

/** The page core wrote, as the search lists it. */
function writtenItem(row: unknown, source: PageCollection): PageItem {
  const item = pageItemOf(row, source);
  if (item === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "page-write-without-id", collection: source.slug },
    });
  }
  return item;
}

/** The lifecycle field a new or duplicated page starts as a draft with. */
function draftOf(source: PageCollection): Record<string, unknown> {
  return source.lifecycle ? { status: DRAFT } : {};
}

/**
 * Create a page: a draft, titled, with a slug made from its title and the
 * Page Builder field's own empty document.
 */
export async function createPage(
  request: CreatePageRequest,
  writes: PagesWrites
): Promise<PageItem> {
  const source = await pageSource(writes, request.collection);
  // Refused before writing, in words the panel can show: core would refuse
  // the create anyway, for a value only the entry's own form can supply.
  if (source.needsMore !== undefined) {
    throw cannot(
      "Pages of this kind need more than a title. Add one from its own list in the admin."
    );
  }
  const titleName = textTitleOf(source);
  const row = await writeWithSlug(source, request.title, writes, slug =>
    writes.create(source.slug, {
      ...(titleName === undefined ? {} : { [titleName]: request.title }),
      ...slug,
      ...draftOf(source),
      ...atPath(source.field, emptyBlockDocument(source.kinds)),
    })
  );
  return writtenItem(row, source);
}

/**
 * Duplicate a page through core's own duplicate, titled "Copy of" its title,
 * with a slug of its own and as a draft.
 *
 * The page is read first, as the caller, for its title: a page this caller
 * cannot read is not found, the answer core's duplicate gives it too.
 */
export async function duplicatePage(
  page: PageReference,
  writes: PagesWrites
): Promise<PageItem> {
  const source = await pageSource(writes, page.collection);
  const titleName = textTitleOf(source);
  const read = await writes.find({
    collection: source.slug,
    where: { id: { equals: page.id } },
    select: {
      id: true,
      ...(titleName === undefined ? {} : { [titleName]: true }),
    },
    limit: 1,
  });
  const original = entryOf(read.items[0], titleName);
  if (original === undefined) {
    throw NextlyError.notFound({
      logContext: { route: PAGE_DUPLICATE_ROUTE_PATH, collection: source.slug },
    });
  }
  // After the read, so a page this caller cannot see is still not found.
  if (source.uncopyable === true) {
    throw cannot(
      "Pages of this kind hold a value that must be unique, so they can't be copied here."
    );
  }
  const copy = `${COPY_PREFIX}${original.title}`.slice(0, PAGE_TITLE_MAX);
  const row = await writeWithSlug(source, copy, writes, slug =>
    writes.duplicate(source.slug, page.id, {
      ...(titleName === undefined ? {} : { [titleName]: copy }),
      ...slug,
      ...draftOf(source),
    })
  );
  return writtenItem(row, source);
}

/**
 * Rename a page: its title field and nothing else. A collection whose pages
 * have no text title cannot be renamed, which is refused as invalid.
 */
export async function renamePage(
  page: PageReference,
  newTitle: string,
  writes: PagesWrites,
  /** The page's version the rename was made from, sent back with the write. */
  rev?: string
): Promise<PageItem> {
  const source = await pageSource(writes, page.collection);
  const titleName = textTitleOf(source);
  if (titleName === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "title",
          code: "INVALID",
          message: "This collection's pages have no title to change.",
        },
      ],
    });
  }
  const row = await writes.update(
    source.slug,
    page.id,
    withVersionFrom({ [titleName]: newTitle }, rev)
  );
  return writtenItem(row, source);
}

/** Delete a page, as core's delete rule for this caller allows or refuses. */
export async function deletePage(
  page: PageReference,
  writes: PagesWrites
): Promise<PageReference> {
  const source = await pageSource(writes, page.collection);
  await writes.remove(source.slug, page.id);
  return { collection: source.slug, id: page.id };
}

/** The route context the writes need: who is asking, and what decides page collections. */
type PagesWriteRouteContext = PageCollectionsContext &
  Pick<PluginRouteContext, "caller">;

/**
 * The writes the routes bind: the shared page-collection lookup, the shared
 * as-caller read, and the Direct API's writes, each AS THE CALLER.
 */
function directPagesWrites(
  ctx: PagesWriteRouteContext,
  store: ComponentStore
): PagesWrites {
  // Resolved per call: the caller resolves its own identity once per request.
  const asUser = () => readingAsUser(ctx);
  return {
    collection: slug => findPageCollection(ctx, store, slug),
    find: args => findAsCaller(ctx, args),
    create: async (collection, data) =>
      (await requireNextly().create({ collection, data, ...(await asUser()) }))
        .item,
    duplicate: async (collection, id, overrides) =>
      (
        await requireNextly().duplicate({
          collection,
          id,
          overrides,
          ...(await asUser()),
        })
      ).item,
    update: async (collection, id, data) =>
      (
        await requireNextly().update({
          collection,
          id,
          data,
          ...(await asUser()),
        })
      ).item,
    remove: async (collection, id) => {
      await requireNextly().delete({ collection, id, ...(await asUser()) });
    },
  };
}

/** One of the routes, as the plugin declares it. */
interface PagesWriteRoute {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The four route declarations, thin on purpose. No `public`, which makes each
 * authenticated, and no `requiredPermission`: the permission is core's to
 * judge on the write itself, per collection.
 *
 * `store` is where component definitions live, so a store the host pointed the
 * plugin at is never written as a page, as the search never lists it.
 */
export function pagesWriteRoutes(
  store: ComponentStore = DEFAULT_COMPONENT_STORE
): PagesWriteRoute[] {
  const writesFor = (ctx: PluginRouteContext) => directPagesWrites(ctx, store);
  return [
    {
      method: "POST",
      path: PAGES_ROUTE_PATH,
      handler: async (req, ctx) =>
        respondMutation<PageItem>(
          "The page was created.",
          await createPage(await readCreateBody(req), writesFor(ctx))
        ),
    },
    {
      method: "POST",
      path: PAGE_DUPLICATE_ROUTE_PATH,
      handler: async (_req, ctx) =>
        respondMutation<PageItem>(
          "The page was duplicated.",
          await duplicatePage(parsePageParams(ctx.params), writesFor(ctx))
        ),
    },
    {
      method: "PATCH",
      path: PAGE_ROUTE_PATH,
      handler: async (req, ctx) => {
        // The path first, then the body, so a bad address is refused before
        // anything else is read.
        const page = parsePageParams(ctx.params);
        const rename = await readRenameBody(req);
        return respondMutation<PageItem>(
          "The page was renamed.",
          await renamePage(page, rename.title, writesFor(ctx), rename.rev)
        );
      },
    },
    {
      method: "DELETE",
      path: PAGE_ROUTE_PATH,
      handler: async (_req, ctx) =>
        respondMutation<PageReference>(
          "The page was deleted.",
          await deletePage(parsePageParams(ctx.params), writesFor(ctx))
        ),
    },
  ];
}
