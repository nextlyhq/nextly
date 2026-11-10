/**
 * What a failed collection delete tells its caller.
 *
 * Kept apart from the delete so the one decision it makes, whether anything
 * may already be gone, is stated once and can be judged on its own.
 *
 * @module domains/collections/services/collection-delete-failure
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";

/**
 * The error a failed delete of `slugs` answers with.
 *
 * Where the transaction undid everything, a refusal raised inside it keeps
 * its own words, and anything else says nothing was removed. That is every
 * failure on PostgreSQL and SQLite, and a failure on MySQL that came before
 * the delete issued its first statement that can be DDL (`ddlStarted`): a
 * plugin's collection-delete handler that refused, say. Once MySQL has run
 * DDL it has committed everything before it, so the delete says what may
 * already be gone and how to finish it.
 */
export function collectionDeleteFailure(
  error: unknown,
  slugs: readonly string[],
  where: { dialect: SupportedDialect; ddlStarted: boolean }
): NextlyError {
  const partial = where.dialect === "mysql" && where.ddlStarted;
  if (!partial && NextlyError.is(error)) return error;
  const one = slugs.length === 1;
  const subject = one ? "this collection" : "these collections";
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage: partial
      ? `Deleting ${subject} failed part-way. MySQL keeps each table drop as it runs, so some of what ${one ? "it" : "they"} stored, such as field-group values and translations, may already be removed. ${one ? "Delete it again to finish." : "Delete those still listed again to finish."}`
      : `Deleting ${subject} failed, so nothing was removed.`,
    logMessage: `Collection delete failed: ${error instanceof Error ? error.message : String(error)}`,
    logContext: { collections: [...slugs], partial },
    cause: error instanceof Error ? error : undefined,
  });
}
