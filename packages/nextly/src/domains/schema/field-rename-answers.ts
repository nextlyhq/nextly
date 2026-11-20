/**
 * What a schema change sent through the REST API or a plugin says about a field leaving and
 * another of the same type arriving: a rename, which keeps the field's values under its new name,
 * or not (`drop_and_add`), which drops the old field and its values and adds the new one empty.
 *
 * The pair is never taken for a rename by guesswork. A road that takes these answers (the
 * collection schema PATCH, the Single schema PATCH and a plugin's `updateCollection`) runs its
 * change inside `withFieldRenameAnswers`; there a pair with no answer is refused before anything
 * is written (`refuseUnansweredRename`), and a pair answered `drop_and_add` is not renamed by any
 * step of the change (`declinedRename`). The Builder's own roads ask about each rename themselves
 * and set no answers here, so nothing here refuses them.
 *
 * @module domains/schema/field-rename-answers
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";

/** @experimental A schema change's answer for a field leaving and another arriving, by name. */
export interface FieldRenameAnswer {
  from: string;
  to: string;
  choice: "rename" | "drop_and_add";
}

const ANSWERS = z
  .array(
    z
      .object({
        from: z.string().min(1).max(255),
        to: z.string().min(1).max(255),
        choice: z.enum(["rename", "drop_and_add"]),
      })
      .strict()
  )
  .max(200)
  // One answer per pair: two for the same pair would leave which applies to their order.
  .refine(
    answers =>
      new Set(answers.map(a => JSON.stringify([a.from, a.to]))).size ===
      answers.length,
    { message: "renames answers a field pair more than once." }
  );

/** The answers a request sent, read at the boundary; none where it sent none. */
export function parseFieldRenameAnswers(value: unknown): FieldRenameAnswer[] {
  if (value === undefined || value === null) return [];
  const parsed = ANSWERS.safeParse(value);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "renames",
          code: "INVALID",
          message:
            'renames must be a list of { from, to, choice: "rename" | "drop_and_add" }, by field name, answering each pair once.',
        },
      ],
    });
  }
  return parsed.data;
}

const answersScope = new AsyncLocalStorage<readonly FieldRenameAnswer[]>();

/**
 * A request's body or input without its `renames`, which are read apart (`parseFieldRenameAnswers`)
 * and never stored with the rest.
 */
export function withoutRenameAnswers<T extends object>(
  input: T
): Omit<T, "renames"> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "renames")
  ) as Omit<T, "renames">;
}

/** Run `work`, a schema change on a road that takes answers, with the request's answers. */
export function withFieldRenameAnswers<T>(
  answers: readonly FieldRenameAnswer[],
  work: () => Promise<T>
): Promise<T> {
  return answersScope.run(answers, work);
}

/** A field pair, as the change's rename candidate names it. */
interface FieldPair<F extends { name?: string } = { name?: string }> {
  from: F;
  to: F;
}

function answers(pair: FieldPair): FieldRenameAnswer | undefined {
  return answersScope
    .getStore()
    ?.find(a => a.from === pair.from.name && a.to === pair.to.name);
}

/** Whether the running change answered this pair `drop_and_add`: then nothing renames it. */
export function declinedRename(pair: FieldPair): boolean {
  return answers(pair)?.choice === "drop_and_add";
}

/**
 * Refuse, before anything is written, a change on a road that takes answers that makes a pair it
 * doesn't answer: each of `pairs`, the change's rename candidates (`renameCandidatesOf`).
 * `entity` names it: `The collection "posts"`, say. A pair answered `drop_and_add` whose two
 * names are one column (`columnOf`, none for a field with no column), as `fooBar` and `foo_bar` are, is refused too: the
 * column cannot be dropped and added again in one change, only renamed. A `rename` answer for a
 * field the change removes and one it adds (`names`) that isn't among them is refused as well, as
 * when a change replaces two fields at once, which no candidate pairs: left aside, its fields would
 * be dropped and added with their values lost though the request asked to keep them. An answer
 * naming a field the change doesn't remove or add, as a retry of a rename already recorded does,
 * is about nothing in it, and a `drop_and_add` answer asks for what the change does anyway: both
 * are left aside. Off such a road nothing is refused.
 */
export function refuseUnansweredRename<F extends { name?: string }>(
  entity: string,
  pairs: readonly FieldPair<F>[],
  columnOf: (field: F) => string | undefined,
  /** The entity's field names before the change and after it. */
  names: { before: readonly string[]; after: readonly string[] }
): void {
  const sent = answersScope.getStore();
  if (sent === undefined) return;
  const removed = names.before.filter(name => !names.after.includes(name));
  const added = names.after.filter(name => !names.before.includes(name));
  const unoffered = sent.find(
    a =>
      a.choice === "rename" &&
      removed.includes(a.from) &&
      added.includes(a.to) &&
      !pairs.some(pair => pair.from.name === a.from && pair.to.name === a.to)
  );
  if (unoffered) {
    throw NextlyError.validation({
      errors: [
        {
          path: "renames",
          code: "FIELD_RENAME_NOT_OFFERED",
          message: `${entity}: the change can't rename "${unoffered.from}" to "${unoffered.to}". A rename is one field removed and one of a compatible type added, one field at a time: rename each field in a change of its own, or answer "drop_and_add".`,
        },
      ],
      logContext: {
        reason: "field-rename-not-offered",
        from: unoffered.from,
        to: unoffered.to,
      },
    });
  }
  for (const pair of pairs) {
    const from = pair.from.name ?? "";
    const to = pair.to.name ?? "";
    const answer = answers(pair);
    // Only fields stored in a column can collide in one: a field group's rows are told apart by
    // the field's exact name, whatever column a name like it would have.
    const fromColumn = columnOf(pair.from);
    if (
      answer?.choice === "drop_and_add" &&
      fromColumn !== undefined &&
      fromColumn === columnOf(pair.to)
    ) {
      throw NextlyError.validation({
        errors: [
          {
            path: "renames",
            code: "FIELD_RENAME_SAME_COLUMN",
            message: `${entity}: "${from}" and "${to}" are stored in the same column, which can't be dropped and added again in one change. Answer "rename" for them, or remove "${from}" and add "${to}" in two changes.`,
          },
        ],
        logContext: { reason: "field-rename-same-column", from, to },
      });
    }
    if (answer !== undefined) continue;
    throw NextlyError.validation({
      errors: [
        {
          path: "renames",
          code: "FIELD_RENAME_UNANSWERED",
          message: `${entity} removes the field "${from}" and adds "${to}" of the same type, and the request doesn't say whether that is a rename. Send renames: [{ "from": "${from}", "to": "${to}", "choice": "rename" }] to rename it and keep its values, or "choice": "drop_and_add" to drop "${from}" and its values and add "${to}" empty.`,
        },
      ],
      logContext: { reason: "field-rename-unanswered", from, to },
    });
  }
}
