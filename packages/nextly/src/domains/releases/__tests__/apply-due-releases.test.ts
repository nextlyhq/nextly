/**
 * The pass that turns a due release into real published content.
 *
 * The cases worth exercising exhaustively are the access boundary and the
 * partial-failure behaviour: everything else here produces a release that did
 * not publish, while these produce one that published AS THE WRONG PERSON or
 * discharged without having happened.
 *
 * @module domains/releases/__tests__/apply-due-releases.test
 */
import { describe, expect, it, vi } from "vitest";

import { applyDueReleases } from "../apply-due-releases";
import type { ApplyDueReleasesDeps } from "../apply-due-releases";
import type { ReleaseMemberRow, ReleaseRow } from "../releases-repository";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

function release(over: Partial<ReleaseRow> = {}): ReleaseRow {
  return {
    id: "r1",
    title: "Go live",
    description: null,
    scheduledAt: PAST,
    timezone: "UTC",
    state: "scheduled",
    publishedAt: null,
    createdBy: "author",
    createdAt: PAST,
    updatedAt: PAST,
    revision: 0,
    ...over,
  };
}

let seq = 0;
function member(over: Partial<ReleaseMemberRow> = {}): ReleaseMemberRow {
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
    createdBy: "author",
    createdAt: PAST,
    ...over,
  };
}

function deps(over: {
  releases?: ReleaseRow[];
  members?: ReleaseMemberRow[];
  runAs?: Partial<ApplyDueReleasesDeps["runAs"]>;
  mutations?: Partial<ApplyDueReleasesDeps["mutations"]>;
  marked?: string[];
  /** A release cancelled between the drain reading it and acting on it. */
  cancelled?: string;
  /** A release POSTPONED after the plan was built: still scheduled, new instant. */
  rescheduledTo?: Date;
}): ApplyDueReleasesDeps {
  const releases = over.releases ?? [release()];
  const members = over.members ?? [member()];
  return {
    repository: {
      findDueReleases: async () => releases,
      listMembersOf: async ids =>
        members.filter(m => ids.includes(m.releaseId)),
      isStillDueAt: async (id: string, scheduledAt: Date) =>
        over.cancelled !== id &&
        (over.rescheduledTo === undefined ||
          over.rescheduledTo.getTime() === scheduledAt.getTime()),
      markReleasePublished: async id => {
        over.marked?.push(id);
        return true;
      },
    },
    mutations: {
      publish: async () => {},
      unpublish: async () => {},
      // Default: the write did what it said. Both the rejection path and the
      // success path consult this, so a default of `false` would mean "every
      // ordinary write silently failed" — the cases that want a write NOT to
      // have landed override it explicitly.
      applied: async () => true,
      ...over.mutations,
    },
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => ["editor"],
      ...over.runAs,
    },
    now: () => NOW,
  };
}

