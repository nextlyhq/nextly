/**
 * What an undo of a breakpoint removal answers: the removal it undoes and,
 * once its walk is finished, every document it could not put each value
 * back into, the shared styles included, so the person sees what stayed out
 * and why.
 *
 * Both the undo's own route and the route carrying its walk on answer it, so
 * an undo finished by either says the same.
 *
 * @module breakpoint-removal/undo-report
 * @experimental
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";

import type {
  SiteBreakpointUndo,
  SiteBreakpointUndoSkipped,
} from "../library-contract";
import { readStoredJson } from "../stored-json";

import { restoreClasses } from "./restore";
import { removedEver, type BreakpointRun } from "./run-store";
import type { BreakpointRemovalService } from "./service";

/** What the report reads of the site's shared styles. */
export interface SharedStylesNow {
  /** The Single the shared styles are stored in, as registered. */
  readonly slug: string;
  /** The stored class tier as it is now. */
  readonly stored: unknown;
  /** The code's classes, which a removal may have stored overrides of. */
  readonly supplied: readonly NamedClass[];
}

/**
 * The shared styles' values the undo could not put back, read again now
 * with the same restore it wrote (`restoreClasses`): a value back in place
 * counts for nothing; one set again since is `changed`, and one whose style
 * is deleted since `block-deleted`.
 */
async function sharedStylesSkipped(
  service: BreakpointRemovalService,
  undone: BreakpointRun,
  styles: SharedStylesNow
): Promise<SiteBreakpointUndoSkipped[]> {
  const kept = await service.keptSharedStyles(undone.id);
  if (kept?.form !== "site") return [];
  const tier = readStoredJson(styles.stored);
  const { skipped, deleted } = restoreClasses(
    Array.isArray(tier) ? tier : [],
    styles.supplied,
    kept.fragment,
    removedEver(undone)
  );
  const of = (
    values: number,
    reason: SiteBreakpointUndoSkipped["reason"]
  ): SiteBreakpointUndoSkipped[] =>
    values === 0 ? [] : [{ kind: "single", slug: styles.slug, values, reason }];
  return [...of(skipped, "changed"), ...of(deleted, "block-deleted")];
}

/**
 * What undo run `undo` answers: what it undoes, and once `finished`, what it
 * could not put back. `undefined` for a run that undoes nothing (a removal).
 */
export async function undoReport(
  service: BreakpointRemovalService,
  undo: BreakpointRun,
  finished: boolean,
  styles: () => Promise<SharedStylesNow>
): Promise<SiteBreakpointUndo | undefined> {
  if (undo.undoes === null) return undefined;
  if (!finished) return { undoes: undo.undoes };
  const undone = await service.runById(undo.undoes);
  const shared =
    undone === null
      ? []
      : await sharedStylesSkipped(service, undone, await styles());
  return {
    undoes: undo.undoes,
    skipped: [...shared, ...(await service.undoSkipped(undo.id))],
  };
}

/**
 * What an undo, or carrying one on, tells the person: the breakpoints are
 * back, and once its walk is finished, how many values stayed out because
 * they changed since the removal.
 */
export function undoMessage(undo: SiteBreakpointUndo): {
  readonly finished: string;
  readonly going: string;
} {
  const values = (undo.skipped ?? []).reduce(
    (sum, skipped) => sum + skipped.values,
    0
  );
  return {
    finished:
      values === 0
        ? "The removal was undone: its breakpoints and their styles are back."
        : `The removal was undone: its breakpoints are back with their styles, except ${values} ${values === 1 ? "value" : "values"} changed since the removal.`,
    going:
      "The removal was undone: its breakpoints are back. Their styles are still being put back.",
  };
}
