/**
 * What the Pages panel's writes take and answer, named where both ends can
 * read them: create a page, duplicate one, rename one, delete one.
 *
 * A page is an entry of a collection the pages search lists (see
 * `pages-search-contract`), and every answer names it the way a search result
 * does, so the panel can put a written page in its list without reading again.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `pages-search-contract.ts` gives: the
 * routes reach the Direct API through `nextly/runtime`, which is server-only.
 * The one import is another contract module, and only its types.
 *
 * @module pages-write-contract
 */
import type { PageItem, PageReference } from "./pages-search-contract";

/** Where a page is created, under this plugin's namespace. */
export const PAGES_ROUTE_PATH = "/pages";

/** One page, renamed with PATCH and deleted with DELETE. */
export const PAGE_ROUTE_PATH = "/pages/:collection/:id";

/** Where a page is duplicated. */
export const PAGE_DUPLICATE_ROUTE_PATH = "/pages/:collection/:id/duplicate";

/**
 * The longest title a page may be given, in characters after trimming.
 * Refused rather than cut above it, because a cut title is not the one typed.
 */
export const PAGE_TITLE_MAX = 200;

/**
 * What creates a page: the collection it goes in and its title, and what the
 * New page dialog adds. A caller sending only the collection and the title
 * gets a page made from the title alone.
 */
export interface CreatePageRequest {
  readonly collection: string;
  readonly title: string;
  /**
   * @experimental The address the author typed. Stored as typed, after
   * {@link pageSlugOfTyped}; refused, never moved on, when another page
   * holds it. Absent, the address is made from the title and the first free
   * one is used.
   */
  readonly slug?: string;
  /**
   * @experimental The page's header & footer set by id, or null for the
   * site default. Sent with {@link noHeaderFooter} as the Header & footer
   * menu writes them.
   */
  readonly layout?: string | null;
  /** @experimental True for a page drawn with no header or footer. */
  readonly noHeaderFooter?: boolean;
  /**
   * @experimental The starter page the new page starts from, by the id the
   * New page read offered it under. Absent, the page starts blank.
   */
  readonly starter?: string;
  /**
   * @experimental Values for the collection's other top-level fields, by
   * name: the required fields a create was refused for, filled in.
   */
  readonly fields?: Readonly<Record<string, unknown>>;
}

/**
 * @experimental A created page, and whether its author may also change it:
 * one who may not is sent to the page's form, not the builder.
 */
export type CreatedPageItem = PageItem & { readonly mayUpdate: boolean };

/** @experimental Where the New page dialog reads what a new page would get. */
export const NEW_PAGE_ROUTE_PATH = "/pages/new";

/** @experimental The New page read's query parameters. */
export const NEW_PAGE_PARAMS = {
  collection: "collection",
  title: "title",
  slug: "slug",
} as const;

/** @experimental A starter page the dialog offers beside Blank. */
export interface NewPageStarter {
  readonly id: string;
  readonly label: string;
  /** A picture of the starter page, as an address an image can load. */
  readonly picture?: string;
}

/** @experimental A collection a new page can be made in. */
export interface NewPageCollection {
  readonly slug: string;
  /** Its singular name, as the dialog's title and Type say it. */
  readonly label: string;
}

/**
 * @experimental Where a new page would be served, and the address it would
 * be stored under.
 */
export interface NewPageAddress {
  /** The site's address (`https://example.com/`), or null while it is unset. */
  readonly site: string | null;
  /**
   * The path either side of the page's own part (`/` and nothing for a page
   * served at `/<address>`); both empty where the collection's pages have no
   * known path, so the address is shown alone.
   */
  readonly before: string;
  readonly after: string;
  /** The address the page would be stored under, or "" for no title yet. */
  readonly slug: string;
  /**
   * The address made from the title, where another page holds it and the
   * page would take {@link slug} instead.
   */
  readonly wanted?: string;
  /**
   * Where a typed address is held by a page the author may read: its title.
   * The create is refused. An address held by a page they can't read is
   * refused only at create.
   */
  readonly takenBy?: string;
}

