/**
 * The data-loss consent as the commands read it: the `--accept-data-loss`
 * flag and the `NEXTLY_ACCEPT_DATA_LOSS` variable, with any earlier spelling
 * the command honours named as deprecated, and the terminal question asked
 * when neither is given.
 *
 * The judgement itself is `domains/schema/migrate/data-loss-consent.ts`,
 * which the development server's push shares; this is only the command
 * line's side of it.
 *
 * @module cli/utils/data-loss-consent
 */
import * as clack from "@clack/prompts";

import {
  deprecationNotices,
  judgeDataLoss,
  resolveDataLossConsent,
  type DataLossConsent,
  type Deletion,
  type EarlierSpelling,
} from "../../domains/schema/migrate/data-loss-consent";
import { NextlyError } from "../../errors/nextly-error";

/** What the option parser hands over for `--accept-data-loss [targets]`. */
export type AcceptDataLossOption = string | boolean | undefined;

/**
 * The run's consent, read from its flag and the environment, after printing
 * a deprecation notice for each earlier spelling it used. A malformed list
 * throws, before the command changes anything.
 */
export function readDataLossConsent(args: {
  flag: AcceptDataLossOption;
  honours?: readonly EarlierSpelling[];
  earlierFlags?: readonly EarlierSpelling[];
  warn: (message: string) => void;
}): DataLossConsent {
  const consent = resolveDataLossConsent({
    flag: args.flag,
    env: process.env,
    honours: args.honours,
    earlierFlags: args.earlierFlags,
  });
  for (const notice of deprecationNotices(consent)) args.warn(notice);
  return consent;
}

/**
 * Asks the person at the terminal whether to delete, defaulting to no. A
 * cancelled prompt (Ctrl+C) is a no.
 */
export async function askToDeleteInTerminal(
  question: string
): Promise<boolean> {
  const answer = await clack.confirm({
    message: question,
    initialValue: false,
  });
  return !clack.isCancel(answer) && answer;
}

/**
 * A run's deletions judged once, each listed under the file it comes from
 * (`sources`, keyed by identity). The first judgement (`agreed` absent) may
 * ask the person at a terminal and prints the listing; a later one, under the
 * command's lock, accepts only what was agreed. A refusal throws, its
 * listing naming each file; a decline is answered, for the command to end
 * the way it ends one.
 */
export async function judgeRunDeletions(args: {
  sources: ReadonlyMap<Deletion, string>;
  consent: DataLossConsent;
  agreed: readonly Deletion[] | undefined;
  interactive: boolean | undefined;
  askToDelete: ((question: string) => Promise<boolean>) | undefined;
  warn: (line: string) => void;
}): Promise<"proceed" | "declined"> {
  const first = args.agreed === undefined;
  const verdict = await judgeDataLoss({
    deletions: [...args.sources.keys()],
    consent: args.consent,
    interactive: first && args.interactive === true,
    ask: question => args.askToDelete?.(question) ?? Promise.resolve(false),
    print: first ? args.warn : () => {},
    approved: args.agreed,
    sourceOf: deletion => args.sources.get(deletion),
  });
  if (verdict.kind === "refused") {
    throw NextlyError.invalidInput({
      message: verdict.message,
      logContext: {
        files: [...new Set(args.sources.values())],
        reason: `data-loss-${verdict.reason}`,
      },
    });
  }
  return verdict.kind;
}
