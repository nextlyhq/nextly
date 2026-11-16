/**
 * How widely the Shared styles tab's rows are used, and renaming a row: the
 * usage read for the rows on screen, the rename write with its pending names,
 * and the refusal shown where the author will see it.
 *
 * @module shared-styles-usage
 */

import type { NamedClass } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useSurvivingReport } from "./builder-notices";
import {
  renameSharedStyle,
  type SharedStyleReach,
  type SharedStyleRow,
  type SharedStylesUsage,
} from "./shared-style-library";
import type {
  SharedStylesAccess,
  SharedStylesPanelProps,
} from "./shared-styles-types";
import {
  useUsageReads,
  type CountNow,
  type UsageRead,
  type UsageSource,
} from "./usage-reads";

/** The words for a refusal that came with none. */
const UNEXPLAINED_REFUSAL = "This shared style could not be renamed.";

/**
 * The name a style is heading for while its rename is open, read as an own
 * entry: a style id is stored data, and `__proto__` must not read the
 * record's prototype.
 */
export function pendingName(
  pendingNames: Readonly<Record<string, string>>,
  id: string
): string | undefined {
  return Object.hasOwn(pendingNames, id) ? pendingNames[id] : undefined;
}

/** A refusal shown where the author will see it: in its popover or the panel. */
export interface Issue {
  readonly id: string;
  readonly reason: string;
}

/** Usage read for the rows on screen, kept as it arrives. */
export interface UsageState {
  readonly styles: ReadonlyMap<string, SharedStyleReach>;
  /**
   * Whether every style's usage was read while every page had been counted.
   * Undefined until a read has answered.
   */
  readonly whole: boolean | undefined;
  /** Whether floors among them may still become whole. */
  readonly counting: "yes" | "unknown" | "no";
  readonly mayLock: boolean;
  /** Whether this author may ask for the pages to be counted now. */
  readonly mayCount: boolean;
  readonly failed: boolean;
  /** Ask about these styles again, as after a removal the server refused. */
  readonly reread: (ids: readonly string[]) => void;
  /**
   * Counting the pages now, when this author may and the host can; its
   * answer reads the rows on screen again.
   */
  readonly counter: CountNow | undefined;
}

/** A shared-style usage read, in the shape the usage reads take. */
type SharedStylesRead = UsageRead<SharedStyleReach> & SharedStylesUsage;

/** The tab's access as a usage source: each read's styles are its values. */
function sharedStylesSource(
  access: SharedStylesAccess
): UsageSource<SharedStyleReach, SharedStylesRead> {
  return {
    usage: async (ids, signal) => {
      const read = await access.usage(ids, signal);
      return { ...read, values: read.styles };
    },
    ...(access.count === undefined ? {} : { count: access.count }),
  };
}

/**
 * How widely the rows on screen are used, through the usage reads every
 * Design tab shares, with whether this author may lock from the latest read.
 */
export function useUsage(
  access: SharedStylesAccess | undefined,
  ids: readonly string[]
): UsageState {
  const source = React.useMemo(
    () => (access === undefined ? undefined : sharedStylesSource(access)),
    [access]
  );
  const reads = useUsageReads(source, ids);
  return {
    styles: reads.values,
    whole: reads.whole,
    counting: reads.counting,
    // Absent until a read answers: no lock is offered before one.
    mayLock: reads.latest?.mayLock ?? false,
    mayCount: reads.mayCount,
    failed: reads.failed,
    reread: reads.reread,
    counter: reads.counter,
  };
}

/**
 * The rename a row's Name field commits: checked here, written by the host,
 * and a refusal shown where the author is, or raised as a notice once this
 * panel is gone.
 */
export function useRename({
  library,
  onRename,
  currentRenameAttempt,
  pendingNames,
  setIssue,
}: {
  library: readonly NamedClass[] | undefined;
  onRename: SharedStylesPanelProps["onRename"];
  currentRenameAttempt: SharedStylesPanelProps["currentRenameAttempt"];
  pendingNames: Readonly<Record<string, string>>;
  setIssue: (issue: Issue | null) => void;
}): (row: SharedStyleRow, value: string) => void {
  const survive = useSurvivingReport();
  return (row, value) => {
    if (onRename === undefined || library === undefined) return;
    // Compared with the name the style is heading for, so typing back the
    // old name while a rename is open is a rename of its own.
    if (value.trim() === (pendingName(pendingNames, row.id) ?? row.name)) {
      setIssue(null);
      return;
    }
    const report = (reason: string): void =>
      survive(reason, () => {
        setIssue({ id: row.id, reason });
        return true;
      });
    const verdict = renameSharedStyle(value, row.id, library);
    if (!verdict.ok) {
      report(verdict.reason);
      return;
    }
    setIssue(null);
    const answer = onRename(row.id, {
      label: verdict.label,
      slug: verdict.slug,
    });
    const mine = currentRenameAttempt?.(row.id);
    const current = (): boolean =>
      mine === undefined || currentRenameAttempt?.(row.id) === mine;
    answer.then(
      outcome => {
        if (!current() || outcome.ok) return;
        report(
          outcome.reason.trim() === "" ? UNEXPLAINED_REFUSAL : outcome.reason
        );
      },
      () => {
        if (current()) report(UNEXPLAINED_REFUSAL);
      }
    );
  };
}
