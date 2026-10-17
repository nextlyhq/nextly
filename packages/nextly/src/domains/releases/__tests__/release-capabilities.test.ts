/**
 * What the server tells a client it may do to a release.
 *
 * This exists because the answer needs BOTH halves — the release's state and the
 * caller's authority — and a client holds only the first. The failure being
 * guarded is asymmetric and quiet: a verdict WIDER than the fence produces a
 * refusal an editor can see, while a NARROWER one silently removes product. The
 * screen this replaced offered scheduling only from `draft`, so a committed
 * instant could not be moved and a cancelled launch could not be reinstated,
 * and nothing failed to say so.
 *
 * @module domains/releases/__tests__/release-capabilities.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  RELEASE_STATES,
  type ReleaseKind,
  type ReleaseState,
} from "../../../schemas/releases/types";
import { ReleasesService } from "../services/releases-service";
import type {
  ReleaseAuthority,
  ReleasesServiceDeps,
} from "../services/releases-service";
import { READY_CHECKS } from "./helpers/ready-checks";

const ACTOR = { userId: "u1" };

/**
 * @param members what each release holds, by release id. Read through the
 *   batched `listMembersOf` only; every other repository method is absent, so a
 *   path that reached one would fail rather than pass by accident.
 */
function service(
  holds: ReleaseAuthority[],
  members: Record<string, number> = {}
) {
  const held = new Set(holds);
  const canManageReleases = vi.fn(
    async (_id: string, authority: ReleaseAuthority) => held.has(authority)
  );
  const listMembersOf = vi.fn(async (ids: string[]) =>
    ids.flatMap(releaseId =>
      Array.from({ length: members[releaseId] ?? 0 }, (_, n) => ({
        id: `${releaseId}-m${n}`,
        releaseId,
      }))
    )
  );
  const deps = {
    repository: {
      listMembersOf,
    } as unknown as ReleasesServiceDeps["repository"],
    canManageReleases,
    canActOnDocument: vi.fn(async () => true),
    // Running a release is not what these cases are about.
    runDrainNow: vi.fn(async () => undefined),
    checks: READY_CHECKS,
    // Every target is there and has a lifecycle; the checks have their own tests.
    targets: {
      readDocument: async (target: { entryId: string }) => ({
        id: target.entryId,
      }),
      declaresLifecycle: async () => true,
    },
  };
  return { svc: new ReleasesService(deps), canManageReleases, listMembersOf };
}

/** A row carrying only what `capabilities` reads, so nothing else can decide it. */
function release(state: ReleaseState, id = "r1", kind?: ReleaseKind) {
  return { id, state, ...(kind ? { kind } : {}) } as Parameters<
    ReleasesService["capabilities"]
  >[0][number];
}

const ALL = ["read", "create", "publish"] as ReleaseAuthority[];

describe("capabilities, for a caller holding everything", () => {
  it("allows scheduling from the states the fence admits, and not a cancelled one", async () => {
    const { svc } = service(ALL);
    const can = await svc.capabilities(
      [
        release("draft", "a"),
        release("scheduled", "b"),
        release("cancelled", "c"),
      ],
      ACTOR
    );
    expect(can.get("a")?.schedule).toBe(true);
    // An instant can be MOVED, which the version this replaced could not do.
    expect(can.get("b")?.schedule).toBe(true);
    // A cancelled release is final, like a published one: it is retried by
    // making a new release, so the list of finished launches stays true.
    expect(can.get("c")?.schedule).toBe(false);
  });

  it("refuses scheduling a published release", async () => {
    // The one exclusion, and it is not caution: re-scheduling would make the
    // drain re-apply members against documents that have changed since.
    const { svc } = service(ALL);
    const can = await svc.capabilities([release("published")], ACTOR);
    expect(can.get("r1")?.schedule).toBe(false);
  });

  it("allows cancelling a DRAFT, because that is how one is abandoned", async () => {
    // There is no delete route, so a draft that could not be cancelled would
    // stay in the list forever.
    const { svc } = service(ALL);
    const can = await svc.capabilities([release("draft")], ACTOR);
    expect(can.get("r1")?.cancel).toBe(true);
  });

  it("refuses cancelling one already published or cancelled", async () => {
    const { svc } = service(ALL);
    const can = await svc.capabilities(
      [release("published", "a"), release("cancelled", "b")],
      ACTOR
    );
    expect(can.get("a")?.cancel).toBe(false);
    expect(can.get("b")?.cancel).toBe(false);
  });
});

