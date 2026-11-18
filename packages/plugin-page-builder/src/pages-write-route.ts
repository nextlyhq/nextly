/**
 * The Pages panel's writes: create a page, duplicate one, rename one, delete
 * one, without leaving the editor; and the New page dialog's read of what a
 * new page would get before it is made.
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
 * Its title; the address the author typed, refused when another page holds
 * it, or else a slug made from the title, made unique where the collection
 * requires it; the Draft status where the collection has the lifecycle; the
 * header & footer choice and other fields the author gave; and the Page
 * Builder field's own empty document (`emptyBlockDocument`, the value the
 * field type seeds an entry with) or a starter page's, so the editor opens on
 * a document its field accepts.
 *
 * @module pages-write-route
 */
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { slugify } from "nextly";
import { readPublicSiteSettings, requireNextly } from "nextly/runtime";
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
import { pageCollections } from "./pages-search-collections";
import type { PageItem, PageReference } from "./pages-search-contract";
import { directPagesSearchReads } from "./pages-search-handler";
import { pathOf } from "./pages-search-items";
import {
  findPageCollection,
  pageItemOf,
  type PageCollection,
  type PageCollectionsContext,
} from "./pages-search-route";
import {
  NEW_PAGE_PARAMS,
  NEW_PAGE_ROUTE_PATH,
  PAGE_DUPLICATE_ROUTE_PATH,
  PAGE_ROUTE_PATH,
  PAGE_SLUG_BASE_MAX,
  PAGE_SLUG_MAX,
  PAGE_TITLE_MAX,
  PAGES_ROUTE_PATH,
  UNTITLED_PAGE_SLUG,
  type CreatedPageItem,
  type CreatePageRequest,
  type NewPageAddress,
  type NewPageCollection,
  type NewPageFacts,
  type NewPageStarter,
  type RenamePageRequest,
} from "./pages-write-contract";
import { optionalText, parseRouteParams, parseRouteQuery } from "./route-query";

/** The status a new or duplicated page starts in, where the collection has the lifecycle. */
const DRAFT = "draft";

/** What a duplicate's title starts with. */
const COPY_PREFIX = "Copy of ";

/** The slug a title that holds no letter or digit is given. */
const UNTITLED_SLUG = UNTITLED_PAGE_SLUG;

/** The longest slug made from a title, before any `-2` suffix. */
const SLUG_BASE_MAX = PAGE_SLUG_BASE_MAX;

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

/** The most other fields one create may fill. */
const FIELDS_MAX = 50;

/** A top-level field's name: no path, no dot, nothing a key could hide. */
const FIELD_NAME = /^[A-Za-z_$][\w$]{0,63}$/;

const CreateBody = z.strictObject({
  collection: name,
  title,
  slug: z.string().trim().min(1).max(PAGE_SLUG_MAX).optional(),
  layout: z.string().min(1).max(NAME_MAX).nullable().optional(),
  noHeaderFooter: z.boolean().optional(),
  starter: name.optional(),
  fields: z
    .record(z.string().regex(FIELD_NAME), z.unknown())
    .refine(fields => Object.keys(fields).length <= FIELDS_MAX, {
      message: `At most ${FIELDS_MAX} fields.`,
    })
    .optional(),
});
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
  /** Whether the caller may `action` entries of `collection`, as core judges it. */
  may(action: "create" | "update", collection: string): Promise<boolean>;
  /**
   * The document the starter page `id` gives a new page of `source`, or
   * `undefined` where none is offered under that id.
   */
  starter(
    source: PageCollection,
    id: string
  ): Promise<{ readonly document: unknown } | undefined>;
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

/**
 * A typed address as it is stored: each `/`-separated part by core's
 * `slugify`, empty parts dropped, bounded by the address column. The same
 * answers as the dialog's `pageSlugOfTyped`, which a test holds them to.
 */
