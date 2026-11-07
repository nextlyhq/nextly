/**
 * The "Bindings to fix" route's address and answer, apart from the route, so
 * the admin reads them without loading the server code that answers.
 *
 * @module bindings-report/contract
 */
import type { BindingReportRow } from "./rows";

/** Where the route is mounted under the plugin. */
export const BINDINGS_TO_FIX_ROUTE_PATH = "/bindings-to-fix";

/**
 * Where the "Bindings to fix" page is, relative to the admin: the plugin's
 * admin page at the same path. One spelling, which the dashboard's attention
 * line links as given and the menu, the card and the editor link from the
 * admin's root.
 */
export const BINDINGS_TO_FIX_ADMIN_PATH: string = `plugins/nextlyhq-plugin-page-builder${BINDINGS_TO_FIX_ROUTE_PATH}`;

/** The page's address from the admin's root. */
export const BINDINGS_TO_FIX_PAGE_HREF: string = `/admin/${BINDINGS_TO_FIX_ADMIN_PATH}`;

/** How many documents one page of the answer lists. */
export const BINDINGS_TO_FIX_PAGE_SIZE = 100;

/** One broken binding in the answer, with the names an author knows. */
export interface BindingsToFixRow extends BindingReportRow {
  /** The block's name as the editor shows it; empty for the document's metadata. */
  readonly blockLabel: string;
  /** The prop's name as the inspector shows it. */
  readonly propLabel: string;
  /** The name the admin gives the Single it reads, when it reads a Single. */
  readonly sourceLabel?: string;
  /**
   * Where the binding is fixed when that is not this document: the component
   * a page's Layout region places, which is edited in its own builder.
   */
  readonly opens?: { readonly slug: string; readonly id: string };
  /**
   * Whether it is in a language other than the default, the one the Page
   * Builder edits, so no editor link reaches it.
   */
  readonly inAnotherLanguage?: true;
}

/** One document in the answer. */
export interface BindingsToFixItem {
  readonly documentKey: string;
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly documentId?: string;
  readonly place: string;
  /** The document as the caller knows it: an entry's title, a Single's slug. */
  readonly title: string;
  /**
   * The document's own collection, as the admin names it (for example
   * "Posts"), which its entry bindings read; a Single's slug for a Single.
   */
  readonly collectionLabel: string;
  readonly rows: readonly BindingsToFixRow[];
  readonly checkedAt: string;
}

/** What the answer's `meta` says besides the page. */
export interface BindingsToFixMeta {
  /** How many broken bindings each place holds, of the documents listed. */
  readonly byPlace: Readonly<Record<string, number>>;
  /** How many broken bindings the listed documents hold in all. */
  readonly bindings: number;
  /** When every document was last checked completely, if ever. */
  readonly checkedAt: string | null;
  /** Whether a check of every document is under way. */
  readonly checking: boolean;
}
