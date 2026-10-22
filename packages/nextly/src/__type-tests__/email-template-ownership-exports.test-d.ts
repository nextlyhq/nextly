/**
 * The template ownership methods' argument and result types, named from the
 * package root.
 *
 * Read through the root entry point (`src/index.ts`, which `nextly` resolves
 * to), never through `direct-api/types`: a name that stops being re-exported
 * is the regression this file catches. Each is asserted to be exactly what
 * `getNextly().emailTemplates` takes or returns, so a re-export of some other
 * type under the same name fails too. Compiled by `pnpm check-types`.
 */
import type {
  ApplyEmailTemplateUpdateArgs,
  CompareEmailTemplateArgs,
  EmailTemplateComparison,
  EmailTemplateVersion,
  OverrideEmailTemplateArgs,
  OwnerChange,
  OwnerChangeChoice,
  OwnerUpdateUndo,
  ResetEmailTemplateArgs,
  UndoEmailTemplateUpdateArgs,
} from "../index";
import type { getNextly } from "../init";

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

type Templates = Awaited<ReturnType<typeof getNextly>>["emailTemplates"];
type ArgsOf<M extends keyof Templates> = Parameters<Templates[M]>[0];
type ResultOf<M extends keyof Templates> = Awaited<ReturnType<Templates[M]>>;

assertType<Exact<ArgsOf<"override">, OverrideEmailTemplateArgs>>(true);
assertType<Exact<ArgsOf<"reset">, ResetEmailTemplateArgs>>(true);
assertType<Exact<ArgsOf<"compare">, CompareEmailTemplateArgs>>(true);
assertType<Exact<ArgsOf<"applyUpdate">, ApplyEmailTemplateUpdateArgs>>(true);
assertType<Exact<ArgsOf<"undoUpdate">, UndoEmailTemplateUpdateArgs>>(true);
assertType<Exact<ResultOf<"compare">, EmailTemplateComparison>>(true);
assertType<Exact<ResultOf<"applyUpdate">["undo"], OwnerUpdateUndo>>(true);

// The types those name, so a caller can build each argument.
assertType<
  Exact<
    OverrideEmailTemplateArgs["version"],
    Partial<EmailTemplateVersion> | undefined
  >
>(true);
assertType<Exact<EmailTemplateComparison["changes"], OwnerChange[]>>(true);
assertType<
  Exact<
    ApplyEmailTemplateUpdateArgs["choices"],
    Record<string, OwnerChangeChoice>
  >
>(true);

/** A review, written the way code calling these methods writes it. */
export async function reviewTheOwnersUpdate(
  templates: Templates,
  id: string
): Promise<void> {
  const compareArgs: CompareEmailTemplateArgs = { id };
  const comparison: EmailTemplateComparison =
    await templates.compare(compareArgs);
  const choices: Record<string, OwnerChangeChoice> = {};
  for (const change of comparison.changes satisfies OwnerChange[]) {
    choices[change.id] = { use: "theirs" };
  }
  const applyArgs: ApplyEmailTemplateUpdateArgs = {
    id,
    choices,
    review: comparison.review,
  };
  const { undo } = await templates.applyUpdate(applyArgs);
  const kept: OwnerUpdateUndo = undo;
  const undoArgs: UndoEmailTemplateUpdateArgs = { id, undo: kept };
  await templates.undoUpdate(undoArgs);

  const resetArgs: ResetEmailTemplateArgs = { id };
  await templates.reset(resetArgs);
  const version: Partial<EmailTemplateVersion> = {
    subject: comparison.mine.subject,
  };
  const overrideArgs: OverrideEmailTemplateArgs = { id, version };
  await templates.override(overrideArgs);
}
