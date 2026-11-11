/**
 * What the bulk edit screen and its routes agree on: where the screen is,
 * where it reads a content type's pages and saves their titles and
 * descriptions, and the shapes each route answers with. Plain data only,
 * importing nothing but the settings' contract, itself import-free, so the
 * admin's client bundle takes it without bringing server code along.
 *
 * @module bulk/contract
 */
/** Where the screen reads the content types it can edit. */
export const BULK_TYPES_PATH = "/bulk/types";

/** Where the screen reads one content type's pages. */
export const BULK_ROWS_PATH = "/bulk/rows";

/** Where the screen saves the titles and descriptions a person changed. */
export const BULK_SAVE_PATH = "/bulk/save";

/** How many pages one read of a content type answers. */
export const BULK_PAGE_SIZE = 100;

/** A content type the screen can edit. */
export interface BulkType {
  slug: string;
  /** Its name for many pages, such as "Blog posts". */
  label: string;
  /** Its name for one page, such as "Post". */
  singular: string;
  /** How many pages it has that the reader may read. */
  total: number;
  /** The pattern its automatic title is made from, where it has one. */
  titlePattern?: string;
  /**
   * Whether a change to a published page is kept as a draft until the page
   * is published again.
   */
  drafts: boolean;
}

/** What the types route answers. */
export interface BulkTypesBody {
  types: BulkType[];
}

/** One page of a content type, as the table shows it. */
export interface BulkRow {
  id: string;
  /** The page's own name. */
  label: string;
  /** Its public address, where its type declares one. */
  path?: string;
  /** The title a person typed, or empty. */
  title: string;
  /** The description a person typed, or empty. */
  description: string;
  /** What the title is without one typed. */
  autoTitle?: string;
  /** What the description is without one typed. */
  autoDescription?: string;
  /** The version the page was read at, sent back with a change to it. */
  rev?: string;
}

/** What the rows route answers. */
export interface BulkRowsBody {
  type: string;
  rows: BulkRow[];
  /** How many pages the type has. */
  total: number;
  /** Whether there are more pages after these. */
  more: boolean;
}

/** What the save route answers, beside its message. */
export interface BulkSaveBody {
  saved: number;
  /** Each saved page's new version, by id. */
  revs: Record<string, string>;
}

/** The most pages one save may change. */
export const BULK_SAVE_LIMIT = 500;
