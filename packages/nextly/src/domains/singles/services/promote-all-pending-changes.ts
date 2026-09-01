/**
 * Applying every language's pending change, then consuming it.
 *
 * ## Why this is shared rather than written where it is needed
 *
 * Two paths put a Single's whole document live — the `publish-all` route and a
 * wildcard-locale write — and both owe the same debt: a pending change is
 * content an author has already written and is waiting to release, so a publish
 * that moves the statuses without folding the pending changes in marks every
 * language live while serving the values each author was holding. The document
 * then reports itself fully published and shows none of the work being
 * published.
 *
 * The second path was built without it and did exactly that: the sweep marked
 * every companion published while only the write locale's pending change had
 * been promoted. Writing the loop again there would have been a second answer
 * to one question, and the first one a divergence appeared in would be the one
 * nobody was watching.
 *
 * @module domains/singles/services/promote-all-pending-changes
 */

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { CompanionSchema } from "../../i18n/runtime/companion-io";
import { VersionsRepository } from "../../versions/versions-repository";

import {
  splitPendingChange,
  writeCompanionValues,
} from "./apply-pending-change";

/** The document whose pending changes are being released, and where they live. */
export interface PromoteAllPendingChangesArgs {
  tx: TransactionContext;
  dialect: SupportedDialect;
  /** The Single's slug, which is also its version scope. */
  slug: string;
  /** The main table the untranslated values belong to. */
  tableName: string;
  entryId: string;
  /** The companion schema, or `null` when the Single stores no translations. */
  companion: CompanionSchema | null;
  /** `versions.drafts.enabled` — no split, nothing to promote. */
  draftsEnabled: boolean;
  /** The stamp the promoted values are written with. */
  now: Date;
}

/**
 * Fold every language's pending change into the live document and delete it.
 *
 * No-op when the split is off or nothing is pending, so a caller may run it
 * unconditionally on the publish path.
 */
export async function promoteAllPendingChanges(
  args: PromoteAllPendingChangesArgs
): Promise<void> {
  const { tx, slug, tableName, entryId, companion, now } = args;
  if (!args.draftsEnabled) return;

  const repo = new VersionsRepository(tx);
  const ref = {
    scopeKind: "single" as const,
    scopeSlug: slug,
    entryId,
  };
  const pending = await repo.findAllWorkingDrafts(ref);
  if (pending.length === 0) return;

  // The SHARED half is written once, from the most recently updated draft.
  //
  // Every language's snapshot carries a full copy of the Single's untranslated
  // fields, and `findAllWorkingDrafts` declares no order — so writing `main` once
  // per draft lets an older language's copy land last and overwrite a newer
  // edit, with which one wins decided by row order. The committed shared content
  // would differ between two runs over identical data.
  //
  // Last edit wins, which is the rule the rest of the write path already
  // applies: a later save supersedes an earlier one. Ties are broken by locale
  // so the outcome is total rather than merely usually-stable.
  const byRecency = [...pending].sort((a, b) => {
    const delta = a.updatedAt.getTime() - b.updatedAt.getTime();
    return delta !== 0 ? delta : (a.locale ?? "").localeCompare(b.locale ?? "");
  });

  const latest = byRecency[byRecency.length - 1];
  const { main: sharedMain } = splitPendingChange(latest.snapshot, companion);
  // The pending change carries no lifecycle of its own; the statuses the
  // caller's publish writes are the ones that count.
  delete sharedMain.status;
  if (Object.keys(sharedMain).length > 0) {
    await tx.update(
      tableName,
      { ...sharedMain, updated_at: now },
      { and: [{ column: "id", op: "=", value: entryId }] }
    );
  }

  // The TRANSLATED half is per language and cannot collide: each row belongs to
  // one locale, so every draft's companion values are applied.
  for (const draft of byRecency) {
    const { companion: companionValues } = splitPendingChange(
      draft.snapshot,
      companion
    );
    if (companion && draft.locale && Object.keys(companionValues).length > 0) {
      await writeCompanionValues({
        tx,
        dialect: args.dialect,
        companionTableName: companion.companionTableName,
        entryId,
        locale: draft.locale,
        values: companionValues,
      });
    }
  }

  await repo.deleteAllWorkingDrafts(ref);
}