describe("applyDueReleases", () => {
  it("publishes a due member AS ITS AUTHOR, not as a system principal", async () => {
    // The whole access boundary. Running this as a trusted principal would let
    // a release publish content its author could not have published by hand —
    // "schedule this" would become a privilege escalation with a delay on it.
    // The parameter is DECLARED, not inferred: `vi.fn(async () => ...)`
    // types `mock.calls` as an empty tuple, so reading `calls[0][0]` is a
    // type error that only the test-tree pass of `check-types` reports.
    const publish = vi.fn(
      async (_input: { ref: unknown; user: unknown }) => {}
    );
    const result = await applyDueReleases(
      deps({ members: [member({ createdBy: "u1" })], mutations: { publish } })
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      user: expect.objectContaining({ id: "u1", roles: ["editor"] }),
    });
    expect(result).toMatchObject({ applied: 1, failed: 0, published: 1 });
  });

  it("REFUSES a member with no recorded author rather than picking one", async () => {
    // There is nobody to act as, and the only fallback available is exactly
    // the principal this module exists to refuse.
    const publish = vi.fn(
      async (_input: { ref: unknown; user: unknown }) => {}
    );
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({
        members: [member({ createdBy: null })],
        mutations: { publish },
        marked,
      })
    );

    expect(publish).not.toHaveBeenCalled();
    expect(result.outcomes[0]?.failure).toBe("NO_RECORDED_AUTHOR");
    // And the release is held open, not discharged.
    expect(marked).toEqual([]);
    expect(result.published).toBe(0);
  });

  it("REFUSES a member whose author has been deactivated", async () => {
    // Authority that was withdrawn stays withdrawn; a release scheduled while
    // somebody still had an account does not resurrect it.
    const publish = vi.fn(
      async (_input: { ref: unknown; user: unknown }) => {}
    );
    const result = await applyDueReleases(
      deps({
        mutations: { publish },
        runAs: { findUser: async id => ({ id, isActive: false }) },
      })
    );

    expect(publish).not.toHaveBeenCalled();
    expect(result.outcomes[0]?.failure).toBe("AUTHOR_UNAVAILABLE");
  });

  it("distinguishes a LOOKUP FAILURE from an author who is gone", async () => {
    // A transient database error is not evidence that anybody was deleted.
    // Collapsing the two would permanently refuse a release because the RBAC
    // tables were briefly unreachable.
    const result = await applyDueReleases(
      deps({
        runAs: {
          findUser: async () => {
            throw new Error("rbac unreachable");
          },
        },
      })
    );

    expect(result.outcomes[0]?.failure).toBe("IDENTITY_LOOKUP_FAILED");
    expect(result.outcomes[0]?.detail).toContain("rbac unreachable");
  });

  it("holds a release OPEN when any of its members failed", async () => {
    // Marking it published would discharge a release that did not fully happen:
    // the read path stops consulting a non-scheduled release, so the unapplied
    // member would vanish from the content AND the schedule at once.
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({
        members: [
          member({ entryId: "e1", createdBy: "u1" }),
          member({ entryId: "e2", createdBy: null }),
        ],
        marked,
      })
    );

    expect(result).toMatchObject({ applied: 1, failed: 1, published: 0 });
    expect(marked).toEqual([]);
  });

  it("marks a release published once everything attributed to it succeeded", async () => {
    // The control for the case above: an implementation that never discharged
    // a release would satisfy it while leaving every release scheduled forever.
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({ members: [member(), member({ entryId: "e2" })], marked })
    );

    expect(marked).toEqual(["r1"]);
    expect(result.published).toBe(1);
  });

  it("attempts EVERY action even after one fails", async () => {
    // One unresolvable author must not stop every other release on the site.
    // Nobody is watching at 03:00, and "nothing was published" reads exactly
    // like "nothing was due".
    const publish = vi.fn(async (input: { ref: { entryId: string } }) => {
      if (input.ref.entryId === "e1") throw new Error("refused");
    });
    const result = await applyDueReleases(
      deps({
        members: [
          member({ entryId: "e1" }),
          member({ entryId: "e2" }),
          member({ entryId: "e3" }),
        ],
        mutations: {
          publish,
          // The refused write genuinely did not land; the other two did.
          applied: async ({ ref }) => ref.entryId !== "e1",
        },
      })
    );

    expect(publish).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ applied: 2, failed: 1 });
    expect(result.outcomes.find(o => o.ref.entryId === "e1")?.failure).toBe(
      "WRITE_FAILED"
    );
  });

  it("REFUSES to write for a release cancelled after the pass began", async () => {
    // The fence on `markReleasePublished` comes too late: it stops the row
    // being marked published and cannot un-publish the documents. Without a
    // check before the write, calling a release off while its own drain is
    // running still puts its content live — permanently.
    const publish = vi.fn(async () => {});
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({ mutations: { publish }, cancelled: "r1", marked })
    );

    expect(publish).not.toHaveBeenCalled();
    expect(result.outcomes[0]?.failure).toBe("RELEASE_NO_LONGER_SCHEDULED");
    expect(marked).toEqual([]);
  });

  it("REFUSES to write for a release POSTPONED after the plan was built", async () => {
    // A reschedule leaves the release `scheduled`, so a fence that reads only
    // the STATE sees nothing wrong and the stale plan applies immediately —
    // publishing content at the very moment somebody moved it away from. The
    // instant the plan was built against has to be part of the fence.
    const publish = vi.fn(async () => {});
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({
        mutations: { publish },
        rescheduledTo: new Date("2099-01-01T00:00:00.000Z"),
        marked,
      })
    );

    expect(publish).not.toHaveBeenCalled();
    expect(result.outcomes[0]?.failure).toBe("RELEASE_NO_LONGER_SCHEDULED");
    expect(marked).toEqual([]);
  });

  it("records publishedAt from a FRESH clock, not the pass's start", async () => {
    // `publishedAt` is defined as the moment materialisation completed, and the
    // pass's `at` is captured before members are loaded, identities resolved and
    // every content mutation run. On a slow pass that difference is real.
    // A clock that advances a minute on every read, rather than a fixed
    // sequence: asserting a specific tick would pin how many times the pass
    // happens to ask the time, which is not the property under test.
    const stamps: Date[] = [];
    let reads = 0;
    const clock = (): Date =>
      new Date(
        new Date("2026-06-01T00:00:00.000Z").getTime() + reads++ * 60_000
      );

    const d = deps({});
    const passStart = new Date("2026-06-01T00:00:00.000Z");
    await applyDueReleases({
      ...d,
      now: clock,
      repository: {
        ...d.repository,
        markReleasePublished: async (_id: string, at: Date) => {
          stamps.push(at);
          return true;
        },
      },
    });

    expect(stamps).toHaveLength(1);
    // Strictly LATER than the pass began — which is only true if the stamp is
    // read at the transition rather than carried from the top of the pass.
    expect(stamps[0]!.getTime()).toBeGreaterThan(passStart.getTime());
  });

  it("still writes for a release that is STILL scheduled", async () => {
    // The control. A check that refused everything would satisfy the case above
    // while making the materialiser inert.
    const publish = vi.fn(async () => {});
    await applyDueReleases(deps({ mutations: { publish } }));

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("holds an OVERLAPPING release open when its partner failed", async () => {
    // The reversal this prevents: an earlier release publishes a document and a
    // later one withdraws it, both due. The later wins and the document is
    // withdrawn. If the later were then marked published while the earlier
    // stayed scheduled — held open by an unrelated member's failure — the NEXT
    // pass would not load the later release at all, so the earlier would win
    // for that document and republish what was correctly withdrawn.
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({
        releases: [
          release({ id: "r1", scheduledAt: PAST }),
          release({
            id: "r2",
            scheduledAt: new Date("2026-02-01T00:00:00.000Z"),
          }),
        ],
        members: [
          // The shared document: r2 wins and is applied.
          member({ releaseId: "r1", entryId: "shared", action: "publish" }),
          member({ releaseId: "r2", entryId: "shared", action: "unpublish" }),
          // An unrelated member of r1 that fails, holding r1 open.
          member({ releaseId: "r1", entryId: "other", createdBy: null }),
        ],
        marked,
      })
    );

    expect(result.failed).toBe(1);
    // NEITHER is discharged: r1 failed, and r2 shares a document with it.
    expect(marked).toEqual([]);
  });

  it("discharges releases that share NO document independently", async () => {
    // The control. Holding every release open whenever any release failed
    // would satisfy the case above while making one bad member stall the whole
    // schedule indefinitely.
    const marked: string[] = [];
    await applyDueReleases(
      deps({
        releases: [
          release({ id: "r1", scheduledAt: PAST }),
          release({ id: "r2", scheduledAt: PAST }),
        ],
        members: [
          member({ releaseId: "r1", entryId: "a", createdBy: null }),
          member({ releaseId: "r2", entryId: "b" }),
        ],
        marked,
      })
    );

    expect(marked).toEqual(["r2"]);
  });

  it("treats a COMMITTED write whose hook threw as applied, not as failed", async () => {
    // `updateEntry` commits the row and its outbox event before running
    // `afterUpdate` hooks, so a hook that throws rejects the promise for a write
    // that already persisted. Recording that as a failure leaves the release
    // scheduled, and every later sweep repeats the update, appends another
    // event and reruns the hooks — indefinitely. The thrown error cannot say
    // whether the transaction committed; reading the document back can.
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({
        mutations: {
          publish: async () => {
            throw new Error("afterUpdate exploded");
          },
          applied: async () => true,
        },
        marked,
      })
    );

    expect(result).toMatchObject({ applied: 1, failed: 0 });
    // And the release is discharged, so no later pass repeats it.
    expect(marked).toEqual(["r1"]);
  });

  it("still reports a write that genuinely did NOT land", async () => {
    // The control. Treating every rejection as applied would satisfy the case
    // above while silently losing every real failure.
    const result = await applyDueReleases(
      deps({
        mutations: {
          publish: async () => {
            throw new Error("refused");
          },
          applied: async () => false,
        },
      })
    );

    expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
  });

  it("REFUSES a write that RESOLVED without applying the status", async () => {
    // A `beforeUpdate`/`beforeChange` hook may remove or rewrite `status`, and
    // the ordinary mutation then succeeds having done nothing. Reporting that
    // as complete discharges the release, removes its read-time projection, and
    // loses the scheduled action permanently — the failure here that leaves no
    // trace at all. A resolved promise is not proof the action was applied.
    const marked: string[] = [];
    const result = await applyDueReleases(
      deps({
        mutations: {
          publish: async () => {}, // resolves, but the hook ate the status
          applied: async () => false,
        },
        marked,
      })
    );

    expect(result).toMatchObject({ applied: 0, failed: 1 });
    expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
    // Held open, so the next sweep retries rather than the action vanishing.
    expect(marked).toEqual([]);
  });

  it("asks nothing of the database when no release is due", async () => {
    const listMembersOf = vi.fn(async () => []);
    const d = deps({ releases: [] });
    const result = await applyDueReleases({
      ...d,
      repository: { ...d.repository, listMembersOf },
    });

    expect(listMembersOf).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: 0, published: 0, applied: 0 });
  });

  it("loads the members of EVERY due release in one query", async () => {
    // The regression this guards is latency, not an answer: asking per release
    // put one serial round trip per due release in front of the first content
    // mutation. Counting the calls is the only way to observe that, because
    // both shapes return the same members and every later assertion passes
    // either way.
    const listMembersOf = vi.fn(async (ids: string[]) =>
      // DISTINCT documents. Two members of one document collapse to a single
      // winning action, and the count assertion below would then pass on an
      // implementation that had loaded only one release's members.
      [
        member({ releaseId: "r1", entryId: "e1" }),
        member({ releaseId: "r2", entryId: "e2" }),
      ].filter(m => ids.includes(m.releaseId))
    );
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
    });
    const result = await applyDueReleases({
      ...d,
      repository: { ...d.repository, listMembersOf },
    });

    expect(listMembersOf).toHaveBeenCalledTimes(1);
    expect(listMembersOf).toHaveBeenCalledWith(["r1", "r2"]);
    expect(result).toMatchObject({ due: 2, applied: 2, failed: 0 });
  });

  it("records a failed schedule check and STILL applies the other actions", async () => {
    // The per-action "is this still scheduled?" read is an ordinary database
    // read on the ordinary path. Unwrapped, one transient failure on the first
    // action aborted the whole pass — every later action and every unrelated
    // due release skipped, which reads exactly like nothing having been due.
    const publish = vi.fn(async () => {});
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
      members: [
        member({ id: "bad", releaseId: "r1", entryId: "e1" }),
        member({ id: "good", releaseId: "r2", entryId: "e2" }),
      ],
      mutations: { publish },
    });
    const result = await applyDueReleases({
      ...d,
      repository: {
        ...d.repository,
        isStillDueAt: async (id: string) => {
          if (id === "r1") throw new Error("connection reset");
          return true;
        },
      },
    });

    expect(result).toMatchObject({ due: 2, applied: 1, failed: 1 });
    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "bad",
          failure: "SCHEDULE_CHECK_FAILED",
          detail: "connection reset",
        }),
        expect.objectContaining({ memberId: "good", failure: null }),
      ])
    );
    // The action that could not be checked is not evidence of cancellation, so
    // its release is held open for the next pass.
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("applies the WINNER when a document sits in two due releases", async () => {
    // Publish then unpublish, both due. The pass must reach one final state,
    // and it must be the same one the read path reports.
    const publish = vi.fn(
      async (_input: { ref: unknown; user: unknown }) => {}
    );
    const unpublish = vi.fn(async () => {});
    await applyDueReleases(
      deps({
        releases: [
          release({ id: "r1", scheduledAt: PAST }),
          release({
            id: "r2",
            scheduledAt: new Date("2026-02-01T00:00:00.000Z"),
          }),
        ],
        members: [
          member({ releaseId: "r1", action: "publish" }),
          member({ releaseId: "r2", action: "unpublish" }),
        ],
        mutations: { publish, unpublish },
      })
    );

    expect(publish).not.toHaveBeenCalled();
    expect(unpublish).toHaveBeenCalledTimes(1);
  });
  it("REFUSES a locale-scoped member instead of half-performing it", async () => {
    // The read seam answers document-wide members only: `findDueDecisions`
    // filters `locale IS NULL`, because per-locale lifecycle lives on the
    // companion's `_status` and the main row it filters cannot express it.
    //
    // Performing the write anyway would apply an effect the read path refuses
    // to project, AND the success check could not observe it: a read at a
    // locale returns the MAIN row's status, so a per-locale unpublish that
    // COMMITTED reads back unchanged, is reported WRITE_FAILED, and replays its
    // hooks and outbox events on every drain forever.
    const publish = vi.fn(async () => {});
    const unpublish = vi.fn(async () => {});

    const result = await applyDueReleases(
      deps({
        members: [member({ locale: "de", action: "publish" })],
        mutations: { publish, unpublish },
      })
    );

    expect(result.outcomes).toMatchObject([
      { failure: "LOCALE_SCOPE_UNSUPPORTED" },
    ]);
    // Refused, not attempted: a write nothing can verify must not happen.
    expect(publish).not.toHaveBeenCalled();
    expect(unpublish).not.toHaveBeenCalled();
  });

  it("still performs a DOCUMENT-WIDE member on the same pass", async () => {
    // The control. A guard that refused everything would satisfy the case
    // above while disabling materialisation entirely.
    const publish = vi.fn(async () => {});

    const result = await applyDueReleases(
      deps({
        members: [member({ locale: null, action: "publish" })],
        mutations: { publish },
      })
    );

    expect(result).toMatchObject({ applied: 1, failed: 0 });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
