/**
 * How a release's schedule is put into words.
 *
 * The cases worth pinning are the ones where a plausible implementation says
 * something FALSE rather than something ugly: an instant rendered in the
 * reader's zone instead of the author's, a zone dropped from the sentence, or a
 * cancelled release described in a way that suggests content is still coming.
 *
 * @module components/features/releases/__tests__/release-schedule.test
 */
import { describe, expect, it } from "vitest";

import type { Release } from "@admin/types/releases";

import { describeRelease, formatScheduledAt } from "../release-schedule";

function release(over: Partial<Release> = {}): Release {
  return {
    id: "r1",
    title: "Spring launch",
    description: null,
    scheduledAt: "2026-09-01T07:00:00.000Z",
    timezone: "Europe/Berlin",
    state: "scheduled",
    publishedAt: null,
    createdBy: "u1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("formatScheduledAt", () => {
  it("renders the instant in the AUTHOR's zone, and names it", () => {
    // 07:00 UTC is 09:00 in Berlin. The author said "9am Berlin", and that is
    // the promise an editor in any other zone needs to read — not what the
    // moment happens to be on their own clock.
    const text = formatScheduledAt(release());
    expect(text).toContain("9:00");
    expect(text).toContain("Europe/Berlin");
  });

  it("does not render it in the reader's zone", () => {
    // The control on the case above. Formatting without `timeZone` would give
    // the machine's local time, which is 07:00 under the UTC that tests run in
    // — a different, equally plausible-looking sentence.
    const text = formatScheduledAt(release()) ?? "";
    expect(text).not.toContain("7:00");
  });

  it("says nothing rather than guessing when there is no instant", () => {
    expect(formatScheduledAt(release({ scheduledAt: null }))).toBeNull();
  });

  it("falls back to the instant when the stored zone cannot be formatted", () => {
    // The route validates zones on the way in, so this is a value from before
    // that guard or from another writer. An editor is better served by the
    // instant in UTC than by a blank where a date should be.
    const text = formatScheduledAt(release({ timezone: "Europe/Berln" })) ?? "";
    expect(text).toContain("2026-09-01");
    expect(text).toContain("UTC");
  });
});

describe("describeRelease", () => {
  it("says a cancelled release will not go live, not merely that it is cancelled", () => {
    // "Cancelled" alone leaves an editor to infer the consequence. The one
    // thing they need is that nothing is coming.
    expect(describeRelease(release({ state: "cancelled" }))).toContain(
      "nothing will go live"
    );
  });

  it("distinguishes an assembled release from a committed one", () => {
    // A release with no instant is not broken — it is assembled and
    // uncommitted, which is a state an editor can act on.
    expect(
      describeRelease(release({ state: "draft", scheduledAt: null }))
    ).toBe("Not scheduled yet");
  });

  it("leads with the moment for a scheduled release", () => {
    expect(describeRelease(release())).toMatch(/^Goes live /);
  });
});
