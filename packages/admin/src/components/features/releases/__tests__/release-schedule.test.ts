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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getGlobalDateTimeConfig,
  setGlobalDateTimeConfig,
  type GlobalDateTimeConfig,
} from "@admin/lib/dates/format";
import type { Release } from "@admin/types/releases";

import { describeRelease, formatScheduledAt } from "../release-schedule";

/**
 * A reader whose own zone is nowhere near the author's.
 *
 * Pinned rather than inherited from the runner. `vitest.config.ts` does not fix
 * `TZ`, so on a machine already in the author's zone a formatter that dropped
 * the `timeZone` option would render the same digits and every case below would
 * pass on the broken implementation. UTC+14 shares no wall-clock hour with
 * Berlin, so the two readings cannot coincide.
 */
const READER_ZONE = "Pacific/Kiritimati";

let previousConfig: GlobalDateTimeConfig;

beforeEach(() => {
  previousConfig = getGlobalDateTimeConfig();
  setGlobalDateTimeConfig({ locale: "en-US", timezone: READER_ZONE });
});

afterEach(() => {
  // The config is module state, so a case that changed it would otherwise
  // decide what every later file in this worker sees.
  setGlobalDateTimeConfig(previousConfig);
});

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
    // The control on the case above, and it discriminates only because the
    // reader's zone is pinned to one that disagrees with the author's: 07:00
    // UTC is 09:00 in Berlin and 21:00 the same day in Kiritimati. An
    // implementation that dropped `timeZone` would say 9:00 PM here.
    const text = formatScheduledAt(release()) ?? "";
    expect(text).not.toContain("9:00 PM");
    expect(text).toContain("9:00 AM");
  });

  it("honours the installation's configured date format", () => {
    // The separating property between routing through the admin's own formatter
    // and building a second `Intl.DateTimeFormat` here: a private formatter
    // renders a correct-looking date that ignores this setting entirely, and
    // every other case in this file passes either way.
    setGlobalDateTimeConfig({
      locale: "en-US",
      timezone: READER_ZONE,
      dateFormat: "DD.MM.YYYY",
    });
    expect(formatScheduledAt(release())).toContain("01.09.2026");
  });

  it("says nothing rather than guessing when there is no instant", () => {
    expect(formatScheduledAt(release({ scheduledAt: null }))).toBeNull();
  });

  it("falls back to the instant when the stored zone cannot be formatted", () => {
    // The route validates zones on the way in, so this is a value from before
    // that guard or from another writer. An editor is better served by the
    // instant in UTC than by a blank where a date should be.
    const text = formatScheduledAt(release({ timezone: "Europe/Berln" })) ?? "";
    // UTC, and SAID to be UTC. The reader's own zone would render 9:00 PM here,
    // so this also pins that an unusable zone does not silently become the
    // reader's while the label still claims the author's.
    expect(text).toContain("7:00 AM");
    expect(text).toContain("(UTC)");
    expect(text).not.toContain("Berln");
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