export function typedSlugOf(typed: string): string {
  return typed
    .split("/")
    .map(part => slugify(part))
    .filter(part => part !== "")
    .join("/")
    .slice(0, SLUG_PATH_MAX)
    .replace(/[-/]+$/, "");
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
  source: SlugTarget,
  field: string,
  base: string,
  writes: Pick<PagesWrites, "find">
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

/** The longest address a page may be stored at (`db.slugPaths`). */
const SLUG_PATH_MAX = 255;

/** Room kept at the end of an address for a suffix that frees it (`-51`). */
const SUFFIX_ROOM = 4;

/**
 * The slug a page made from `text` starts from: beneath `parent` where the
 * page sits beneath another and the address leaves room for a name, cut so
 * the whole address, its freeing suffix included, fits the column; at the
 * top level otherwise.
 */
function nestedSlugBase(text: string, parent: string | undefined): string {
  const own = slugBaseOf(text);
  if (parent === undefined || parent === "") return own;
  const room = SLUG_PATH_MAX - parent.length - 1 - SUFFIX_ROOM;
  if (room < 1) return own;
  const cut = own.slice(0, room).replace(/-+$/, "");
  return cut === "" ? own : `${parent}/${cut}`;
}

/**
 * The address a stored page sits beneath: its slug up to the last `/`, or
 * nothing for a page at the top level or one whose slug was not read.
 */
function parentOf(
  row: unknown,
  slugName: string | undefined
): string | undefined {
  if (slugName === undefined) return undefined;
  const slug = (row as Record<string, unknown> | null)?.[slugName];
  if (typeof slug !== "string") return undefined;
  const at = slug.lastIndexOf("/");
  return at <= 0 ? undefined : slug.slice(0, at);
}

/**
 * The collection a slug is made for: its slug, and its slug field where it has
 * one. A page collection is one; so is the header & footer sets collection,
 * whose copies are written through the same slug rule.
 */
export interface SlugTarget {
  readonly slug: string;
  readonly slugField?: { readonly name: string; readonly unique: boolean };
}

/**
 * Write an entry whose slug is made from `text`: once with the slug where the
 * collection's slugs need not be unique, and otherwise with each free slug in
 * turn, at most {@link WRITE_ATTEMPTS} times, until core does not refuse it as
 * taken. A collection without a slug field is written without one.
 */
export async function writeWithSlug(
  source: SlugTarget,
  text: string,
  writes: Pick<PagesWrites, "find">,
  write: (slug: Record<string, unknown>) => Promise<unknown>,
  /**
   * The address the page sits beneath (`docs` for `docs/install`), so a
   * copy of a nested page lands beside it rather than at the top level.
   */
  parent?: string
): Promise<unknown> {
  const field = source.slugField;
  if (field === undefined) return write({});
  const base = nestedSlugBase(text, parent);
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

/** The words a taken address is refused with, naming its page where it may. */
function addressTaken(holder: string | undefined): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "slug",
        code: "TAKEN",
        message: `That address is used by ${holder ?? "another page"}`,
      },
    ],
  });
}

/**
 * The title of the page holding `slug` in `source`, where the caller may
 * read it; `undefined` where no page they can read holds it. Core's unique
 * rule still refuses an address held by a page they can't read.
 */