describe("capabilities, and the authority half", () => {
  it("withholds scheduling from a caller without publish, whatever the state", async () => {
    // The half a client cannot see. Same rows, same states, different verdict.
    const { svc } = service(["read", "create"]);
    const can = await svc.capabilities(
      [release("draft", "a"), release("scheduled", "b")],
      ACTOR
    );
    expect(can.get("a")?.schedule).toBe(false);
    expect(can.get("b")?.cancel).toBe(false);
  });

  it("lets a mere assembler edit a draft's contents but not a scheduled one's", async () => {
    // The distinction that makes this worth computing server-side at all: the
    // drain reads membership AT the instant, so editing a scheduled release
    // changes what a publisher committed to and costs the publish authority.
    const { svc } = service(["read", "create"]);
    const can = await svc.capabilities(
      [release("draft", "a"), release("scheduled", "b")],
      ACTOR
    );
    expect(can.get("a")?.addMember).toBe(true);
    expect(can.get("b")?.addMember).toBe(false);
  });

  it("lets a publisher edit a scheduled release's contents", async () => {
    const { svc } = service(ALL);
    const can = await svc.capabilities([release("scheduled")], ACTOR);
    expect(can.get("r1")?.addMember).toBe(true);
  });

  it("closes membership once published, for everyone", async () => {
    const { svc } = service(ALL);
    const can = await svc.capabilities([release("published")], ACTOR);
    expect(can.get("r1")?.addMember).toBe(false);
    expect(can.get("r1")?.removeMember).toBe(false);
  });

  // The refusal case that used to sit here asserted that `create` and `publish`
  // without `read` were refused. That is deliberately no longer true —
  // assembling or scheduling implies reading — and the refusal is covered by
  // "still refuses a caller holding none of the three" below, alongside the
  // control that reading does not imply writing.
});

