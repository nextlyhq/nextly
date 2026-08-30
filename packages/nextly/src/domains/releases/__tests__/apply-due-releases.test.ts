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
  /** Make `markReleasePublished` answer `false`, as its fence does. */
  markRefuses?: boolean;
}): ApplyDueReleasesDeps {
  const releases = over.releases ?? [release()];
  const members = over.members ?? [member()];
  const blocked = vi.fn(async (_id: string, _at: Date) => true);
  return {
    // Pinned, so every case below observes a STABLE component order and asserts
    // about the mechanism it names rather than about which rotation came up.
    // The starvation case overrides it, because rotating is the thing it tests.
    random: () => 0,
    repository: {
      findDueReleases: async () => releases,
      // A spy, reached through the port with `vi.mocked` so a case can assert
      // WHICH releases the pass stopped. A stub returning true would let a pass
      // that blocked the wrong ones — or every one — look identical to a pass
      // that blocked exactly the hopeless.
      blockRelease: blocked,
      listMembersOf: async ids =>
        members.filter(m => ids.includes(m.releaseId)),
      isStillDueAt: async (id: string, scheduledAt: Date) =>
        over.cancelled !== id &&
        (over.rescheduledTo === undefined ||
          over.rescheduledTo.getTime() === scheduledAt.getTime()),
      markReleasePublished: async id => {
        over.marked?.push(id);
        // The fence answers `false` for a release an overlapping drain already
        // settled. Overridable so a fixture can build that case.
        return over.markRefuses !== true;
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

  it("STOPS starting actions once the deadline has passed", async () => {
    // The handler being written to fit a tick. The jobs runner cannot bound
    // this: `maxDurationMs` is checked before each CLAIM, so it bounds how many
    // JOBS a pass starts, not how long one already-running handler takes.
    const publish = vi.fn(async () => {});
    // A clock that advances a second per reading, so the deadline is crossed
    // deterministically rather than by wall time. The deadline sits BELOW the
    // first in-loop reading on purpose: `at = now()` consumes the first tick
    // before the loop, so a deadline above it would never be reached and this
    // case would pass for the wrong reason.
    let tick = 0;
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
      members: [
        member({ id: "a", releaseId: "r1", entryId: "e1" }),
        member({ id: "b", releaseId: "r2", entryId: "e2" }),
      ],
      mutations: { publish },
    });
    const result = await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 500),
    });

    expect(result.deferred).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("FINISHES a release it has started, even once the deadline has passed", async () => {
    // The starvation case, and the reason the budget bounds RELEASES rather than
    // actions. Bounded by action, a release with more actions than fit the
    // budget replays the same prefix on every tick — repeating its mutations,
    // hooks and outbox events — and never reaches the suffix, because the plan
    // is rebuilt from members each time and the order is stable. "One action
    // runs" is not progress.
    const publish = vi.fn(async () => {});
    let tick = 0;
    const d = deps({
      releases: [release({ id: "r1" })],
      members: [
        member({ id: "a", releaseId: "r1", entryId: "e1" }),
        member({ id: "b", releaseId: "r1", entryId: "e2" }),
        member({ id: "c", releaseId: "r1", entryId: "e3" }),
      ],
      mutations: { publish },
    });
    const result = await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 500),
    });

    // All three, despite the deadline passing after the first.
    expect(publish).toHaveBeenCalledTimes(3);
    expect(result.deferred).toBe(0);
  });

  it("does NOT discharge a release whose actions it never started", async () => {
    // The trap a naive cap walks into. An unattempted action leaves NO outcome,
    // and the discharge test reads outcomes — so without holding it open, the
    // release is marked published, loses its read-time projection, and loses
    // the members that never ran. A pass that reported success having done half
    // the work looks exactly like one that had less to do.
    const marked: string[] = [];
    let tick = 0;
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
      members: [
        member({ id: "a", releaseId: "r1", entryId: "e1" }),
        member({ id: "b", releaseId: "r2", entryId: "e2" }),
      ],
      marked,
    });
    await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 500),
    });

    // r1 was performed and may discharge; r2 was never started and must not.
    expect(marked).toEqual(["r1"]);
  });

  it("does not let a failing component starve the healthy ones", async () => {
    // Head-of-line blocking, and it needs no process kill. The first component
    // is exempt from the deadline — something must run — so with a stable order
    // a component whose action FAILS holds itself open and consumes the budget
    // on every tick, while the healthy releases behind it are deferred forever.
    // Each pass reports success.
    //
    // The passes are a FIXED 60-SECOND CADENCE apart, which is the shape a cron
    // actually has. A rotation derived from the pass instant repeats forever
    // whenever the period divides the component count — 30s, 60s and 300s all do
    // for two components — so a test advancing one second per pass would pass
    // against a fix that does nothing in production.
    const publish = vi.fn(async (input: { ref: { entryId: string } }) => {
      if (input.ref.entryId === "broken") throw new Error("refused");
    });
    // Deterministic stand-in for the random source, cycling the rotation.
    let call = 0;
    const rotations = [0, 0.5];
    const seen: string[][] = [];
    for (let pass = 0; pass < 2; pass += 1) {
      publish.mockClear();
      const at = new Date(NOW.getTime() + pass * 60_000);
      const d = deps({
        releases: [release({ id: "rBad" }), release({ id: "rGood" })],
        members: [
          member({ id: "x", releaseId: "rBad", entryId: "broken" }),
          member({ id: "y", releaseId: "rGood", entryId: "healthy" }),
        ],
        mutations: {
          publish:
            publish as unknown as ApplyDueReleasesDeps["mutations"]["publish"],
          // The read-back must not rescue the failed write, or the failure never
          // reaches the outcome and there is nothing to starve behind.
          applied: async () => false,
        },
      });
      await applyDueReleases({
        ...d,
        now: () => at,
        random: () => rotations[call++ % rotations.length],
        // Already spent, so only the exempt first component runs.
        deadline: new Date(at.getTime() - 60_000),
      });
      seen.push(publish.mock.calls.map(c => c[0].ref.entryId));
    }

    // The healthy document is reached on one of the two passes. Pinned to a
    // single rotation it is reached on neither, forever.
    expect(seen.flat()).toContain("healthy");
  });

  it("bounds an INTERLEAVED backlog to one release's work, not all of it", async () => {
    // The shape this guard is for, and the one it silently failed to bound. The
    // planner groups by DOCUMENT and emits in first-seen order, so members
    // alternating across releases yield `[r1, r2, r3, r1, r2, r3, …]`. In that
    // order starting a release costs ONE action, so every release is started
    // within the first pass over the documents, every later action belongs to a
    // started release, and the loop runs the whole remainder.
    //
    // The clock advances with WORK DONE, not with clock reads. A per-read clock
    // ticks once per component boundary either way, so it cannot tell the
    // grouped order from the interleaved one — which is exactly how the first
    // version of this test passed against both.
    const publish = vi.fn(async () => {});
    const d = deps({
      releases: [
        release({ id: "r1" }),
        release({ id: "r2" }),
        release({ id: "r3" }),
      ],
      members: [
        member({ id: "a1", releaseId: "r1", entryId: "e1" }),
        member({ id: "b1", releaseId: "r2", entryId: "e4" }),
        member({ id: "c1", releaseId: "r3", entryId: "e7" }),
        member({ id: "a2", releaseId: "r1", entryId: "e2" }),
        member({ id: "b2", releaseId: "r2", entryId: "e5" }),
        member({ id: "c2", releaseId: "r3", entryId: "e8" }),
        member({ id: "a3", releaseId: "r1", entryId: "e3" }),
        member({ id: "b3", releaseId: "r2", entryId: "e6" }),
        member({ id: "c3", releaseId: "r3", entryId: "e9" }),
      ],
      mutations: { publish },
    });
    const result = await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + publish.mock.calls.length * 1000),
      deadline: new Date(NOW.getTime() + 2500),
    });

    // r1's three actions and nothing else. Ungrouped, all three releases would
    // have started inside the budget and the loop would have run all nine.
    expect(publish).toHaveBeenCalledTimes(3);
    expect(result.deferred).toBe(6);
  });

  it("finishes a started release whose actions are NOT contiguous", async () => {
    // The planner groups by DOCUMENT and emits in first-seen document order, so
    // one release's actions can be interleaved with another's: `[r1, r2, r1]`.
    // A guard that BREAKS at the first unstarted release would defer the
    // trailing r1 too — leaving a release both started and unfinished, so the
    // next tick rebuilds the same plan, repeats the first r1 write, and stops in
    // the same place forever.
    const publish = vi.fn(async () => {});
    let tick = 0;
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
      members: [
        member({ id: "a", releaseId: "r1", entryId: "e1" }),
        member({ id: "b", releaseId: "r2", entryId: "e2" }),
        member({ id: "c", releaseId: "r1", entryId: "e3" }),
      ],
      mutations: { publish },
    });
    const result = await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 500),
    });

    // BOTH of r1's actions ran; only r2 was deferred.
    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.deferred).toBe(1);
  });

  it("reaches an applied component sitting BEHIND untouched ones", async () => {
    // The exemption for applied components is only reached when a group is. So
    // breaking out of finalization strands every applied component behind an
    // untouched one — and a stranded applied component is the replay the
    // exemption exists to prevent: its mutations, hooks and outbox writes all
    // run again on the next tick, while `deferred` reports zero.
    //
    // Two empty releases first, then the one this pass actually performed.
    const marked: string[] = [];
    let tick = 0;
    const d = deps({
      releases: [
        release({ id: "empty1" }),
        release({ id: "empty2" }),
        release({ id: "rApplied" }),
      ],
      members: [member({ id: "a", releaseId: "rApplied", entryId: "e1" })],
      marked,
    });
    const result = await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 1500),
    });

    // Reached despite the budget being spent on the empty ones before it.
    expect(marked).toContain("rApplied");
    // And what WAS skipped is reported — `deferred` cannot show it, because no
    // action was omitted.
    expect(result.deferred).toBe(0);
    expect(result.undischarged).toBeGreaterThan(0);
  });

  it("bounds discharging of releases it did NOT apply", async () => {
    // `plan.releaseIds` carries every due release "whether or not it contributed
    // a winner", so a release with no due members reaches finalization having
    // had no work done for it. A backlog of those is one serial write each, and
    // it is what the budget is for now that applied components are exempt.
    //
    // Counted by ATTEMPT, not success: `markReleasePublished` answers `false`
    // for a release an overlapping drain already settled, so gating on successes
    // leaves the counter at zero and the check never fires.
    const marked: string[] = [];
    let tick = 0;
    const d = deps({
      releases: [
        release({ id: "r1" }),
        release({ id: "empty1" }),
        release({ id: "empty2" }),
        release({ id: "empty3" }),
      ],
      // Only r1 has a due member; the rest contribute no action at all.
      members: [member({ id: "a", releaseId: "r1", entryId: "e1" })],
      marked,
      markRefuses: true,
    });
    await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 1500),
    });

    // r1 was applied so it is discharged regardless; the empty ones are bounded.
    expect(marked).toContain("r1");
    expect(marked.length).toBeLessThan(4);
  });

  it("ALWAYS discharges every component it applied, even past the deadline", async () => {
    // TWO applied components, because one cannot discriminate: the first is
    // always discharged whatever the clock says, so a single-component fixture
    // passes with or without the exemption.
    //
    // Leaving the second scheduled because the clock ran out makes the next tick
    // plan and perform its content mutation AGAIN — rerunning hooks and
    // appending outbox events for a write that already landed — while `deferred`
    // reports zero, because nothing was skipped. A truncated pass would look
    // clean and do the expensive half twice.
    //
    // The deadline sits between the action loop's clock read and finalization's
    // second, so both components are applied and the second would be dropped
    // without the exemption.
    const marked: string[] = [];
    let tick = 0;
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
      members: [
        member({ id: "a", releaseId: "r1", entryId: "e1" }),
        member({ id: "b", releaseId: "r2", entryId: "e2" }),
      ],
      marked,
    });
    await applyDueReleases({
      ...d,
      now: () => new Date(NOW.getTime() + tick++ * 1000),
      deadline: new Date(NOW.getTime() + 2500),
    });

    expect(marked).toEqual(["r1", "r2"]);
  });

  it("makes progress even when the budget is already spent", async () => {
    // A budget too small for a single action must still move, or a backlog
    // stalls forever while every pass reports success.
    const publish = vi.fn(async () => {});
    const d = deps({ mutations: { publish } });
    const result = await applyDueReleases({
      ...d,
      now: () => NOW,
      deadline: new Date(NOW.getTime() - 60_000),
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.deferred).toBe(0);
  });

  it("defers nothing when no deadline is set — the control", async () => {
    // Absent means unbounded, which is right for a CLI and a test. A deadline
    // that applied by default would make every case above pass while silently
    // truncating ordinary passes.
    const publish = vi.fn(async () => {});
    const d = deps({
      releases: [release({ id: "r1" }), release({ id: "r2" })],
      members: [
        member({ id: "a", releaseId: "r1", entryId: "e1" }),
        member({ id: "b", releaseId: "r2", entryId: "e2" }),
      ],
      mutations: { publish },
    });
    const result = await applyDueReleases(d);

    expect(result.deferred).toBe(0);
    expect(publish).toHaveBeenCalledTimes(2);
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

describe("a release nothing about retrying could fix is STOPPED", () => {
  /** The releases this pass moved to `blocked`. */
  function blockedBy(d: ReturnType<typeof deps>): string[] {
    return vi.mocked(d.repository.blockRelease).mock.calls.map(call => call[0]);
  }

  it("blocks a member whose author was never recorded", async () => {
    // Left scheduled it is replanned every tick forever, and reads as healthy
    // the whole time — the operator learns nothing until the launch does not
    // happen.
    const d = deps({ members: [member({ createdBy: null })] });
    const result = await applyDueReleases(d);
    expect(blockedBy(d)).toEqual(["r1"]);
    expect(result.blocked).toBe(1);
  });

  it("blocks a member whose author has been DEACTIVATED", async () => {
    // Found by breaking the classifier: with `AUTHOR_UNAVAILABLE` reclassified
    // as retryable, the whole suite stayed green — so the commonest permanent
    // failure of the three had no coverage at all. A departed colleague is the
    // ordinary way a release becomes unrunnable.
    const d = deps({
      runAs: { findUser: async id => ({ id, isActive: false }) },
    });
    const result = await applyDueReleases(d);
    expect(blockedBy(d)).toEqual(["r1"]);
    expect(result.blocked).toBe(1);
  });

  it("blocks a locale-scoped member", async () => {
    const d = deps({ members: [member({ locale: "de" })] });
    await applyDueReleases(d);
    expect(blockedBy(d)).toEqual(["r1"]);
  });

  it("does NOT block when the write merely failed", async () => {
    // The control that carries the whole design. "Refused or errored" covers a
    // dropped connection as well as a permission nobody will ever gain, and the
    // two are indistinguishable here — so a momentary blip must not permanently
    // halt a launch the next pass would have completed.
    // The fixture's own way to say the write did not land, per its comment.
    const d = deps({ mutations: { applied: async () => false } });
    const result = await applyDueReleases(d);
    // It still FAILED — the release is held open and retried, which is the
    // point. It is simply not stopped.
    expect(result.failed).toBeGreaterThan(0);
    expect(blockedBy(d)).toEqual([]);
    expect(result.blocked).toBe(0);
  });

  it("fences the block on the instant the pass PLANNED against", async () => {
    // An editor who postpones a due release between the plan and this write
    // leaves the row in `scheduled`, so a state-only predicate would match and
    // replace the schedule they just chose with `blocked`. The release would
    // then never run at the replacement instant, and nothing would say why.
    const d = deps({ members: [member({ createdBy: null })] });
    await applyDueReleases(d);
    const call = vi.mocked(d.repository.blockRelease).mock.calls[0];
    expect(call?.[1]).toBeInstanceOf(Date);
    expect(call?.[1]?.getTime()).toBe(release().scheduledAt?.getTime());
  });

  it("blocks nothing when every member applies", async () => {
    // The other control: without it, a pass that blocked everything it touched
    // would satisfy the two positive cases above.
    const d = deps({});
    const result = await applyDueReleases(d);
    expect(blockedBy(d)).toEqual([]);
    expect(result.blocked).toBe(0);
  });
});
