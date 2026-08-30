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
  type ReleaseState,
} from "../../../schemas/releases/types";
import { ReleasesService } from "../services/releases-service";
import type {
  ReleaseAuthority,
  ReleasesServiceDeps,
} from "../services/releases-service";

const ACTOR = { userId: "u1" };

function service(holds: ReleaseAuthority[]) {
  const held = new Set(holds);
  const canManageReleases = vi.fn(
    async (_id: string, authority: ReleaseAuthority) => held.has(authority)
  );
  const deps = {
    repository: {} as ReleasesServiceDeps["repository"],
    canManageReleases,
    canActOnDocument: vi.fn(async () => true),
  };
  return { svc: new ReleasesService(deps), canManageReleases };
}

/** A row carrying only what `capabilities` reads, so nothing else can decide it. */
function release(state: ReleaseState, id = "r1") {
  return { id, state } as Parameters<
    ReleasesService["capabilities"]
  >[0][number];
}

const ALL = ["read", "create", "publish"] as ReleaseAuthority[];

describe("capabilities, for a caller holding everything", () => {
  it("allows scheduling from every state the fence admits, not only draft", async () => {
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
    // An instant can be MOVED, and a cancelled launch reinstated. Both were
    // impossible in the version this replaced.
    expect(can.get("b")?.schedule).toBe(true);
    expect(can.get("c")?.schedule).toBe(true);
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

  it("refuses the whole question to a caller who may not read", async () => {
    const { svc } = service(["create", "publish"]);
    await expect(
      svc.capabilities([release("draft")], ACTOR)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
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
    ]);
  });
});
