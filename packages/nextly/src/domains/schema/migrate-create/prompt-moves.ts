/**
 * The terminal question `migrate:create` asks of each field that may have moved into or out of a
 * group since the latest snapshot (`moveCandidates`). Code says only where each field is now, so a
 * field that left one place and a field of the same name and type that arrived in another may be
 * one field moved, or one deleted and another added; only the operator knows which.
 *
 * Accepted, the migration copies the field's values to its new place before the old one goes.
 * Declined, the old place is deleted and the new one starts empty, as before moves were carried.
 *
 * Without a terminal (CI, piped stdin, `--non-interactive`) every candidate is declined unless
 * `--accept-moves` accepts them all, as `--accept-renames` does for renames.
 *
 * @module domains/schema/migrate-create/prompt-moves
 */
import * as p from "@clack/prompts";

import { migrationCreateCancelled } from "../../../cli/errors/areas/migrate-create";
import { answered } from "../../../cli/utils/prompt-cancelled";

/** A field of one entity that may have moved, by its path of names before and after. */
export interface MoveCandidate {
  /** The entity's slug, as the question names it. */
  slug: string;
  from: readonly string[];
  to: readonly string[];
}

export interface MoveDecision {
  candidate: MoveCandidate;
  accepted: boolean;
}

/** A field's place as the question names it: its names joined by dots. */
export function placeOf(path: readonly string[]): string {
  return path.join(".");
}

/**
 * Asks about each candidate at a terminal, the suggested answer being yes: a move the operator
 * made is the likelier reading of a field of the same name and type leaving one place for another,
 * and declining loses its values. Without a terminal, `autoAccept` answers every one.
 */
export async function promptMoves(
  candidates: readonly MoveCandidate[],
  opts: { nonInteractive?: boolean; autoAccept?: boolean } = {}
): Promise<MoveDecision[]> {
  const decisions: MoveDecision[] = [];
  for (const candidate of candidates) {
    if (opts.nonInteractive === true) {
      decisions.push({ candidate, accepted: opts.autoAccept === true });
      continue;
    }
    const answer = await p.confirm({
      message: `Detected possible move in ${candidate.slug}: ${placeOf(candidate.from)} → ${placeOf(candidate.to)}. Apply as a move? Its values are copied to the new place (declining deletes it at the old place and adds it empty at the new one)`,
      initialValue: true,
    });
    // Ctrl+C mid-prompt is not a decline: the run ends as interrupted, as a rename question does.
    if (p.isCancel(answer)) p.cancel("Cancelled by user.");
    decisions.push({
      candidate,
      accepted: await answered(answer, migrationCreateCancelled()),
    });
  }
  return decisions;
}