describe("capabilities, as an instrument", () => {
  it("answers once per AUTHORITY, not once per release", async () => {
    // A per-row loop would turn a page of releases into a permission read each.
    // Asserted on the CALL COUNT of the dependency rather than on timing, so it
    // fails when someone moves the lookup inside the map.
    const { svc, canManageReleases } = service(ALL);
    const rows = RELEASE_STATES.map((state, n) => release(state, `r${n}`));
    await svc.capabilities([...rows, ...rows, ...rows], ACTOR);
    // `read` for the authorize, then `publish` and `create` once each.
    expect(canManageReleases.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("asks nothing at all for an empty page", async () => {
    const { svc, canManageReleases } = service(ALL);
    const can = await svc.capabilities([], ACTOR);
    expect(can.size).toBe(0);
    // Only the read authorization; no publish or create lookup for no rows.
    expect(canManageReleases.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("covers every state the engine declares", () => {
    // A control on the cases above: they name four states by hand, and this
    // fails if the engine gains a fifth that none of them exercises.
    expect(RELEASE_STATES).toEqual([
      "draft",
      "scheduled",
      "published",
      "cancelled",
      "blocked",
    ]);
  });

  it("treats a BLOCKED release as fixable rather than finished", async () => {
    // The whole point of the state: an operator removes the member whose author
    // is gone and reschedules. A blocked release nobody could edit or
    // reschedule would be a dead end whose only exit is abandoning it.
    const { svc } = service(ALL);
    const can = await svc.capabilities([release("blocked")], ACTOR);
    expect(can.get("r1")?.addMember).toBe(true);
    expect(can.get("r1")?.removeMember).toBe(true);
    expect(can.get("r1")?.schedule).toBe(true);
    expect(can.get("r1")?.cancel).toBe(true);
  });
});

describe("reading, and what implies it", () => {
  it("lets an assembler read releases without a read grant of its own", async () => {
    // The three permissions are seeded independently. A role given only
    // `create` can create a release through the API, and without this it could
    // then see nothing — not the list, not the release it just made. That is a
    // grant promising something the product cannot deliver.
    const { svc } = service(["create"]);
    const can = await svc.capabilities([release("draft")], ACTOR);
    expect(can.get("r1")?.addMember).toBe(true);
  });

  it("lets a publisher read them too", async () => {
    const { svc } = service(["publish"]);
    const can = await svc.capabilities([release("scheduled")], ACTOR);
    expect(can.get("r1")?.schedule).toBe(true);
  });

  it("does NOT let reading imply writing", async () => {
    // One direction only, and this is the control that matters: an implication
    // written symmetrically would hand every reader the ability to schedule.
    const { svc } = service(["read"]);
    const can = await svc.capabilities([release("draft")], ACTOR);
    expect(can.get("r1")?.schedule).toBe(false);
    expect(can.get("r1")?.cancel).toBe(false);
    expect(can.get("r1")?.addMember).toBe(false);
  });

  it("still refuses a caller holding none of the three", async () => {
    const { svc } = service([]);
    await expect(
      svc.capabilities([release("draft")], ACTOR)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("capabilities, for a single-document release", () => {
  // Each case pairs the single release with an ORDINARY one in the same state
  // holding the same number of documents: a verdict that ignored the kind, or
  // one that refused every release in that state, would fail the pair.

  it("withholds scheduling while it holds no document", async () => {
    const { svc } = service(ALL, {});
    const can = await svc.capabilities(
      [release("draft", "s", "single"), release("draft", "o", "release")],
      ACTOR
    );
    expect(can.get("s")?.schedule).toBe(false);
    expect(can.get("o")?.schedule).toBe(true);
  });

  it("offers scheduling once it holds its document", async () => {
    const { svc } = service(ALL, { s: 1 });
    const can = await svc.capabilities(
      [release("draft", "s", "single")],
      ACTOR
    );
    expect(can.get("s")?.schedule).toBe(true);
  });

  it("withholds adding a second document", async () => {
    const { svc } = service(ALL, { s: 1, o: 1 });
    const can = await svc.capabilities(
      [release("draft", "s", "single"), release("draft", "o", "release")],
      ACTOR
    );
    expect(can.get("s")?.addMember).toBe(false);
    expect(can.get("o")?.addMember).toBe(true);
    // Taking the one it holds out of a draft is still how it is changed.
    expect(can.get("s")?.removeMember).toBe(true);
  });

  it("offers adding while it is empty", async () => {
    const { svc } = service(ALL, {});
    const can = await svc.capabilities(
      [release("draft", "s", "single")],
      ACTOR
    );
    expect(can.get("s")?.addMember).toBe(true);
  });

  it("withholds removing its document once scheduled, even from a publisher", async () => {
    // Removing it would leave a launch that runs with nothing. Cancelling is
    // the way to call it off.
    const { svc } = service(ALL, { s: 1, o: 1 });
    const can = await svc.capabilities(
      [
        release("scheduled", "s", "single"),
        release("scheduled", "o", "release"),
      ],
      ACTOR
    );
    expect(can.get("s")?.removeMember).toBe(false);
    expect(can.get("o")?.removeMember).toBe(true);
    expect(can.get("s")?.cancel).toBe(true);
  });

  it("reads what single releases hold in ONE query, and nothing for ordinary ones", async () => {
    const { svc, listMembersOf } = service(ALL, { s1: 1 });
    await svc.capabilities(
      [
        release("draft", "s1", "single"),
        release("draft", "s2", "single"),
        release("draft", "o1", "release"),
        release("scheduled", "o2", "release"),
      ],
      ACTOR
    );
    expect(listMembersOf).toHaveBeenCalledTimes(1);
    expect(listMembersOf).toHaveBeenCalledWith(["s1", "s2"]);

    listMembersOf.mockClear();
    await svc.capabilities(
      [release("draft", "o1", "release"), release("draft", "o2")],
      ACTOR
    );
    expect(listMembersOf).not.toHaveBeenCalled();
  });
});