async function holderOf(
  source: PageCollection,
  field: string,
  slug: string,
  writes: Pick<PagesWrites, "find">
): Promise<string | undefined> {
  const titleName = textTitleOf(source);
  try {
    const read = await writes.find({
      collection: source.slug,
      where: { [field]: { equals: slug } },
      select: {
        id: true,
        [field]: true,
        ...(titleName === undefined ? {} : { [titleName]: true }),
      },
      limit: 1,
    });
    const row = read.items[0];
    if (row === undefined) return undefined;
    return entryOf(row, titleName)?.title ?? "another page";
  } catch (error) {
    if (NextlyError.isForbidden(error) || NextlyError.isValidation(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Write an entry at the address the author typed: refused, naming the page,
 * where a page they can read holds it, and refused as "another page" where
 * core's unique rule finds one they can't. Never moved on to a free one: a
 * typed address is a choice.
 */
async function writeAtTyped(
  source: PageCollection,
  typed: string,
  writes: Pick<PagesWrites, "find">,
  write: (slug: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  const field = source.slugField;
  if (field === undefined) return write({});
  if (field.unique) {
    const holder = await holderOf(source, field.name, typed, writes);
    if (holder !== undefined) throw addressTaken(holder);
  }
  try {
    return await write({ [field.name]: typed });
  } catch (error) {
    if (NextlyError.isCode(error, "DUPLICATE")) throw addressTaken(undefined);
    throw error;
  }
}

/** The document a new page starts with: a starter's, or the field's own empty one. */
async function startingDocument(
  source: PageCollection,
  starter: string | undefined,
  writes: Pick<PagesWrites, "starter">
): Promise<unknown> {
  if (starter === undefined) return emptyBlockDocument(source.kinds);
  const offered = await writes.starter(source, starter);
  if (offered === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "starter",
          code: "INVALID",
          message: "That starter page isn't offered here any more.",
        },
      ],
    });
  }
  return offered.document;
}

/** The header & footer choice as the page stores it, where one was sent. */
function headerFooterOf(request: CreatePageRequest): Record<string, unknown> {
  return {
    ...(request.layout === undefined ? {} : { layout: request.layout }),
    ...(request.noHeaderFooter === undefined
      ? {}
      : { noHeaderFooter: request.noHeaderFooter }),
  };
}

/**
 * Create a page: titled, a draft where the collection has the lifecycle,
 * with the Page Builder field's own empty document or a starter's, and the
 * header & footer choice and other fields the author gave.
 *
 * Its address is the one typed, refused when taken; else one made from the
 * title, moved on to the first free one. Everything else is core's to
 * judge, as the caller: a required field left empty is refused by core,
 * whose refusal names the field, so the dialog can ask for it.
 */
export async function createPage(
  request: CreatePageRequest,
  writes: PagesWrites
): Promise<CreatedPageItem> {
  const source = await pageSource(writes, request.collection);
  const titleName = textTitleOf(source);
  const document = await startingDocument(source, request.starter, writes);
  const write = (slug: Record<string, unknown>) =>
    writes.create(source.slug, {
      // The other fields first, so a name the route writes itself is the
      // route's: the title, the address, the status and the page.
      ...request.fields,
      ...headerFooterOf(request),
      ...(titleName === undefined ? {} : { [titleName]: request.title }),
      ...slug,
      ...draftOf(source),
      ...atPath(source.field, document),
    });
  const typed =
    request.slug === undefined ? undefined : typedSlugOf(request.slug);
  const row =
    typed === undefined || typed === ""
      ? await writeWithSlug(source, request.title, writes, write)
      : await writeAtTyped(source, typed, writes, write);
  return {
    ...writtenItem(row, source),
    mayUpdate: await writes.may("update", source.slug),
  };
}

/** What the New page read is asked: a collection, and a title and typed address to check. */
export interface NewPageRequest {
  readonly collection: string;
  readonly title?: string;
  readonly slug?: string;
}

const newPageQuerySchema = z.object({
  [NEW_PAGE_PARAMS.collection]: name,
  [NEW_PAGE_PARAMS.title]: optionalText(PAGE_TITLE_MAX),
  [NEW_PAGE_PARAMS.slug]: optionalText(PAGE_SLUG_MAX),
});

/** The New page read's query, or a refusal naming the parameter. */
export function parseNewPageQuery(url: string | URL): NewPageRequest {
  const query = parseRouteQuery(
    url,
    Object.values(NEW_PAGE_PARAMS),
    newPageQuerySchema,
    "new page"
  );
  const { title: asked, slug } = {
    title: query[NEW_PAGE_PARAMS.title],
    slug: query[NEW_PAGE_PARAMS.slug],
  };
  return {
    collection: query[NEW_PAGE_PARAMS.collection],
    ...(asked === undefined ? {} : { title: asked }),
    ...(slug === undefined ? {} : { slug }),
  };
}

/** What the New page read reads beyond the writes'. */
export interface NewPageReads extends PagesWrites {
  /** Every collection that holds pages, by the search's reading. */
  pageCollections(): Promise<readonly PageCollection[]>;
  /** The plugin's own Pages, as the site resolved its slug. */
  pagesCollection(): string;
  /** Where the plugin's own Pages are served (`/{slug}`), if the host said. */
  pagePath(): string | undefined;
  /** The site's address, or null while it is unset. */
  site(): Promise<string | null>;
  /** The starter pages a new page of `source` may start from. */
  starters(source: PageCollection): Promise<readonly NewPageStarter[]>;
}

/** A page collection as the dialog names it. */
function namedCollection(source: PageCollection): NewPageCollection {
  return { slug: source.slug, label: source.label };
}

/** Stands in for the address while the path is filled, to find what is around it. */
const ADDRESS_MARK = "nextlynewpagemark";

/**
 * The path either side of a page's own address: the plugin's own Pages
 * through where the host serves them, any other collection's left empty,
 * since its path is the host's own code.
 */
function aroundAddress(
  source: PageCollection,
  reads: Pick<NewPageReads, "pagesCollection" | "pagePath">
): { before: string; after: string } {
  const template = reads.pagePath();
  if (template === undefined || source.slug !== reads.pagesCollection()) {
    return { before: "", after: "" };
  }
  const field = source.slugField?.name ?? "slug";
  const path = pathOf(
    { [field]: ADDRESS_MARK },
    { ...source, pathTemplate: template }
  ).path;
  const at = path?.indexOf(ADDRESS_MARK) ?? -1;
  if (path === undefined || at < 0) return { before: "", after: "" };
  return {
    before: path.slice(0, at),
    after: path.slice(at + ADDRESS_MARK.length),
  };
}

/** The address part of the New page read's answer. */
async function newPageAddress(
  source: PageCollection,
  request: NewPageRequest,
  reads: NewPageReads
): Promise<NewPageAddress | null> {
  const field = source.slugField;
  if (field === undefined) return null;
  const around = { site: await reads.site(), ...aroundAddress(source, reads) };
  const typed = request.slug === undefined ? "" : typedSlugOf(request.slug);
  if (typed !== "") {
    const holder = field.unique
      ? await holderOf(source, field.name, typed, reads)
      : undefined;
    return {
      ...around,
      slug: typed,
      ...(holder === undefined ? {} : { takenBy: holder }),
    };
  }
  if (request.title === undefined) return { ...around, slug: "" };
  const wanted = slugBaseOf(request.title);
  const slug = field.unique
    ? ((await freeSlugs(source, field.name, wanted, reads))[0] ?? wanted)
    : wanted;
  return { ...around, slug, ...(slug === wanted ? {} : { wanted }) };
}

/**
 * What a new page in a collection would get, for the New page dialog: its
 * name, whether it is a draft, whether it has the header & footer choice,
 * whether the author may change it once made, the starters offered, and
 * the address it would take, every read as the caller. Never a promise that
 * the address is free: the create decides.
 */
export async function readNewPageFacts(
  request: NewPageRequest,
  reads: NewPageReads
): Promise<NewPageFacts> {
  const source = await pageSource(reads, request.collection);
  const all = await reads.pageCollections();
  const creatable = await Promise.all(
    all.map(async candidate =>
      (await reads.may("create", candidate.slug)) ? [candidate] : []
    )
  );
  return {
    collection: namedCollection(source),
    collections: creatable.flat().map(namedCollection),
    drafts: source.lifecycle,
    headerFooter: source.slug === reads.pagesCollection(),
    mayUpdate: await reads.may("update", source.slug),
    starters: await reads.starters(source),
    address: await newPageAddress(source, request, reads),
  };
}

/**
 * The site's address as a link can use it, from the site's public settings,
 * or null while it is unset or is no web address.
 */
async function siteAddress(): Promise<string | null> {
  const configured = (await readPublicSiteSettings()).siteUrl?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
      ...(source.slugField === undefined
        ? {}
        : { [source.slugField.name]: true }),
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
  const row = await writeWithSlug(
    source,
    copy,
    writes,
    slug =>
      writes.duplicate(source.slug, page.id, {
        ...(titleName === undefined ? {} : { [titleName]: copy }),
        ...slug,
        ...draftOf(source),
      }),
    parentOf(read.items[0], source.slugField?.name)
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
    may: async (action, collection) =>
      (await ctx.caller?.can(action, collection)) === true,
    // No starter pages are offered yet: one asked for by id is refused.
    starter: () => Promise.resolve(undefined),
  };
}

/** The New page read's reads: the writes', the search's collections, and the site's address. */
function directNewPageReads(
  ctx: PluginRouteContext,
  store: ComponentStore,
  pagePath: string | undefined
): NewPageReads {
  const search = directPagesSearchReads(ctx, store, pagePath);
  return {
    ...directPagesWrites(ctx, store),
    pageCollections: async () =>
      pageCollections(await search.collections(), search.stores()),
    pagesCollection: () => search.pagesCollection(),
    pagePath: () => pagePath,
    site: siteAddress,
    starters: () => Promise.resolve([]),
  };
}

/** One of the routes, as the plugin declares it. */
interface PagesWriteRoute {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  checksAccess?: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}

/**
 * The route declarations, thin on purpose: the New page read, then the four
 * writes. No `public`, which makes each
 * authenticated, and no `requiredPermission`: the permission is core's to
 * judge on the write itself, per collection.
 *
 * `store` is where component definitions live, so a store the host pointed the
 * plugin at is never written as a page, as the search never lists it.
 */
export function pagesWriteRoutes(
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  /** Where the plugin's own pages are served (`pagePreviewPath`), if stated. */
  pagePath?: string
): PagesWriteRoute[] {
  const writesFor = (ctx: PluginRouteContext) => directPagesWrites(ctx, store);
  return [
    {
      method: "GET",
      path: NEW_PAGE_ROUTE_PATH,
      checksAccess: true, // The handler judges each caller.
      handler: async (req, ctx) =>
        Response.json(
          await readNewPageFacts(
            parseNewPageQuery(req.url),
            directNewPageReads(ctx, store, pagePath)
          )
        ),
    },
    {
      method: "POST",
      path: PAGES_ROUTE_PATH,
      checksAccess: true, // The handler judges each caller.
      handler: async (req, ctx) =>
        respondMutation<CreatedPageItem>(
          "The page was created.",
          await createPage(await readCreateBody(req), writesFor(ctx))
        ),
    },
    {
      method: "POST",
      path: PAGE_DUPLICATE_ROUTE_PATH,
      checksAccess: true, // The handler judges each caller.
      handler: async (_req, ctx) =>
        respondMutation<PageItem>(
          "The page was duplicated.",
          await duplicatePage(parsePageParams(ctx.params), writesFor(ctx))
        ),
    },
    {
      method: "PATCH",
      path: PAGE_ROUTE_PATH,
      checksAccess: true, // The handler judges each caller.
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
      checksAccess: true, // The handler judges each caller.
      handler: async (_req, ctx) =>
        respondMutation<PageReference>(
          "The page was deleted.",
          await deletePage(parsePageParams(ctx.params), writesFor(ctx))
        ),
    },
  ];
}
