/**
 * How many widget queries one request may carry.
 *
 * Its own module, with NO imports, for the reason `plugins/plugin-slug.ts` is:
 * the admin has to know this number in order to split a dashboard into requests
 * the endpoint will accept, and it can only reach it through `nextly/config` --
 * which must not pull `api/widget-query.ts`, the auth middleware and the query
 * executor behind it into a `nextly.config.ts`.
 *
 * ONE number, because the endpoint REFUSES above it and the client PARTITIONS
 * below it. Two copies would agree on the day they were written; the day they
 * stopped, a dashboard would send a batch the server rejects and every widget
 * in it would go dark at once.
 *
 * @module domains/widgets/batch-limit
 */

/** No dashboard needs more than this many widgets in one round trip. */
export const MAX_QUERIES_PER_REQUEST = 30;
