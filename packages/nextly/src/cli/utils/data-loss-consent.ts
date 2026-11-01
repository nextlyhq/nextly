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
  resolveDataLossConsent,
  type DataLossConsent,
  type EarlierSpelling,
} from "../../domains/schema/migrate/data-loss-consent";

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
