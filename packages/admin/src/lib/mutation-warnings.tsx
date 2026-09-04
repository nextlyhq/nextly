/**
 * Reporting a write that succeeded while something after it did not.
 *
 * A post-commit hook (`afterCreate` / `afterUpdate` / `afterDelete`) runs once
 * the row is already durable, so a handler failing there cannot un-save it. The
 * server therefore answers success and carries the failure alongside as
 * `warnings`. Until now the admin dropped that array at the API client, so a
 * search index that was not updated, a webhook that was not delivered or a cache
 * that was not purged looked exactly like a clean save.
 *
 * One owner for the toast, so the three mutation hooks cannot drift into three
 * slightly different ways of saying the same thing.
 *
 * @module lib/mutation-warnings
 */

import { toast } from "@admin/components/ui";

/**
 * The public projection of a failed post-commit hook.
 *
 * Mirrors the server's `HookWarning`: the canonical code and the §13.8-safe
 * public message only. It never carries identifiers, so it is safe to render.
 */
export interface HookWarning {
  /**
   * Whether this reports something that went WRONG, or something the caller
   * should merely know.
   *
   * Read rather than assumed, and anything that is not explicitly a notice is
   * treated as a failure: a server that stops sending the field, or an older
   * one that never did, must not have its failures quietly downgraded to
   * advisories and rendered in reassuring language.
   */
  severity: "failure" | "notice";
  /** The lifecycle phase whose handler failed, or produced the advisory. */
  phase: string;
  /** The registry key the handler was registered against. */
  collection: string;
  /** The canonical error code, for a caller branching on the failure. */
  code: string;
  /** The public message. Never carries identifiers. */
  message: string;
  /** The row whose side effect failed, when the phase knows it. */
  entryId?: string;
}

/** A mutation response: the durable result, plus anything that failed after it. */
export interface MutationResult<T> {
  item: T;
  warnings?: HookWarning[];
}

/**
 * Say what happened to the write, and separately what happened after it.
 *
 * The write is reported as the success it is -- the row IS saved, and telling
 * the user otherwise would have them repeat an action that already took effect.
 * The follow-up failure rides on the same toast rather than a second one,
 * because two notifications for one action read as two outcomes.
 */
export function toastMutationResult(
  successMessage: string,
  warnings: readonly HookWarning[] | undefined
): void {
  const failures = (warnings ?? []).filter(
    warning => warning.severity !== "notice"
  );
  const notices = (warnings ?? []).filter(
    warning => warning.severity === "notice"
  );

  if (failures.length === 0 && notices.length === 0) {
    toast.success(successMessage);
    return;
  }

  // Long enough to open the detail, on both arms. A message the user cannot
  // finish reading is the same as no message, and this is the only place either
  // is reported: neither is on the row, and the write has already committed.
  const duration = 10_000;

  if (failures.length === 0) {
    // Nothing failed, so nothing is phrased as though it did. The write is
    // reported as the plain success it is, and the advisory rides beside it —
    // borrowing the failure headline here would have an author hunting for a
    // problem with a save that had none.
    toast.info(successMessage, {
      description: <WarningDetail warnings={notices} />,
      duration,
    });
    return;
  }

  // A failure outranks an advisory in the headline: it is the thing that did
  // not happen, and it is what the user has to decide about. The advisories
  // still travel in the detail rather than being dropped, because the write
  // produced both and showing one of them would misdescribe its outcome.
  toast.warning(
    `${successMessage.replace(/\.$/, "")}, but ${describeCount(failures.length)} failed`,
    {
      description: <WarningDetail warnings={[...failures, ...notices]} />,
      duration,
    }
  );
}

/** "1 follow-up action" / "3 follow-up actions". */
function describeCount(count: number): string {
  return `${count} follow-up action${count === 1 ? "" : "s"}`;
}

/**
 * The failures themselves, behind a disclosure.
 *
 * Collapsed by default: the headline is what most users act on, and the codes
 * below are for whoever is going to retry or report the thing. `<details>` gives
 * that for free with keyboard and screen-reader behaviour already correct,
 * which a custom expander would have to reimplement.
 *
 * A single failure is rendered inline instead, since a disclosure that hides one
 * line asks for a click and offers nothing for it.
 */
function WarningDetail({
  warnings,
}: {
  warnings: readonly HookWarning[];
}): React.ReactElement {
  if (warnings.length === 1 && warnings[0]) {
    return <span>{warnings[0].message}</span>;
  }

  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
        View details
      </summary>
      <ul className="mt-1 list-disc space-y-1 ps-4">
        {warnings.map((warning, index) => (
          <li key={`${warning.phase}-${warning.code}-${index}`}>
            {warning.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
