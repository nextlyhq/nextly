/**
 * Whether one part of a document may go live now, as far as its workflow is concerned, asked of
 * each part a release would publish: before its moment, at it, and while a reader is shown a due
 * release.
 *
 * The decision is the publish gate's own (`holdReason` in `workflow-publish-gate`), never a second
 * copy: a part goes live only from a stage that allows publishing, holding an approval given under
 * the definition attached now, and only where the gate judges that scope at all (`governs`). It is
 * the gate's early answer, read on the pool: whether the content going live is still what was
 * approved is compared only under the publish's own lock, which a release's write still meets.
 *
 * A decision registered in the container as `partApproval` is asked instead; core registers none.
 *
 * What a caller reads before asking (the review state, and what the part holds) is read once by the
 * caller for its whole batch, so asking costs no read of its own.
 *
 * @module domains/workflows/part-approval
 * @experimental
 */
import { container } from "../../di/container";

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
  /** Where the part stands (`partStage`): its state's stage, or where its content puts it. */
  stage: string;
}

/**
 * The decision, as registered.
 *
 * @experimental
 */
export interface PartApproval {
  /** Whether the part may go live now. */
  approved(question: PartApprovalQuestion): Promise<boolean>;
}

/** The publish gate's decision, as its early answer gives it: see the module. */
const PUBLISH_GATE_DECISION: PartApproval = {
  approved: question =>
    Promise.resolve(
      !governs({
        kind: question.document.scopeKind,
        slug: question.document.scopeSlug,
      }) ||
        holdReason(
          question.registered,
          question.part,
          question.state,
          question.content,
          undefined
        ) === null
    ),
};

/**
 * The decision a part a release would publish is judged by: the publish gate's, unless another is
 * registered.
 *
 * @experimental
 */
export function partApproval(): PartApproval {
  return container.has("partApproval")
    ? container.get<PartApproval>("partApproval")
    : PUBLISH_GATE_DECISION;
}
