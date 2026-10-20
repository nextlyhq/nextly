/**
 * The plan a materialisation pass follows, decided before anything is written.
 *
 * @module domains/releases/__tests__/plan-release-materialisation.test
 */
import { describe, expect, it } from "vitest";

import { planReleaseMaterialisation } from "../plan-release-materialisation";
import type { DrainMemberRow } from "../releases-repository";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const JAN = new Date("2026-01-01T00:00:00.000Z");
const FEB = new Date("2026-02-01T00:00:00.000Z");

let seq = 0;
function member(over: Partial<DrainMemberRow> = {}): DrainMemberRow {
  seq += 1;
  return {
    id: `m${seq}`,
    releaseId: "r1",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    locale: null,
    action: "publish",
    memberKey: `k${seq}`,
    singleSlot: null,
    appliedRevision: null,
    createdBy: "author",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

describe("planReleaseMaterialisation", () => {
  it("plans one action per document", () => {
    const plan = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 0 }],
      members: [member({ entryId: "e1" }), member({ entryId: "e2" })],
      now: NOW,
    });
    expect(plan.actions.map(a => a.ref.entryId).sort()).toEqual(["e1", "e2"]);
    expect(plan.actions.every(a => a.effect === "publish")).toBe(true);
  });

  it("gives ONE answer for a document in two due releases, whatever the order", () => {
    // Publish on the 1st, unpublish on the 1st of the next month; a drain that
    // fell behind finds both due. Applying releases one at a time would leave
    // the document in whichever state the loop reached last — the plan reduces
    // them to the single winner instead, using the same rule the read path uses
    // so a read before and a read after agree.
    const publish = member({ releaseId: "r1", action: "publish" });
    const unpublish = member({ releaseId: "r2", action: "unpublish" });
    const releases = [
      { id: "r1", scheduledAt: JAN, revision: 0 },
      { id: "r2", scheduledAt: FEB, revision: 0 },
    ];

    const forward = planReleaseMaterialisation({
      releases,
      members: [publish, unpublish],
      now: NOW,
    });
    const reversed = planReleaseMaterialisation({
      releases: [...releases].reverse(),
      members: [unpublish, publish],
      now: NOW,
    });

    expect(forward.actions).toHaveLength(1);
    expect(forward.actions[0]?.effect).toBe("unpublish");
    // The control that makes the case above about ORDER rather than about
    // "unpublish happens to win": reversing both inputs must not change it.
    expect(reversed.actions).toEqual(forward.actions);
  });

  it("attributes each action to the member that WON it", () => {
    // The write runs as this person. Losing the winner would leave the caller
    // with an effect and nobody to apply it as, and the only fallback available
    // would be the privileged principal the design refuses.
    const plan = planReleaseMaterialisation({
      releases: [
        { id: "r1", scheduledAt: JAN, revision: 0 },
        { id: "r2", scheduledAt: FEB, revision: 0 },
      ],
      members: [
        member({ releaseId: "r1", action: "publish", createdBy: "early" }),
        member({ releaseId: "r2", action: "unpublish", createdBy: "late" }),
      ],
      now: NOW,
    });
    expect(plan.actions[0]).toMatchObject({
      effect: "unpublish",
      releaseId: "r2",
      createdBy: "late",
    });
  });

  it("carries a null author rather than inventing one", () => {
    // A member whose author was never recorded. Substituting anybody here would
    // be this module deciding who an unattributable change runs as.
    const plan = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 0 }],
      members: [member({ createdBy: null })],
      now: NOW,
    });
    expect(plan.actions[0]?.createdBy).toBeNull();
  });

  it("ignores a member whose release is not in this pass", () => {
    // The same document may sit in a release scheduled for next month. That is
    // not an error and must not contribute a due instant.
    const plan = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 0 }],
      members: [
        member({ releaseId: "r1", action: "publish" }),
        member({ releaseId: "elsewhere", action: "unpublish" }),
      ],
      now: NOW,
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.effect).toBe("publish");
  });

  it("keeps each LANGUAGE of one document apart", () => {
    // Membership is per locale, so two languages of one entry are two actions
    // — grouping on the entry id alone would let one language's release decide
    // the other's, and silently drop one of the two writes.
    const plan = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 0 }],
      members: [
        member({ entryId: "e1", locale: "en" }),
        member({ entryId: "e1", locale: "de", action: "unpublish" }),
      ],
      now: NOW,
    });
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions.map(a => [a.ref.locale, a.effect]).sort()).toEqual([
      ["de", "unpublish"],
      ["en", "publish"],
    ]);
  });

  it("plans nothing for a release whose instant has NOT arrived", () => {
    // The control for every case above: a planner that ignored `now` would
    // publish the future.
    const plan = planReleaseMaterialisation({
      releases: [
        {
          id: "r1",
          scheduledAt: new Date("2099-01-01T00:00:00Z"),
          revision: 0,
        },
      ],
      members: [member()],
      now: NOW,
    });
    expect(plan.actions).toEqual([]);
    // The release is still discharged by this pass: it was read as due by the
    // caller, and reporting it separately is how a caller can tell "nothing to
    // do" from "not looked at".
    expect(plan.releaseIds).toEqual(["r1"]);
  });

  it("takes a document as applied only when its WINNER is marked for the current revision", () => {
    // Marked for revision 3 by the write of a pass that ended part-way; the
    // release still stands at 3, so this pass need not write it again.
    const marked = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 3 }],
      members: [member({ appliedRevision: 3 })],
      now: NOW,
    });
    expect(marked.actions[0]).toMatchObject({ revision: 3, applied: true });

    // The release has moved since (rescheduled, edited, a member changed), so
    // the mark is for a release that no longer stands as it did.
    const stale = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 4 }],
      members: [member({ appliedRevision: 3 })],
      now: NOW,
    });
    expect(stale.actions[0]).toMatchObject({ revision: 4, applied: false });

    // The control: never written.
    const unmarked = planReleaseMaterialisation({
      releases: [{ id: "r1", scheduledAt: JAN, revision: 3 }],
      members: [member()],
      now: NOW,
    });
    expect(unmarked.actions[0]?.applied).toBe(false);
  });

  it("does not take a LOSING member's mark as the winner's", () => {
    // The later release wins the document; the earlier one's member carries
    // a mark for its own revision, which says nothing of the winner's write.
    const plan = planReleaseMaterialisation({
      releases: [
        { id: "r1", scheduledAt: JAN, revision: 2 },
        { id: "r2", scheduledAt: FEB, revision: 5 },
      ],
      members: [
        member({ releaseId: "r1", action: "publish", appliedRevision: 2 }),
        member({ releaseId: "r2", action: "unpublish" }),
      ],
      now: NOW,
    });
    expect(plan.actions[0]).toMatchObject({
      releaseId: "r2",
      revision: 5,
      applied: false,
    });
  });
});
