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
import type {
  DataLossConsent,
  Deletion,
} from "../../../domains/schema/migrate/data-loss-consent";
import {
  deletionSource,
  judgeRunDeletions,
  type Agreement,
  type DeletionSource,
} from "../../utils/data-loss-consent";

/** Where the core upgrade's deletions come from, in a run's listing. */
export const CORE_UPGRADE_SOURCE: DeletionSource = deletionSource(
  "Nextly's own tables (core upgrade)",
  "core upgrade"
);

/** `deletions`, each listed under the core upgrade's heading. */
export function coreUpgradeSources(
  deletions: readonly Deletion[]
): Map<Deletion, DeletionSource> {
  return new Map(
    deletions.map(deletion => [deletion, CORE_UPGRADE_SOURCE] as const)
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
