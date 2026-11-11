/**
 * What the redirects screen and the routes behind it agree on: where the
 * screen is, the routes it reads and writes, and the shapes they answer
 * with. It imports nothing, so the admin's client bundle reads it without
 * bringing any server code along.
 *
 * @module redirects/contract
 */

/** The redirects screen: its path under the plugin, and its component. */
export const REDIRECTS_PAGE: {
  readonly path: "redirects";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoRedirectsPage";
} = {
  path: "redirects",
  component: "@nextlyhq/plugin-seo/admin#SeoRedirectsPage",
};

/** The routes the screen reads and writes, under the plugin's routes. */
export const REDIRECT_ROUTES: {
  readonly list: "/redirects";
  readonly notFound: "/not-found";
  readonly import: "/redirects/import";
} = {
  list: "/redirects",
  notFound: "/not-found",
  import: "/redirects/import",
};

/** Whether a redirect is for good or for now. */
export type RedirectType = "permanent" | "temporary";

/** A redirect as the screen shows it, with addresses as visitors open them. */
export interface RedirectView {
  id: string;
  from: string;
  to: string;
  type: RedirectType;
  /** `automatic` for a page's own move, `person` from the screen, `import` from a file. */
  origin: "automatic" | "person" | "import";
  addedBy: string | null;
  addedAt: string | null;
  editedAt: string | null;
}

/** An address not found as the screen shows it. */
export interface NotFoundView {
  id: string;
  path: string;
  hits: number;
  lastSeen: string;
  /** `moved` for an old address a deploy moved whose redirect could not be saved. */
  kind: "missing" | "moved";
  /** The closest live page, offered as the To address. */
  suggestion: string | null;
}

/** What a row of an imported file would do. */
export type ImportRowKind = "new" | "joined" | "replaced" | "same" | "refused";

/** One row of an imported file, as its dry run found it. */
export interface ImportRowView {
  /** The row's line in the file, from 1. */
  line: number;
  from: string;
  to: string;
  kind: ImportRowKind;
  /** What happens, as the screen says it. */
  says: string;
  /** Why a refused row cannot be imported: a loop, or anything else. */
  refusal?: "loop" | "other";
}

/** What reading a file found, and, once imported, how many were saved. */
export interface ImportResult {
  rows: ImportRowView[];
  /** Whether the file was applied: never while any row is refused. */
  applied: boolean;
}
