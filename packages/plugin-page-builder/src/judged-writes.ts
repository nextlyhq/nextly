/**
 * Writes made to be judged and then taken back, and the fingerprint a preview
 * is confirmed by.
 *
 * A dry run answers what an action would change without changing it. The
 * answer that matters most is whether the site would accept it, and only the
 * site's own write path knows: field validation over the composed page, the
 * locks, the loop guard, the rights checks and the hooks that strip what a
 * write may not keep. So a dry run makes its writes, as the caller, inside a
 * transaction it then rolls back, and reports whatever refused them.
 *
 * Hooks run for those writes too. Each judging write carries
 * {@link JUDGEMENT_CONTEXT} in its hook context, so a hook with an effect a
 * rollback cannot undo can wait for the write that commits.
 *
 * @module judged-writes
 */
import { createHash } from "node:crypto";

import { NextlyError } from "@nextlyhq/plugin-sdk";

import { TRANSFER_JUDGEMENT_CONTEXT } from "./transfer/transfer-contract";

/**
 * The hook context key a judging write carries, `true` while the write will be
 * rolled back. The same key the import's judging writes have always carried.
 */
export const JUDGEMENT_CONTEXT: string = TRANSFER_JUDGEMENT_CONTEXT;

/**
 * Thrown inside the judging transaction to roll it back once it has answered,
 * carrying what the writes returned so the answer can show the stored form,
 * after the hooks, rather than the plan.
 */
export class JudgedAndRolledBack extends Error {
  constructor(readonly written?: unknown) {
    super("judged and rolled back");
  }
}

/** What the site said when it refused a judged write. */
export interface JudgedRefusal {
  /** Every message the refusal carried, in the site's own words. */
  readonly messages: readonly string[];
}

/** A judged write's answer: refused, or accepted with what it wrote. */
export type Judgement<R> =
  | { readonly refusal: JudgedRefusal }
  | { readonly refusal: null; readonly written: R };

/**
 * Run `write` in a transaction and roll it back. Answers what it wrote, or the
 * site's refusal. Any other failure is thrown: a fault is not a judgement.
 */
export async function judgeInTransaction<Tx, R>(
  withTransaction: (run: (tx: Tx) => Promise<never>) => Promise<unknown>,
  write: (tx: Tx) => Promise<R>
): Promise<Judgement<R>> {
  try {
    await withTransaction(async tx => {
      throw new JudgedAndRolledBack(await write(tx));
    });
  } catch (error) {
    const verdict = verdictOf(error);
    return verdict.refusal === null
      ? { refusal: null, written: verdict.rolledBack.written as R }
      : verdict;
  }
  // Unreachable while the write above throws its sentinel; a transaction that
  // committed instead would be a write the caller asked only to preview.
  throw NextlyError.internal({
    logContext: { reason: "judging-transaction-committed" },
  });
}

/**
 * What ended a judging transaction: the rollback it was made to end in, or the
 * site's refusal. Anything else is thrown again, a fault rather than a
 * judgement: a server error, and a write refused because the item changed
 * since it was read, which the caller answers by reading again rather than by
 * changing what it asked.
 */
export function verdictOf(
  error: unknown
):
  | { readonly refusal: null; readonly rolledBack: JudgedAndRolledBack }
  | { readonly refusal: JudgedRefusal } {
  // A database adapter can wrap what the transaction threw; the cause is what
  // answered.
  const rolledBack = inCauses(error, JudgedAndRolledBack);
  if (rolledBack !== undefined) return { refusal: null, rolledBack };
  const refused = inCauses(error, NextlyError);
  if (
    refused === undefined ||
    refused.statusCode >= 500 ||
    refused.code === "STALE_VERSION"
  ) {
    throw error;
  }
  return { refusal: refusalOf(refused) };
}

/** The first error in `error`'s cause chain of the class given. */
export function inCauses<T extends Error>(
  error: unknown,
  kind: abstract new (...args: never[]) => T
): T | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    if (current instanceof kind) return current;
    current = current.cause;
  }
  return undefined;
}

/** A refusal in the words the site gave it. */
function refusalOf(error: NextlyError): JudgedRefusal {
  const listed = (error.publicData as { errors?: unknown } | undefined)?.errors;
  const messages = Array.isArray(listed)
    ? listed
        .map(entry => (entry as { message?: unknown }).message)
        .filter((message): message is string => typeof message === "string")
    : [];
  return { messages: messages.length > 0 ? messages : [error.publicMessage] };
}

/**
 * A digest of a stored value that does not depend on how the database orders
 * an object's keys, so a value read twice and unchanged fingerprints alike.
 */
export function storedFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
