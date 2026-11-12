/**
 * The content events a part's review state records when it moves or goes without a step: a
 * deploy that renamed or removed its stage, a deploy that detached its workflow, a discard of its
 * working draft, and a person moving it out of a stage the workflow no longer has. Each is a kind
 * of its own, named with the `workflow-` prefix the step kinds carry, since kind names are shared
 * by every producer.
 *
 * @module domains/workflows/review-state-events
 * @experimental
 */
import { z } from "zod";

import {
  contentEventKind,
  registerContentEventKind,
} from "../content-events/kinds";

/**
 * The kinds, by what happened.
 *
 * - `stageRenamed`: a deploy moved the part from the name its stage had to the name it has now.
 * - `stageRemoved`: a deploy moved the part from a removed stage to the one the definition names
 *   for it, withdrawing any approval it held (`approvalWithdrawn`).
 * - `detached`: a deploy detached the workflow, and the document's review state went with it;
 *   `stages` names the stages its parts were in.
 * - `discarded`: a discard of the part's working draft closed its review.
 * - `strandedMoved`: a person moved the part out of a stage the workflow no longer has; `from`
 *   names the stages its parts were in, and the note keeps their comment.
 *
 * @experimental
 */
export const REVIEW_STATE_EVENT_KINDS = {
  stageRenamed: {
    name: "workflow-stage-renamed",
    label: "Stage renamed in the workflow",
  },
  stageRemoved: {
    name: "workflow-stage-removed",
    label: "Moved: its stage was removed from the workflow",
    payload: z.object({ approvalWithdrawn: z.boolean() }).strict(),
  },
  detached: {
    name: "workflow-detached",
    label: "Workflow detached: review state removed",
    payload: z.object({ stages: z.array(z.string().min(1)) }).strict(),
  },
  discarded: {
    name: "workflow-discarded",
    label: "Review closed: draft discarded by {actor}",
  },
  strandedMoved: {
    name: "workflow-stranded-moved",
    label: "Moved out of a removed stage by {actor}",
    payload: z.object({ from: z.array(z.string().min(1)) }).strict(),
  },
} as const;

/**
 * Registers each of these kinds not registered yet; safe on every write.
 *
 * @experimental
 */
export function ensureReviewStateEventKinds(): void {
  for (const kind of Object.values(REVIEW_STATE_EVENT_KINDS)) {
    if (!contentEventKind(kind.name)) registerContentEventKind(kind);
  }
}

/**
 * The parts of a document an event names, from the parts of its review states: each language,
 * and whether the shared part (null) was among them.
 */
export function eventParts(parts: readonly (string | null)[]): {
  locales: string[];
  shared: boolean;
} {
  return {
    locales: [...new Set(parts.flatMap(part => (part === null ? [] : [part])))],
    shared: parts.includes(null),
  };
}
