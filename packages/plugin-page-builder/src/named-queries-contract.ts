/**
 * What the named queries route answers, named where both ends can read it.
 *
 * A collection list may take a named query a developer registered as its
 * source: a custom source. The editor offers them in the Source menu, draws
 * a control for each input, and lists the fields of its rows for binding,
 * so it needs every registered query's declaration, without its run
 * function, which never leaves the server. This module is what the route,
 * the composition manifest and the admin client agree on.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `loop-collections-contract.ts`
 * gives. Types are the exception, since they are erased before a browser
 * sees them.
 *
 * @module named-queries-contract
 */
import type {
  ListFieldKind,
  NamedQueryChoice,
  NamedQueryParamType,
} from "@nextlyhq/blocks-engine";
import type { PaginationMeta } from "@nextlyhq/plugin-sdk";

/** Where the editor lists the site's named queries, under this plugin's namespace. */
export const NAMED_QUERIES_ROUTE_PATH = "/named-queries";

/** The query the route takes: the language visitors' access is judged in. */
export const NAMED_QUERIES_PARAMS = { locale: "locale" } as const;

/**
 * One input of a named query, as its control is drawn: everything its
 * declaration says, by key.
 *
 * @experimental
 */
export interface NamedQueryInputItem {
  /** The key a list's `namedQuery.params` stores its value under. */
  readonly key: string;
  readonly type: NamedQueryParamType;
  readonly label: string;
  /** Required with no default: the list needs a value before it is written. */
  readonly needsInput: boolean;
  readonly required: boolean;
  readonly default?: string | number | boolean;
  readonly options?: readonly NamedQueryChoice[];
  /** An entry input's collection. */
  readonly collection?: string;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
}

/** One field of a query's rows, as the binding picker lists it. */
export interface NamedQueryRowField {
  readonly name: string;
  readonly type: string;
  /** What a list's filter would call it, when it holds one scalar. */
  readonly kind?: ListFieldKind;
  /**
   * A group's own fields, each listed the same way, so a binding can name
   * one by its path (`seo.title`).
   */
  readonly fields?: readonly NamedQueryRowField[];
}

/**
 * One registered named query, without its run function.
 *
 * @experimental
 */
export interface NamedQueryItem {
  /** What a list's `namedQuery.name` stores. */
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly inputs: readonly NamedQueryInputItem[];
  /** A collection's entries, or rows of a declared field schema with their key. */
  readonly rows:
    | { readonly collection: string }
    | { readonly key: string; readonly fields: readonly NamedQueryRowField[] };
  /** Whether it returns how many rows match before the window. */
  readonly total: boolean;
  /** Whether any input needs a value an author must give. */
  readonly needsInput: boolean;
  readonly reads: {
    readonly collections: readonly string[];
    readonly singles: readonly string[];
    readonly site: boolean;
  };
  /**
   * The declared collections visitors can read nothing of, by the name
   * authors read them by: a published list of the query may show nothing.
   */
  readonly readsHidden: readonly string[];
}

/** What the route answers: the canonical list envelope, every query on one page. */
export interface NamedQueriesResponse {
  readonly items: readonly NamedQueryItem[];
  readonly meta: PaginationMeta;
}
