/**
 * Where every write to a document is refused (its collection or Single was
 * removed from code), the editor offers only what reads, whatever the user
 * may do: no leading action, and none of the verbs that follow a permission
 * of their own (publishing, unpublishing, deleting).
 *
 * Asserted over the state space, with every permission held, so a state the
 * rule forgot shows as a write offered there.
 */
import { describe, expect, it } from "vitest";

import { documentActions, type DocumentActionState } from "../document-actions";

/** The ids of the actions that read and write nothing. */
const READS = new Set(["view-api"]);

function everyState(): DocumentActionState[] {
  const states: DocumentActionState[] = [];
  for (const mode of ["create", "edit"] as const)
    for (const hasStatus of [true, false])
      for (const status of ["draft", "published"] as const)
        for (const hasWorkingDraft of [true, false])
          for (const isDirty of [true, false])
            states.push({
              mode,
              hasStatus,
              draftsEnabled: true,
              status,
              hasWorkingDraft,
              readingHistory: false,
              canEdit: true,
              canPublish: true,
              canUnpublish: true,
              canDelete: true,
              isDirty,
              canDuplicate: true,
            });
  return states;
}

describe("documentActions where every write is refused", () => {
  it("offers only what reads, in every state, with every permission held", () => {
    for (const state of everyState()) {
      const ids = documentActions({ ...state, writesRefused: true }).map(
        action => action.id
      );
      expect(
        ids.filter(id => !READS.has(id)),
        JSON.stringify(state)
      ).toEqual([]);
    }
  });

  it("offers the writes in the same states when they are not refused", () => {
    // The control: the same states, unrefused, do offer writes, so the
    // assertion above is not satisfied by states that offer none anyway.
    const offered = everyState().flatMap(state =>
      documentActions(state).map(action => action.id)
    );
    for (const id of ["save", "publish", "unpublish", "delete", "duplicate"]) {
      expect(offered).toContain(id);
    }
  });
});
