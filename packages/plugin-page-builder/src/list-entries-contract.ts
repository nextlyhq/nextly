/**
 * What the list entries route takes and answers, named where both ends can
 * read it.
 *
 * The editor's canvas draws a collection list with the entries a VISITOR
 * would see, so the author designs the page that is published: the list's
 * own read, made by the renderer's `readList`, goes through this route to
 * the same public reader a published page reads with.
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
