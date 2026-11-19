/**
 * Whether one part of a document may go live now, as far as its workflow is concerned, asked of
 * each part a release would publish: before its moment, at it, and while a reader is shown a due
 * release.
 *
 * The decision is the publish gate's own (`holdReason` in `workflow-publish-gate`), never a second
 * copy: a part goes live only from a stage that allows publishing, holding an approval given under
 * the definition attached now, whose content is still what goes live, and only where the gate
 * judges that scope at all (`governs`). It is asked on the pool, ahead of any publish; the publish
 * a release leads to is judged again under its own lock.
 *
 * Whether the content is still what was approved is compared where the caller hands a comparison
 * (`approvedNow`), and only for a part the rest of the decision lets through: a collection's save
 * withdraws an approval its content moved off, so a caller compares a Single's parts alone, whose
 * saves leave an approval in place.
 *
 * @module domains/workflows/part-approval
 * @experimental
 */
import type { RegisteredWorkflow } from "./registry";
import type { ReviewDocument, ReviewState } from "./review-state-repository";
import { governs, holdReason } from "./workflow-publish-gate";

/**
 * One part a publish would put live, as the decision is asked about it.
 *
 * @experimental
 */
export interface PartApprovalQuestion {
  /** The workflow the document's collection or Single is attached to, with its hash. */
  registered: RegisteredWorkflow;
  document: ReviewDocument;
  /** A language, or null for the shared part. */
  part: string | null;
  /** The part's review state as stored, or null when it has none. */
  state: ReviewState | null;
  /** What the part holds as stored: whether it is live, and whether a draft is pending. */
  content: { live: boolean; pending: boolean };
  /**
   * Whether the content the part puts live is still what its approval approved, read when called.
   * Absent where the caller does not compare it.
   */
  approvedNow?: () => Promise<boolean>;
}

/**
 * Whether the part may go live now, by the publish gate's decision: see the module.
 *
 * @experimental
 */
export async function partApproved(
  question: PartApprovalQuestion
): Promise<boolean> {
  const { registered, part, state, content, document } = question;
  if (!governs({ kind: document.scopeKind, slug: document.scopeSlug })) {
    return true;
  }
  if (holdReason(registered, part, state, content, undefined) !== null) {
    return false;
  }
  // The comparison reads the content, so it is made only for a part nothing else holds back.
  if (question.approvedNow === undefined) return true;
  return (
    holdReason(
      registered,
      part,
      state,
      content,
      await question.approvedNow()
    ) === null
  );
}
