import { LIFECYCLE_STATUSES } from "../../../lib/status-transition";

/**
 * How the publish lifecycle is written into the artifacts `generate:types`
 * emits.
 *
 * A collection or Single that declares `status: true` carries a
 * draft/published column, and its generated type said nothing about it — so a
 * consumer of the generated types could not tell a draft from a published
 * entry, which is the one distinction the whole lifecycle exists to express.
 *
 * **The set is not restated here.** `LIFECYCLE_STATUSES` is the source, and its
 * own docblock says why: it is stated once because callers that reject anything
 * else must not write the rejection from memory. Adding a value there widens
 * the generated type and the generated validator together; typing the union out
 * in either generator would make it a second answer that agrees only until
 * someone edits one of them.
 *
 * **Not `VersionStatus`, deliberately.** That union carries `"unpublished"` as
 * well, and it describes a row in the version HISTORY rather than an entry. No
 * entry is ever written with it — measured across `domains/collections`, with
 * the companion default on the same paths as the control proving the search
 * finds things. Offering it on an entry type would send consumers down a branch
 * that cannot occur.
 */

/** Whether this collection or Single carries a draft/published column. */
export function hasLifecycleStatus(record: { status?: boolean }): boolean {
  return record.status === true;
}

/**
 * The TypeScript member for the status column.
 *
 * Not optional and not nullable: the column is `NOT NULL DEFAULT 'draft'`, so a
 * read always has a value and offering `undefined` or `null` would describe a
 * state the database cannot produce.
 */
export function lifecycleStatusMember(): string {
  const union = LIFECYCLE_STATUSES.map(status => `"${status}"`).join(" | ");
  return `  status: ${union};`;
}

/** The Zod member for the same column, in that generator's dialect. */
export function lifecycleStatusZodMember(): string {
  const values = LIFECYCLE_STATUSES.map(status => `"${status}"`).join(", ");
  return `  status: z.enum([${values}]),`;
}