/**
 * @experimental What a new page in a collection would get: what the dialog
 * shows before anything is created. Never a promise that an address is
 * free: a page made meanwhile, or one the author can't read, can still hold
 * it, and the create says so.
 */
export interface NewPageFacts {
  readonly collection: NewPageCollection;
  /** Every collection the author may make a page in, for "Type". */
  readonly collections: readonly NewPageCollection[];
  /** Whether a new page is a draft (the collection has the lifecycle). */
  readonly drafts: boolean;
  /** Whether a page here has a header & footer choice. */
  readonly headerFooter: boolean;
  /** Whether the author may change a page once made, so open it in the builder. */
  readonly mayUpdate: boolean;
  /** The starter pages offered beside Blank; empty while there are none. */
  readonly starters: readonly NewPageStarter[];
  /** Null where the collection's pages have no address of their own. */
  readonly address: NewPageAddress | null;
}

/** @experimental The New page read's path for a collection, a title and a typed address. */
export function newPagePath(ask: {
  readonly collection: string;
  readonly title?: string;
  readonly slug?: string;
}): string {
  const query = new URLSearchParams({
    [NEW_PAGE_PARAMS.collection]: ask.collection,
  });
  if (ask.title !== undefined && ask.title !== "") {
    query.set(NEW_PAGE_PARAMS.title, ask.title);
  }
  if (ask.slug !== undefined) query.set(NEW_PAGE_PARAMS.slug, ask.slug);
  return `${NEW_PAGE_ROUTE_PATH}?${query.toString()}`;
}

/** The longest address made from a title, before any `-2` suffix. */
export const PAGE_SLUG_BASE_MAX = 80;

/** The longest address a page may be stored at (`db.slugPaths`). */
export const PAGE_SLUG_MAX = 255;

/** The address a title that holds no letter or digit is given. */
export const UNTITLED_PAGE_SLUG = "page";

/**
 * Words as an address part: core's `slugify` rule (lower case, accents
 * dropped, every run of other characters one hyphen, none at either end),
 * repeated here because this module may import nothing at run time. A test
 * holds the two to the same answers.
 */
function addressPart(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * The address a title makes, as the route makes it: the part the title
 * gives, cut so a `-2` still fits, or a neutral word for a title with no
 * letter or digit. The dialog shows it while the title is typed; the route
 * decides whether it is free.
 */
export function pageSlugOfTitle(title: string): string {
  const base = addressPart(title)
    .slice(0, PAGE_SLUG_BASE_MAX)
    .replace(/-+$/, "");
  return base === "" ? UNTITLED_PAGE_SLUG : base;
}

/**
 * A typed address as it is stored: each `/`-separated part made an address
 * part, empty parts dropped, so `Docs / Install` is `docs/install`, a page
 * beneath another. "" where nothing usable was typed.
 */
export function pageSlugOfTyped(typed: string): string {
  return typed
    .split("/")
    .map(addressPart)
    .filter(part => part !== "")
    .join("/")
    .slice(0, PAGE_SLUG_MAX)
    .replace(/[-/]+$/, "");
}

/**
 * What renames a page: its new title, and nothing else, with the version of
 * the page the author renamed (the `rev` the search gave it), so a save of
 * the page since refuses the rename rather than being lost under it.
 */
export interface RenamePageRequest {
  readonly title: string;
  readonly rev?: string;
}

/**
 * A page write's answer: the canonical mutation envelope. Create, duplicate
 * and rename answer the page as the search lists it; delete answers only which
 * page it was, since there is nothing left to describe.
 */
export interface PageMutationResponse<TItem extends PageItem | PageReference> {
  readonly message: string;
  readonly item: TItem;
}

/** `path` with one page's collection and id written in. */
function pageAddress(path: string, page: PageReference): string {
  return path
    .replace(":collection", encodeURIComponent(page.collection))
    .replace(":id", encodeURIComponent(page.id));
}

/** The path that renames or deletes `page`. */
export function pagePath(page: PageReference): string {
  return pageAddress(PAGE_ROUTE_PATH, page);
}

/** The path that duplicates `page`. */
export function pageDuplicatePath(page: PageReference): string {
  return pageAddress(PAGE_DUPLICATE_ROUTE_PATH, page);
}
