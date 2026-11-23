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
  inArray,
  is,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";
import { versionsTables } from "../../schemas/versions";

import type { VersionsWhereCondition } from "./db-api";
import { draftSlotParts, SHARED_DRAFT_SLOT } from "./part-drafts";
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
 * yet published, in any of the languages `locales` names.
 *
 * Any of them, because the condition keeps ENTRIES: an entry with a pending
 * change in one language has something waiting, and is kept once. Narrowing to
 * one language is the language filter's question (`_translated`), which this
 * one combines with.
 *
 * `locales` is the languages the read's access rules were judged for. A draft
 * in another language is withheld from that read, so its existence must not
 * keep the entry either: an English read of a collection whose rule refuses
 * French would otherwise show which entries hold French drafts. A row with no
 * language is an unlocalized document's and is always considered. `null`
 * considers every language, for a trusted read or a site with no languages.
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
  locales: readonly string[] | null;
}): SQL {
  const versions = versionsTables(args.dialect).nextlyVersions;
  return sql`EXISTS (SELECT 1 FROM ${versions} WHERE ${and(
    eq(versions.scopeKind, "collection"),
    eq(versions.scopeSlug, args.collectionName),
    eq(versions.entryId, args.entryId),
    ...WORKING_DRAFT_SHAPE.map(condition =>
      shapeCondition(versions, condition)
    ),
    args.locales === null
      ? undefined
      : args.locales.length === 0
        ? isNull(versions.locale)
        : or(
            isNull(versions.locale),
            inArray(versions.locale, [...args.locales])
          )
  )})`;
}

/**
 * The condition that one part of an entry of one collection holds changes not
 * yet published, as `pendingPartsOf` reads a document's working drafts: a
 * language, where it has a working draft of its own; the shared part (`null`),
 * where the shared draft holds changes, or, where drafts are not kept by part,
 * any language's draft, which holds the whole document (`draftSlotParts`).
 *
 * @experimental
 */
export function pendingPartCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  entryId: SQLWrapper;
  part: string | null;
}): SQL {
  const versions = versionsTables(args.dialect).nextlyVersions;
  // The shared part's own slot is SHARED_DRAFT_SLOT (no language); a language's draft holds the
  // shared part too unless drafts are kept by part, as `draftSlotParts` says of each slot.
  const slot =
    args.part !== null
      ? eq(versions.locale, args.part)
      : draftSlotParts("").shared
        ? undefined
        : SHARED_DRAFT_SLOT === null
          ? isNull(versions.locale)
          : eq(versions.locale, SHARED_DRAFT_SLOT);
  return sql`EXISTS (SELECT 1 FROM ${versions} WHERE ${and(
    eq(versions.scopeKind, "collection"),
    eq(versions.scopeSlug, args.collectionName),
    eq(versions.entryId, args.entryId),
    ...WORKING_DRAFT_SHAPE.map(condition =>
      shapeCondition(versions, condition)
    ),
    slot
  )})`;
}
