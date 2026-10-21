/**
 * "This entry's draft holds changes not yet published", as a condition on an
 * entry read.
 *
 * Built from {@link WORKING_DRAFT_SHAPE}, the versions domain's one statement of
 * what a pending edit IS, so this condition, the document's own pending-edit
 * read and the dashboard's count of pending edits cannot answer the question
 * three different ways. A spelling of the shape written out again here would
 * agree on the day it was written and drift the first time the shape changed.
 *
 * @module domains/versions/pending-change-condition
 * @experimental Read by the `_pendingChange` list filter, which may change until
 *   the dashboard's Needs attention card is complete.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  Column,
  eq,
  is,
  isNull,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";
import { versionsTables } from "../../schemas/versions";

import type { VersionsWhereCondition } from "./db-api";
import { WORKING_DRAFT_SHAPE } from "./versions-repository";

type VersionsTable = ReturnType<typeof versionsTables>["nextlyVersions"];

/**
 * One condition of the working-draft shape, on the versions table.
 *
 * Only the operators the shape uses are translated. Any other one is refused
 * as an internal fault rather than skipped: a skipped condition would widen
 * "pending edit" to rows that are not one, and the list would show documents
 * with nothing waiting.
 */
function shapeCondition(
  versions: VersionsTable,
  condition: VersionsWhereCondition
): SQL {
  const column: unknown = Object.prototype.hasOwnProperty.call(
    versions,
    condition.column
  )
    ? (versions as unknown as Record<string, unknown>)[condition.column]
    : undefined;
  if (is(column, Column)) {
    if (condition.op === "IS NULL") return isNull(column);
    if (condition.op === "=") return eq(column, condition.value);
  }
  throw NextlyError.internal({
    logContext: {
      reason: "working-draft-shape-untranslatable",
      column: condition.column,
      op: condition.op,
    },
  });
}

/**
 * The condition keeping entries of one collection whose draft holds changes not
 * yet published, in any language.
 *
 * Any language, because the condition keeps ENTRIES: an entry with a pending
 * change in one language has something waiting, and is kept once. Narrowing to
 * one language is the language filter's question (`_translated`), which this
 * one combines with.
 *
 * `entryId` is the read's own id column, so the condition is correlated with
 * the row being judged and the versions index on
 * `(scope_kind, scope_slug, entry_id, …)` serves each probe.
 *
 * @experimental
 */
export function pendingChangeCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  entryId: SQLWrapper;
}): SQL {
  const versions = versionsTables(args.dialect).nextlyVersions;
  return sql`EXISTS (SELECT 1 FROM ${versions} WHERE ${and(
    eq(versions.scopeKind, "collection"),
    eq(versions.scopeSlug, args.collectionName),
    eq(versions.entryId, args.entryId),
    ...WORKING_DRAFT_SHAPE.map(condition => shapeCondition(versions, condition))
  )})`;
}
