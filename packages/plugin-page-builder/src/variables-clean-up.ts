/**
 * "Clean up unused…" on the server: removing many variables the site added
 * at once, each judged and removed on its own.
 *
 * Each variable goes through the remove route's own removal, alone: its
 * checks read just before its write (the usage index, counted first where it
 * is not whole, then the shared styles, the other variables and the stored
 * documents), and its own write, which reads the stored documents once more
 * under the composition graph lock. So one found in use, a page having
 * started using it since the author listed it, is kept and named with why,
 * and its refusal neither holds back nor rolls back the others: each of
 * their writes is its own transaction.
 *
 * What the panel listed is never trusted: a variable the site's code
 * supplies is refused as the remove route refuses it, and one already gone
 * is passed over.
 *
 * The answer says what each removal took out, as the server stored it, and
 * the section as the last removal wrote it: the editor's Undo puts back
 * exactly that, never an older copy it read before.
 *
 * @module variables-clean-up
 */
import { NextlyError, respondMutation } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  VARIABLE_USAGE_IDS_MAX,
  type VariableCleanUpAnswer,
  type VariableKept,
  type VariableTaken,
} from "./library-contract";
import { invalidRequest, jsonBody } from "./shared-styles-routes";

const CleanUpBody = z.strictObject({
  ids: z.array(z.string().min(1)).min(1).max(VARIABLE_USAGE_IDS_MAX),
});

/** How the clean-up reads names and removes one variable. */
export interface CleanUpEach {
  /** The name an author knows each stored variable by, by identity. */
  readonly names: () => Promise<ReadonlyMap<string, string>>;
  /**
   * Remove one variable, judged and written on its own, answering what it
   * took out and the section as its write left it; throws the refusal when
   * it may not go.
   */
  readonly remove: (id: string) => Promise<RemovedOne>;
  /** Told of a failure that is no refusal, for the site's log. */
  readonly failed?: (id: string, error: unknown) => void;
}

/** What one removal took out, and the section as its write left it. */
export interface RemovedOne {
  readonly taken: readonly VariableTaken[];
  readonly section: unknown;
}

/** Why a variable not reached, after a failure that is no refusal, stays. */
const UNFINISHED = "It could not be removed just now. Try again.";

/** What a single removal's refusal opens with, which a clean-up leaves out. */
const NOTHING_REMOVED = "Nothing was removed. ";

/**
 * A refusal in its own words: each issue's message where it carries any,
 * else its message, less the single removal's opening, since the clean-up
 * removed the others.
 */
function refusalWords(error: NextlyError): string {
  const data = error.publicData as
    | { readonly errors?: readonly { readonly message?: unknown }[] }
    | undefined;
  const issues = (data?.errors ?? []).flatMap(issue =>
    typeof issue.message === "string" ? [issue.message] : []
  );
  const words = issues.length > 0 ? issues.join(" ") : error.publicMessage;
  return words.startsWith(NOTHING_REMOVED)
    ? words.slice(NOTHING_REMOVED.length)
    : words;
}

/** "2 variables were removed. 1 was kept, as it is in use." */
function cleanUpMessage(answer: VariableCleanUpAnswer): string {
  const removed = answer.removed.length;
  const kept = answer.kept.length;
  const said =
    removed === 1
      ? "1 variable was removed."
      : `${removed} variables were removed.`;
  if (kept === 0) return said;
  return `${said} ${kept === 1 ? "1 was kept, as it is" : `${kept} were kept, as they are`} in use.`;
}

/**
 * Remove each variable named that nothing uses, one at a time, in the order
 * named. A refusal keeps that variable, with why; one already gone is in
 * neither list. Any other failure stops there: that variable and the rest
 * are kept, and the answer still says what went before it.
 */
export async function cleanUpVariables(
  req: Request,
  each: CleanUpEach
): Promise<Response> {
  const parsed = CleanUpBody.safeParse(await jsonBody(req));
  if (!parsed.success) {
    throw invalidRequest(
      `Name between 1 and ${VARIABLE_USAGE_IDS_MAX} variables to remove, by id.`
    );
  }
  const names = await each.names();
  const ids = [...new Set(parsed.data.ids)];
  const done = await removeInTurn(ids, each);
  const kept = [
    ...done.refused.map(({ id, reason }) => ({
      id,
      name: names.get(id) ?? id,
      reason,
    })),
    ...ids
      .slice(done.reached)
      .map(id => ({ id, name: names.get(id) ?? id, reason: UNFINISHED })),
  ] satisfies VariableKept[];
  const answer: VariableCleanUpAnswer = {
    removed: done.removed,
    kept,
    taken: done.taken,
    ...(done.section === undefined ? {} : { section: done.section.value }),
  };
  return respondMutation(cleanUpMessage(answer), answer);
}

/** What the removals made in turn came to. */
interface InTurn {
  readonly removed: string[];
  readonly refused: { readonly id: string; readonly reason: string }[];
  readonly taken: VariableTaken[];
  /** The section the last removal wrote, once one has. */
  section: { readonly value: unknown } | undefined;
  /** How many ids were judged before a failure that is no refusal. */
  reached: number;
}

/**
 * Each removal in turn, until one fails for a reason that is no refusal:
 * the ones before it stand, and it and those after are left unjudged.
 */
async function removeInTurn(
  ids: readonly string[],
  { remove, failed }: Pick<CleanUpEach, "remove" | "failed">
): Promise<InTurn> {
  const done: InTurn = {
    removed: [],
    refused: [],
    taken: [],
    section: undefined,
    reached: 0,
  };
  for (const id of ids) {
    try {
      const one = await remove(id);
      done.removed.push(id);
      done.taken.push(...one.taken);
      done.section = { value: one.section };
    } catch (error) {
      if (!NextlyError.is(error)) {
        failed?.(id, error);
        return done;
      }
      // Gone already, which is what the author asked for.
      if (error.code !== "NOT_FOUND") {
        done.refused.push({ id, reason: refusalWords(error) });
      }
    }
    done.reached += 1;
  }
  return done;
}
