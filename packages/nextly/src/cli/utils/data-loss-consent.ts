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

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  ACCEPT_DATA_LOSS_ENV,
  deprecationNotices,
  judgeDataLoss,
  resolveDataLossConsent,
  type DataLossConsent,
  type DataLossVerdict,
  type Deletion,
  type EarlierSpelling,
} from "../../domains/schema/migrate/data-loss-consent";
import { CliError } from "../errors/cli-error";
import { dataLossRefusal } from "../errors/index";

import { answered } from "./prompt-cancelled";

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
 * cancelled prompt (Ctrl+C) is not a no: it ends the run with exit 130
 * (`promptCancelled`), where a no is the declined deletion.
 */
export async function askToDeleteInTerminal(
  question: string
): Promise<boolean> {
  return answered(
    await clack.confirm({
      message: question,
      initialValue: false,
    })
  );
}

/**
 * The error a run ends with when the person at the terminal did not confirm
 * a deletion: nothing changed, and it names the consent that deletes without
 * asking. It exits 1, as a run with no consent and no terminal does.
 */
export function dataLossDeclined(): CliError {
  return new CliError("DATA_LOSS_DECLINED", {
    what: "Nothing was changed: the deletion was not confirmed.",
    why: "The prompt that listed what would be deleted was not answered yes.",
    next: `Run the command again and confirm, or give --accept-data-loss (or ${ACCEPT_DATA_LOSS_ENV}) to consent without being asked.`,
    context: { reason: "data-loss-declined" },
  });
}

/**
 * Ends a run whose deletion was not allowed: a no at the terminal, or a
 * refusal (no consent and nobody to ask, or a consent that leaves a deletion
 * out). Returns only for a run that may proceed.
 */
export function requireConsented(verdict: DataLossVerdict): void {
  if (verdict.kind === "declined") throw dataLossDeclined();
  if (verdict.kind === "refused") throw dataLossRefusal(verdict);
}

/**
 * The data-loss judgement for a command's `deletions`, asking the person at
 * the terminal where one can be asked (`canPrompt`) and listing what goes
 * through `print`. Returns the verdict, for the caller to end the run on
 * (`requireConsented`) or to grace.
 */
export function judgeDataLossAtTerminal(args: {
  deletions: readonly Deletion[];
  consent: DataLossConsent;
  print: (line: string) => void;
}): Promise<DataLossVerdict> {
  return judgeDataLoss({
    deletions: args.deletions,
    consent: args.consent,
    interactive: canPrompt(),
    ask: askToDeleteInTerminal,
    print: args.print,
  });
}

/**
 * The consent for a command that deleted without one until now, in its one
 * release of grace. Covered, the run proceeds; where a person can be asked,
 * they are, and a no ends the run. Where nobody can be asked (no terminal,
 * `CI` set, or `--non-interactive`) and no consent was given, the run deletes
 * as it always has, after `warn` says the next release needs the consent. A
 * consent naming targets that leaves a deletion out is refused, as everywhere.
 */
export async function judgeDataLossWithGrace(args: {
  command: string;
  deletions: readonly Deletion[];
  consent: DataLossConsent;
  print: (line: string) => void;
  warn: (message: string) => void;
}): Promise<void> {
  const verdict = await judgeDataLossAtTerminal(args);
  if (verdict.kind === "refused" && verdict.reason === "needs-consent") {
    args.warn(
      `${args.command} deletes without the data-loss consent in this release only: the next release needs --accept-data-loss (or ${ACCEPT_DATA_LOSS_ENV}) for a run that cannot be asked.`
    );
    return;
  }
  requireConsented(verdict);
}
