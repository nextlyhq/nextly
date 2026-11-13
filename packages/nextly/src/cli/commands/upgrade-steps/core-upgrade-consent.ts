/**
 * The data-loss consent for what a core upgrade deletes, as `nextly migrate`
 * and `nextly upgrade --reconcile-core` both judge it.
 *
 * Asked twice, as a run's files are: before the command's lock, where a person
 * at a terminal is shown each deletion under the heading "Nextly's own tables
 * (core upgrade)" and asked once; and under the lock, against the core tables
 * as they stand then, accepting without asking only what was agreed before or
 * what the consent covers. Not a step of `nextly upgrade`: it is imported by
 * name, never listed in `UPGRADE_STEPS`.
 *
 * @module cli/commands/upgrade-steps/core-upgrade-consent
 */
import {
  deletionKey,
  type DataLossConsent,
  type Deletion,
} from "../../../domains/schema/migrate/data-loss-consent";
import {
  deletionSource,
  judgeRunDeletions,
  type Agreement,
  type DeletionSource,
} from "../../utils/data-loss-consent";

/** The heading the core upgrade's deletions are listed under. */
export const CORE_UPGRADE_LABEL = "Nextly's own tables (core upgrade)";

/**
 * Where one core deletion comes from, in a run's listing: under the core
 * upgrade's heading, with an identity bound to the change itself (what it
 * deletes and why: a retired column, a type change from one type to another,
 * a column made required), never to its count. An agreement before the lock
 * then covers only that change: a different change to the same column, found
 * under the lock, is judged again rather than accepted.
 */
export function coreUpgradeSource(deletion: Deletion): DeletionSource {
  const change =
    deletion.kind === "unnamed"
      ? `${deletion.description}\u0000${deletion.fingerprint ?? ""}`
      : `${deletionKey(deletion)}\u0000${deletion.reason ?? ""}`;
  return deletionSource(CORE_UPGRADE_LABEL, change);
}

/** `deletions`, each listed under the core upgrade's heading. */
export function coreUpgradeSources(
  deletions: readonly Deletion[]
): Map<Deletion, DeletionSource> {
  return new Map(
    deletions.map(deletion => [deletion, coreUpgradeSource(deletion)] as const)
  );
}

/**
 * The core upgrade's deletions judged by `consent`: before the lock
 * (`agreed` absent), a person at a terminal is asked; under it (`agreed`
 * given), only what was agreed or what the consent covers is accepted. A
 * refusal, or a no, throws before anything changes. Returns what was agreed.
 */
export function judgeCoreDeletions(args: {
  deletions: readonly Deletion[];
  consent: DataLossConsent;
  agreed?: Agreement;
  interactive?: boolean;
  askToDelete?: (question: string) => Promise<boolean>;
  warn: (line: string) => void;
}): Promise<Agreement> {
  return judgeRunDeletions({
    sources: coreUpgradeSources(args.deletions),
    consent: args.consent,
    agreed: args.agreed,
    interactive: args.agreed === undefined ? args.interactive : false,
    askToDelete: args.askToDelete,
    warn: args.warn,
  });
}
