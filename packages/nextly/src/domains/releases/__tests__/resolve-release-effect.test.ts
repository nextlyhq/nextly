/**
 * What a release says a document should look like right now.
 *
 * These pin the ordering, because ordering is what makes the publish-then-
 * unpublish pair work: a page that goes live on the 1st and comes down on the
 * 20th has TWO due members from the 20th onwards, and the later one has to win
 * on every request, on every dialect, whatever order the driver returned rows
 * in.
 *
 * @module domains/releases/__tests__/resolve-release-effect.test
 */
import { describe, it, expect } from "vitest";

import {
  resolveReleaseEffect,
  type DueMember,
} from "../resolve-release-effect";

const at = (iso: string): Date => new Date(iso);

const member = (
  over: Partial<DueMember> & { memberId: string }
): DueMember => ({
  releaseId: `r-${over.memberId}`,
  action: "publish",
  scheduledAt: at("2026-01-01T00:00:00Z"),
  createdAt: at("2026-01-01T00:00:00Z"),
  ...over,
});

const NOW = at("2026-06-01T12:00:00Z");

describe("resolveReleaseEffect", () => {
  it("does nothing when no member is due", () => {
    expect(resolveReleaseEffect({ members: [], now: NOW })).toEqual({
      effect: "none",
      memberId: null,
      releaseId: null,
    });
  });

  it("ignores a member scheduled in the future", () => {
    const future = member({
      memberId: "m1",
      scheduledAt: at("2026-07-01T00:00:00Z"),
    });

    expect(resolveReleaseEffect({ members: [future], now: NOW }).effect).toBe(
      "none"
    );
  });

  it("applies a member whose time has passed", () => {
    const due = member({
      memberId: "m1",
      scheduledAt: at("2026-05-01T00:00:00Z"),
    });

    expect(resolveReleaseEffect({ members: [due], now: NOW })).toEqual({
      effect: "publish",
      memberId: "m1",
      releaseId: "r-m1",
    });
  });

  it("applies a member scheduled for exactly now", () => {
    // The boundary is inclusive: a release scheduled for 09:00 is in effect AT
    // 09:00, not from the first request after it.
    const due = member({ memberId: "m1", scheduledAt: NOW });

    expect(resolveReleaseEffect({ members: [due], now: NOW }).effect).toBe(
      "publish"
    );
  });

  it("lets the LATEST due member win, not the first seen", () => {
    const publish = member({
      memberId: "m1",
      action: "publish",
      scheduledAt: at("2026-05-01T00:00:00Z"),
    });
    const unpublish = member({
      memberId: "m2",
      action: "unpublish",
      scheduledAt: at("2026-05-20T00:00:00Z"),
    });

    expect(
      resolveReleaseEffect({ members: [publish, unpublish], now: NOW }).effect
    ).toBe("unpublish");
    // The order the rows arrive in must not change the answer.
    expect(
      resolveReleaseEffect({ members: [unpublish, publish], now: NOW }).effect
    ).toBe("unpublish");
  });

  it("breaks a same-instant tie deterministically, by createdAt then id", () => {
    const a = member({
      memberId: "a",
      action: "publish",
      scheduledAt: at("2026-05-01T00:00:00Z"),
      createdAt: at("2026-04-01T00:00:00Z"),
    });
    const b = member({
      memberId: "b",
      action: "unpublish",
      scheduledAt: at("2026-05-01T00:00:00Z"),
      createdAt: at("2026-04-02T00:00:00Z"),
    });

    const forward = resolveReleaseEffect({ members: [a, b], now: NOW });
    const reversed = resolveReleaseEffect({ members: [b, a], now: NOW });

    expect(forward).toEqual(reversed);
    expect(forward.memberId).toBe("b");
  });

  it("falls back to the member id when scheduledAt and createdAt both tie", () => {
    // Without this last term the order is not total, and two members created in
    // the same millisecond would resolve by whatever the driver returned first.
    const same = {
      scheduledAt: at("2026-05-01T00:00:00Z"),
      createdAt: at("2026-04-01T00:00:00Z"),
    };
    const a = member({ memberId: "a", action: "publish", ...same });
    const b = member({ memberId: "b", action: "unpublish", ...same });

    expect(resolveReleaseEffect({ members: [a, b], now: NOW }).memberId).toBe(
      "b"
    );
    expect(resolveReleaseEffect({ members: [b, a], now: NOW }).memberId).toBe(
      "b"
    );
  });

  it("ignores a future member sitting beside a due one", () => {
    // A page live since May, scheduled to come down in July: today it reads as
    // published, and the pending takedown must not leak into the answer.
    const due = member({
      memberId: "m1",
      action: "publish",
      scheduledAt: at("2026-05-01T00:00:00Z"),
    });
    const later = member({
      memberId: "m2",
      action: "unpublish",
      scheduledAt: at("2026-07-01T00:00:00Z"),
    });

    expect(resolveReleaseEffect({ members: [due, later], now: NOW })).toEqual({
      effect: "publish",
      memberId: "m1",
      releaseId: "r-m1",
    });
  });
});
