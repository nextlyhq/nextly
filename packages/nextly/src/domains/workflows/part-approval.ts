/**
 * Whether one part of a document may go live now, as far as its workflow is concerned: the one
 * decision a publish asks of a part, and that a release asks of each part it would publish before
 * its moment, at it, and while a reader is shown a due release.
 *
 * The decision is the publish path's own: a part sits in a stage that allows publishing, holding
 * an approval that is current (given under the definition the workflow has now and, for a Single,
 * whose saves leave an approval in place, still naming the content the part shows). It is
 * registered in the container as `partApproval` by whatever implements it; asked here, never
 * computed a second time. With nothing registered every part is approved, as a publish with no
 * publish gate registered moves every part.
 *
 * What a caller reads before asking (the review state, where the part stands, the content a
 * Single's part shows) is read once by the caller for its whole batch, so asking costs no read of
 * its own unless the decision opens the content.
 *
 * @module domains/workflows/part-approval
 * @experimental
 */
import { container } from "../../di/container";
import type { VersionRow } from "../versions/versions-repository";

import type { RegisteredWorkflow } from "./registry";
import type { ReviewDocument, ReviewState } from "./review-state-repository";

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
  /** Where the part stands (`partStage`): its state's stage, or where its content puts it. */
  stage: string;
  /**
   * For a Single's part, the version a reviewer is shown of it now (its newest recorded version;
   * for the shared part, the newest of any part), read when first called and undefined for a part
   * never saved. A Single's save leaves an approval in place, so the decision compares this with
   * the approval's digest. Absent for a collection's part, whose saves withdraw an approval the
   * content moved off.
   */
  shownVersion?: () => Promise<VersionRow | undefined>;
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

/** The decision while none is registered: every part may go live. */
const EVERY_PART_APPROVED: PartApproval = {
  approved: () => Promise.resolve(true),
};

/**
 * The decision a part's publish is judged by: the registered one, else one approving every part.
 *
 * @experimental
 */
export function partApproval(): PartApproval {
  return container.has("partApproval")
    ? container.get<PartApproval>("partApproval")
    : EVERY_PART_APPROVED;
}
