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
import { createHash } from "node:crypto";

import * as clack from "@clack/prompts";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  ACCEPT_DATA_LOSS_ENV,
  deletionKey,
  deprecationNotices,
  describeDeletion,
  judgeDataLoss,
  resolveDataLossConsent,
  type DataLossConsent,
  type DataLossVerdict,
  type Deletion,
  type EarlierSpelling,
} from "../../domains/schema/migrate/data-loss-consent";
import { NextlyError } from "../../errors/nextly-error";
import type { DryRunChange } from "../dry-run";
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
function dataLossDeclined(): CliError {
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

/**
 * What a dry run of a deleting command names: each deletion the real run
 * would ask consent for, in the words the consent's listing uses.
 */
export function deletionChanges(
  deletions: readonly Deletion[]
): DryRunChange[] {
  return deletions.map(deletion => ({
    action: "remove",
    target: describeDeletion(deletion),
  }));
}

/**
 * The file a deletion comes from: `label`, its name as the listing shows it,
 * and `identity`, its name and a digest of its text, which an agreement binds
 * to, so a yes to one file's deletion never stands for another file's, nor
 * for the same file once its text changed.
 */
export interface DeletionSource {
  label: string;
  identity: string;
}

/** The source of a deletion from the file `label` whose statements are `text`. */
export function deletionSource(label: string, text: string): DeletionSource {
  return { label, identity: `${label}\u0000${textDigest(text)}` };
}

/** The sha256 of a file's text, as an agreement binds the file and as a run checks it before running it. */
export function textDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** What a person agreed to: each deletion of each file, by the file's identity. */
export type Agreement = ReadonlySet<string>;

/** A deletion as an agreement holds it: bound to the identity of its file. */
function agreed(source: DeletionSource, deletion: Deletion): string {
  return `${source.identity}\u0000${deletionKey(deletion)}`;
}

/**
 * A run's deletions judged once, each listed under the file it comes from
 * (`sources`, keyed by identity). The first judgement (`agreed` absent) may
 * ask the person at a terminal and prints the listing; a later one, under the
 * command's lock, accepts without asking only a deletion of a file agreed to
 * as it stands now. A refusal throws, its listing naming each file, and a no
 * at the terminal throws `dataLossDeclined`: both before anything changes.
 * Returns what this judgement agreed to.
 */
export async function judgeRunDeletions(args: {
  sources: ReadonlyMap<Deletion, DeletionSource>;
  consent: DataLossConsent;
  agreed: Agreement | undefined;
  interactive: boolean | undefined;
  askToDelete: ((question: string) => Promise<boolean>) | undefined;
  warn: (line: string) => void;
  /** What the run cannot list, told beside its deletions (`eventTriggerNotice`); never judged. */
  notice?: string;
}): Promise<Agreement> {
  const first = args.agreed === undefined;
  const sources = [...args.sources];
  // Under the lock only what no agreement binds goes to the verdict, which
  // compares deletions by kind and table alone: an agreement is kept here,
  // by file, so one file's agreed deletion never covers another's.
  const judged = first
    ? sources
    : sources.filter(
        ([deletion, source]) =>
          args.agreed?.has(agreed(source, deletion)) !== true
      );
  // Told only beside deletions: a question at a terminal follows it, and a
  // refusal carries it.
  const notice = judged.length > 0 ? args.notice : undefined;
  if (first && notice !== undefined && args.interactive === true) {
    args.warn(notice);
  }
  const verdict = await judgeDataLoss({
    deletions: judged.map(([deletion]) => deletion),
    consent: args.consent,
    interactive: first && args.interactive === true,
    ask: question => args.askToDelete?.(question) ?? Promise.resolve(false),
    print: first ? args.warn : () => {},
    sourceOf: deletion => args.sources.get(deletion)?.label,
  });
  if (verdict.kind === "refused") {
    throw NextlyError.invalidInput({
      message: withNotice(verdict.message, notice),
      logContext: {
        files: [...new Set(sources.map(([, source]) => source.label))],
        reason: `data-loss-${verdict.reason}`,
      },
    });
  }
  if (verdict.kind === "declined") throw dataLossDeclined();
  if (first && notice !== undefined && args.interactive !== true) {
    args.warn(notice);
  }
  return new Set(sources.map(([deletion, source]) => agreed(source, deletion)));
}

/** A refusal's message with the notice after it, when there is one. */
function withNotice(message: string, notice: string | undefined): string {
  return notice === undefined ? message : `${message}\n${notice}`;
}

/**
 * What a run tells of the database's DDL event triggers, from `read`
 * (`readDdlEventTriggers`): each by name, since Nextly cannot see what one
 * does on the schema changes a migration makes; that the read failed, when it
 * did; undefined when there are none. Told, never judged: no consent covers
 * code nobody can read, and asking for blanket consent on every run of a
 * database that has one would make that consent meaningless.
 */
export async function eventTriggerNotice(
  read: () => Promise<readonly string[]>
): Promise<string | undefined> {
  let names: readonly string[];
  try {
    names = await read();
  } catch {
    return "Nextly could not read whether this database has DDL event triggers, which run on schema changes; what they delete is not listed.";
  }
  if (names.length === 0) return undefined;
  return names.length === 1
    ? `This database has the DDL event trigger ${names[0]}: it runs on schema changes, and Nextly cannot see what it does, so what it deletes is not listed.`
    : `This database has the DDL event triggers ${names.join(", ")}: they run on schema changes, and Nextly cannot see what they do, so what they delete is not listed.`;
}
