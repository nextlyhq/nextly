/**
 * "A scheduled release will publish this entry", as a condition on an entry
 * read.
 *
 * Kept here, beside the rest of what a release is, rather than in the
 * collections domain that reads it: which releases still have to run, and which
 * of their members they publish, are this domain's rules.
 *
 * @module domains/releases/in-release-condition
 * @experimental Read by the `_inRelease` list filter, which may change until the
 *   dashboard's Needs attention card is complete.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, gt, lte, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { releasesTables } from "../../schemas/releases";
import type {
  ReleaseMemberAction,
  ReleaseState,
} from "../../schemas/releases/types";

/**
 * The condition keeping entries of one collection that a scheduled release will
 * publish after `now`, and no later than `scheduledBefore` when one is given.
 *
 * - **Publishes only.** A member a release will UNPUBLISH is not work about to
 *   go live, so it is not kept.
 * - **Still to run.** A release whose time is at or before `now` is left out,
 *   whatever its state says: once it is overdue it is the overdue releases'
 *   business, and in the grace period before that it is still due to run and
 *   belongs to neither (`release-tabs`, `overdueCutoff`).
 * - **Any language.** A member names one language of a document, and the
 *   condition keeps ENTRIES, so an entry is kept once however many of its
 *   languages, and however many releases, hold it.
 *
 * `entryId` is the read's own id column, so each probe is correlated with the
 * row being judged and served by the members' document index.
 *
 * @experimental
 */
export function inReleaseCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  entryId: SQLWrapper;
  now: Date;
  scheduledBefore: Date | null;
}): SQL {
  const { nextlyReleases: releases, nextlyReleaseMembers: members } =
    releasesTables(args.dialect);
  return sql`EXISTS (SELECT 1 FROM ${members} INNER JOIN ${releases} ON ${eq(
    releases.id,
    members.releaseId
  )} WHERE ${and(
    eq(members.scopeKind, "collection"),
    eq(members.scopeSlug, args.collectionName),
    eq(members.entryId, args.entryId),
    eq(members.action, "publish" satisfies ReleaseMemberAction),
    eq(releases.state, "scheduled" satisfies ReleaseState),
    gt(releases.scheduledAt, args.now),
    args.scheduledBefore === null
      ? undefined
      : lte(releases.scheduledAt, args.scheduledBefore)
  )})`;
}
