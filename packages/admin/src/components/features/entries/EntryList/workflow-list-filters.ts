/**
 * The entry list's review filters, for a collection a workflow holds: by stage, and by review
 * ("Assigned to me", "Waiting for my review", "Changed since approved"). Each is offered as a
 * list filter is (`ListFilter`), so the toolbar draws it, keeps its choice in the URL and
 * adds its `where` to the request exactly as it does a plugin's; each `where` is a top-level key
 * the server reads (`_stage`, `_assignedToMe`, `_waitingForMe`, `_changedSinceApproved`).
 *
 * @module components/features/entries/EntryList/workflow-list-filters
 */
import type { ListFilter } from "./plugin-filters";

/** The stage filter's name: under core's own namespace, which no plugin slug can take. */
export const STAGE_FILTER = "nextly.review-stage";
/** The review filter's name. */
export const REVIEW_FILTER = "nextly.review";

/**
 * The review filters a collection's list offers: none where no workflow holds it; the stage
 * filter only where its stages are known.
 */
export function workflowListFilters(
  workflow:
    | { stages?: readonly { name: string; label: string }[] }
    | null
    | undefined
): ListFilter[] {
  if (!workflow) return [];
  const stages = workflow.stages ?? [];
  return [
    ...(stages.length > 0
      ? [
          {
            name: STAGE_FILTER,
            label: "Stage",
            options: stages.map(stage => ({
              value: stage.name,
              label: stage.label,
              where: { _stage: stage.name },
            })),
          },
        ]
      : []),
    {
      name: REVIEW_FILTER,
      label: "Review",
      options: [
        {
          value: "assigned",
          label: "Assigned to me",
          where: { _assignedToMe: true },
        },
        {
          value: "waiting",
          label: "Waiting for my review",
          where: { _waitingForMe: true },
        },
        {
          value: "changed",
          label: "Changed since approved",
          where: { _changedSinceApproved: true },
        },
      ],
    },
  ];
}
