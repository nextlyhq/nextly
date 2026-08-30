/**
 * That the admin's release controls follow the engine's transition rules.
 *
 * The failure these guard is asymmetric and quiet. A UI matrix that is WIDER
 * than the engine produces a refusal an editor can see; one that is NARROWER
 * removes product silently — no button, no error, and nothing to search for.
 * The first version of this screen offered scheduling only from `draft`, so a
 * committed release could not be moved and a cancelled one could not be
 * reinstated, and its confirmation dialog stated the opposite of the rule.
 *
 * @module components/features/releases/__tests__/release-lifecycle.test
 */
import { describe, expect, it } from "vitest";

import {
  canCancel,
  canSchedule,
  membershipEditability,
  scheduleIntent,
} from "../release-lifecycle";

describe("canSchedule", () => {
  it("admits a release that already has an instant, so it can be MOVED", () => {
    expect(canSchedule("scheduled")).toBe(true);
  });

  it("admits a cancelled release, so a launch can be reinstated", () => {
    expect(canSchedule("cancelled")).toBe(true);
  });

  it("admits a draft, which is the first instant", () => {
    expect(canSchedule("draft")).toBe(true);
  });

  it("refuses a published release", () => {
    // The one exclusion, and it is not caution: re-scheduling would make the
    // drain re-apply the members against documents that have changed since.
    expect(canSchedule("published")).toBe(false);
  });
});

describe("canCancel", () => {
  it("admits a draft, because cancelling is how one is abandoned", () => {
    // There is no delete route, so excluding drafts would leave a release
    // created by mistake in the list forever.
    expect(canCancel("draft")).toBe(true);
  });

  it("admits a scheduled release", () => {
    expect(canCancel("scheduled")).toBe(true);
  });

  it("refuses a published one and one already cancelled", () => {
    expect(canCancel("published")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});

describe("membershipEditability", () => {
  it("is free for a draft", () => {
    expect(membershipEditability("draft")).toBe("free");
  });

  it("is free for a cancelled release", () => {
    // Assemblable by the engine's fence. The picker declines to OFFER a
    // cancelled release as a target, which is a different decision made in a
    // different place — this is the rule, not the offer.
    expect(membershipEditability("cancelled")).toBe("free");
  });

  it("costs the publishing authority for a scheduled release", () => {
    // The drain reads membership AT the instant, so editing a committed launch
    // changes what a publisher agreed to.
    expect(membershipEditability("scheduled")).toBe("needs-publish");
  });

  it("is closed once published", () => {
    expect(membershipEditability("published")).toBe("closed");
  });
});

describe("scheduleIntent", () => {
  it("names the three different acts the one control performs", () => {
    // The verb is what an editor reads before clicking. "Schedule" on a release
    // that already has an instant reads as though it has none.
    expect(scheduleIntent("draft")).toBe("set");
    expect(scheduleIntent("scheduled")).toBe("move");
    expect(scheduleIntent("cancelled")).toBe("reinstate");
  });
});
