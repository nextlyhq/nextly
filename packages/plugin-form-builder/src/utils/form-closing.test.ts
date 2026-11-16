/**
 * A form closes by hand, by its closing time or by its limit, and a visitor is
 * told one thing whichever it was: the form's closed message.
 */
import { GENERIC_REFUSAL } from "nextly";
import { describe, expect, it } from "vitest";

import {
  closedMessageOf,
  formAvailabilityNow,
  limitReached,
  pastClosingTime,
} from "./form-closing";

const NOW = new Date("2026-12-06T18:00:00.000Z");
const LIVE = {
  status: "published",
  wentLiveAt: "2026-11-01T09:00:00.000Z",
  closedMessage: "Sign-ups are closed. Follow us for the next one.",
};

describe("one closed message", () => {
  it("is the same whether the form was closed by hand, by date or by limit", () => {
    const byHand = formAvailabilityNow(
      { ...LIVE, status: "closed" },
      {},
      { now: NOW }
    );
    const byDate = formAvailabilityNow(
      LIVE,
      { closesAt: "2026-12-06T17:00:00.000Z" },
      { now: NOW }
    );
    const byLimit = formAvailabilityNow(
      LIVE,
      { submissionLimit: 2 },
      { now: NOW, taken: 2 }
    );

    expect(byHand).toMatchObject({
      kind: "closed",
      message: LIVE.closedMessage,
    });
    expect(byDate).toMatchObject({
      kind: "closed",
      message: LIVE.closedMessage,
      closedBy: "date",
    });
    expect(byLimit).toMatchObject({
      kind: "closed",
      message: LIVE.closedMessage,
      closedBy: "limit",
    });
  });

  it("is the generic sentence when the author wrote none, or only spaces", () => {
    expect(closedMessageOf({})).toBe(GENERIC_REFUSAL);
    expect(closedMessageOf({ closedMessage: "   " })).toBe(GENERIC_REFUSAL);
  });
});

describe("the form's answer now", () => {
  it("is open before its closing time and below its limit", () => {
    expect(
      formAvailabilityNow(
        LIVE,
        { closesAt: "2026-12-06T18:00:01.000Z", submissionLimit: 3 },
        { now: NOW, taken: 2 }
      )
    ).toEqual({ kind: "open" });
  });

  it("decides by status first: a draft stays absent past its closing time", () => {
    expect(
      formAvailabilityNow(
        { status: "draft" },
        { closesAt: "2026-01-01T00:00:00.000Z" },
        { now: NOW }
      )
    ).toMatchObject({ kind: "absent" });
  });

  it("leaves the limit to whoever knows the count", () => {
    expect(
      formAvailabilityNow(LIVE, { submissionLimit: 1 }, { now: NOW })
    ).toEqual({
      kind: "open",
    });
  });
});

describe("the closing time", () => {
  it.each([
    ["2026-12-06T17:59:59.999Z", true],
    ["2026-12-06T18:00:00.000Z", true],
    ["2026-12-06T18:00:00.001Z", false],
  ])("closing at %s is past at 18:00: %s", (closesAt, past) => {
    expect(pastClosingTime({ closesAt }, NOW)).toBe(past);
  });

  it("is never past when unset or unreadable", () => {
    expect(pastClosingTime({}, NOW)).toBe(false);
    expect(pastClosingTime({ closesAt: "not a date" }, NOW)).toBe(false);
  });
});

describe("the limit", () => {
  it.each([
    [undefined, 1000, false],
    [2, 1, false],
    [2, 2, true],
    [2, 3, true],
  ])(
    "a limit of %s with %s taken is reached: %s",
    (submissionLimit, taken, reached) => {
      expect(limitReached({ submissionLimit }, taken)).toBe(reached);
    }
  );
});
