/**
 * What the list entries route takes and answers, named where both ends can
 * read it.
 *
 * The editor's canvas draws a collection list with the entries a VISITOR
 * would see, so the author designs the page that is published: the list's
 * own read, made by the renderer's `readList`, goes through this route to
 * the same public reader a published page reads with. A list whose source
 * is a named query asks for one run of it instead, made on the server,
 * where its run function lives.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives.
 *
 * @module list-entries-contract
 */
import type { PaginationMeta } from "nextly";

/** Where the canvas reads a list's entries, under this plugin's namespace. */
export const LIST_ENTRIES_ROUTE_PATH = "/list-entries";

/** The operators the public reader takes, as the renderer spells them. */
export const LIST_ENTRY_OPS = [
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "not_in",
  "exists",
] as const;

/** A literal a filter compares with. */
export type ListEntriesScalar = string | number | boolean;

/** One filter of a read, as the renderer sends it. */
export interface ListEntriesFilter {
  readonly field: string;
  readonly op: (typeof LIST_ENTRY_OPS)[number];
  readonly value: ListEntriesScalar | readonly ListEntriesScalar[];
}

/** What the canvas asks: one read of a list, as the renderer builds it. */
export interface ListEntriesRequest {
  readonly query: {
    readonly collection: string;
    readonly filters?: readonly ListEntriesFilter[];
    readonly sort?: string | readonly string[];
    readonly limit?: number;
    readonly offset?: number;
    readonly page?: number;
    readonly locale?: string;
    readonly select?: readonly string[];
  };
}

/** What the route answers: the canonical list envelope. */
export interface ListEntriesResponse {
  readonly items: readonly Record<string, unknown>[];
  readonly meta: PaginationMeta;
}

/** The most inputs a list stores, which a named run may be asked with. */
export const LIST_ENTRIES_NAMED_MAX_PARAMS = 12;

/**
 * What the canvas asks for a list whose source is a named query: one run of
 * it, with the inputs the list stores and the window it is drawn with, made
 * on the server as the published page would make it. `node` is the list's
 * id, for the log line a failed run is told under.
 */
export interface ListEntriesNamedRequest {
  readonly named: {
    readonly name: string;
    readonly params?: Readonly<Record<string, string | number | boolean>>;
    readonly limit: number;
    readonly offset: number;
    readonly locale?: string;
    readonly node?: string;
    /**
     * The reads the canvas's draw has left: the run may spend no more, so a
     * page of many lists shares one allowance across their runs.
     */
    readonly allowance?: number;
  };
}

/**
 * What a named run answers: the list envelope, its rows the query's own,
 * projected to what it declares. `meta.total` is the query's count of its
 * matching rows when `meta.named.counted` says it gave one, and the rows'
 * number otherwise; `meta.named.reads` is how many reads the run made, which
 * the canvas claims from its own allowance.
 *
 * A run that failed is still a run made, as a published page drawing its
 * empty state is a page served: it answers no rows, and `meta.named.failure`
 * is the failure as the server judged and logged it, so the canvas shows
 * the same words under the same log reference.
 */
export interface ListEntriesNamedResponse {
  readonly items: readonly Record<string, unknown>[];
  readonly meta: PaginationMeta & {
    readonly named: {
      readonly counted: boolean;
      readonly reads: number;
      readonly failure?: {
        readonly code: string;
        readonly detail: string;
        readonly ref: string;
      };
    };
  };
}
