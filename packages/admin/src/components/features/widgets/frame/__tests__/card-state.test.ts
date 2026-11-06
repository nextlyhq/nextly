/**
 * `readSlot`: what every component that draws from its batch answer reports
 * while it has none to draw. Each case would fail on a plausible reader that,
 * say, left a never-asked card loading for ever, or told a reader who may not
 * see a source that it failed.
 */
import { describe, expect, it, vi } from "vitest";

import { readSlot } from "../card-state";

const skeleton = { shape: "figure" as const };

describe("readSlot", () => {
  it("reports loading, with the card's skeleton, while the first answer is on the way", () => {
    expect(readSlot(undefined, { isFetching: true, skeleton })).toEqual({
      state: { kind: "loading", skeleton },
    });
  });

  it("reports not available for a card no answer is coming for, rather than loading for ever", () => {
    expect(readSlot(undefined, { isFetching: false, skeleton })).toEqual({
      state: { kind: "no-access" },
    });
  });

  it("reports one not-available state for a source the reader may not see", () => {
    expect(
      readSlot(
        { ok: false, error: "Not available.", code: "unavailable" },
        { isFetching: false, skeleton, onRetry: vi.fn() }
      )
    ).toEqual({ state: { kind: "no-access" } });
  });

  it("reports any other failure as an error, with the card's own Retry", () => {
    const onRetry = vi.fn();
    expect(
      readSlot(
        { ok: false, error: "The database did not answer." },
        { isFetching: false, skeleton, onRetry }
      )
    ).toEqual({
      state: {
        kind: "error",
        message: "The database did not answer.",
        retry: onRetry,
      },
    });
  });

  it("hands back the answer itself when there is one", () => {
    const result = { op: "count" as const, total: 3 };
    expect(
      readSlot({ ok: true, result }, { isFetching: true, skeleton })
    ).toEqual({ result });
  });
});
