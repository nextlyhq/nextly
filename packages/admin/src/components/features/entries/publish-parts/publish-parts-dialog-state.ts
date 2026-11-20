/**
 * What "Choose what to publish" says beside its parts, decided apart from drawing it: what holds
 * Publish where a workflow governs the document, whether publishing past the workflow is offered,
 * the refusals read on the dialog's surface, and what the server says each language will do.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/publish-parts-dialog-state
 */

import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { refusedAsChangedSince } from "@admin/lib/document-version";
import type {
  PartsLanguageOutcome,
  PublishPartsDirection,
  PublishPartsResult,
} from "@admin/services/publishParts";
import type { PartReview } from "@admin/types/workflows";

import type { LanguageLabel } from "../publishAllOutcomes";

import type { PartsChoice } from "./publish-parts-choice";
import { readyProblems, type ReadyProblem } from "./ready-to-publish";

/**
 * What holds Publish where a workflow governs the document, each with its fix. Nothing where no
 * workflow is attached (`parts` absent) or the dialog unpublishes, which no review holds.
 */
export function holdingProblems({
  parts,
  direction,
  choice,
  refusal,
  languages,
  labelOf,
}: {
  /** The document's review state, part by part; absent where no workflow is attached. */
  parts: readonly PartReview[] | undefined;
  direction: PublishPartsDirection;
  choice: PartsChoice;
  refusal: unknown;
  languages: readonly string[];
  labelOf: LanguageLabel;
}): ReadyProblem[] {
  if (parts === undefined || direction !== "publish") return [];
  return readyProblems({
    choice,
    parts,
    refusal,
    translated: languages.length > 0,
    labelOf,
  });
}

/**
 * Whether publishing past the workflow is offered: only to a person who may, and only while a
 * chosen part waits for approval. Another hold, such as a missing field, is not one it goes past.
 */
export function offersPublishWithoutReview(
  mayPublishWithoutReview: boolean | undefined,
  problems: readonly ReadyProblem[]
): boolean {
  return (
    mayPublishWithoutReview === true &&
    problems.some(problem => problem.unapproved)
  );
}

/**
 * The refusals read on the dialog's surface rather than beside a part, and whether the refusal is
 * that the document changed since it was opened, which is said in words of its own.
 *
 * - A refusal no part names is listed, unless a hold already says it (`problems`), so nothing is
 *   said twice.
 * - A refusal that names no part at all, and is not a change since opening, is still read: in the
 *   server's words where it has any, else as a plain failure.
 */
export function dialogRefusals(
  refusal: unknown,
  refused: ReadonlyMap<string, string[]>,
  problems: readonly ReadyProblem[]
): { messages: string[]; changedSince: boolean } {
  const general = (refused.get("") ?? []).filter(
    message => !problems.some(problem => problem.text === message)
  );
  const changedSince = refusal !== null && refusedAsChangedSince(refusal);
  const otherRefusal =
    refusal !== null && refused.size === 0 && !changedSince
      ? apiErrorMessage(refusal, "This could not be done.")
      : null;
  return {
    messages: [...general, ...(otherRefusal ? [otherRefusal] : [])],
    changedSince,
  };
}

/** What the server says each language will do, by language code; empty before it has said. */
export function outcomesByLocale(
  description: PublishPartsResult | undefined
): ReadonlyMap<string, PartsLanguageOutcome> {
  return new Map(
    (description?.languages ?? []).map(language => [language.locale, language])
  );
}
