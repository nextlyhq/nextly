/**
 * Resolving a retention window never deletes more than the configuration asked
 * for.
 *
 * The asymmetry is the entire subject, so every case below asserts a DIRECTION
 * rather than merely that a value was clamped. A resolver that answers a value
 * it cannot use by substituting the default is not "safe": every default here
 * is a finite window that deletes, so substituting one for a value that asked
 * to keep MORE is data loss on a schedule, and it is invisible because the
 * configuration reads as accepted.
 *
 * `Infinity` is the case that makes it concrete. It is the strongest available
 * spelling of "keep forever", and both shipped resolvers answered it with a
 * default that deleted — audit after 90 days, webhook events after 30.
 */

import { describe, expect, it } from "vitest";

import { MAX_STORABLE_OFFSET_MS, resolveRetentionWindow } from "../window";

const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK = 90 * DAY_MS;

const keeping = { fallback: FALLBACK, zero: "malformed" } as const;
const ledger = { fallback: FALLBACK, zero: "keep-nothing" } as const;

describe("resolving a retention window", () => {
  it("honours a window it can use", () => {
    // The instrument control. Every assertion below compares against a resolved
    // value, and a resolver that returned the fallback for everything would
    // satisfy several of them by accident.
    expect(resolveRetentionWindow(30 * DAY_MS, keeping)).toBe(30 * DAY_MS);
    expect(resolveRetentionWindow(2 * FALLBACK, keeping)).toBe(2 * FALLBACK);
  });

  it("keeps everything when retention is turned off", () => {
    // `false` is a deliberate operator position, not a missing value.
    expect(resolveRetentionWindow(false, keeping)).toBe(false);
  });

  it.each([
    ["infinite", Number.POSITIVE_INFINITY],
    ["past the storable range", MAX_STORABLE_OFFSET_MS + 1],
    ["the largest safe integer", Number.MAX_SAFE_INTEGER],
  ])(
    "degrades %s to keeping everything, not to the default",
    (_label, value) => {
      // The direction assertion, and the reason this module exists. These are all
      // the same request — keep rows longer than a cutoff can express — and
      // answering any of them with the default deletes what was asked to be kept.
      const resolved = resolveRetentionWindow(value, keeping);
      expect(resolved).toBe(false);
      expect(resolved).not.toBe(FALLBACK);
    }
  );

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["a string", "90d"],
    ["null", null],
    ["undefined", undefined],
  ])("falls back for a %s window", (_label, value) => {
    // The opposite direction, and it is safe here precisely because none of
    // these asked for MORE retention than the default gives.
    expect(resolveRetentionWindow(value, keeping)).toBe(FALLBACK);
  });

  it("reads zero the way the trail asks it to", () => {
    // The two shipped resolvers disagreed on this and both readings are
    // defensible, so it is the caller's decision. Asserting both spellings
    // keeps that a decision rather than an accident of which one was written
    // second.
    expect(resolveRetentionWindow(0, ledger)).toBe(0);
    expect(resolveRetentionWindow(0, keeping)).toBe(FALLBACK);
  });

  it("floors a fractional window", () => {
    expect(resolveRetentionWindow(1000.9, keeping)).toBe(1000);
  });

  it("passes a fallback of false through unchanged", () => {
    // A trail whose default is already "keep forever" must not acquire a
    // deleting window by being handed a malformed value.
    const forever = { fallback: false, zero: "malformed" } as const;
    expect(resolveRetentionWindow(Number.NaN, forever)).toBe(false);
    expect(resolveRetentionWindow(-1, forever)).toBe(false);
  });

  it("never answers a keep-longer request with a shorter window", () => {
    // The invariant itself, asserted over the whole boundary rather than at
    // the points chosen above. A resolver that clamps the top of the range to
    // the fallback satisfies every individual case that names a specific value
    // and fails here.
    const asksForMore = [
      Number.POSITIVE_INFINITY,
      Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      MAX_STORABLE_OFFSET_MS + 1,
      MAX_STORABLE_OFFSET_MS * 2,
    ];
    for (const value of asksForMore) {
      const resolved = resolveRetentionWindow(value, keeping);
      expect(
        resolved,
        `${value} asked to keep more than the range allows, and must not be answered with a window that deletes`
      ).toBe(false);
    }
  });

  it("keeps the boundary itself usable", () => {
    // The largest value that is still a window rather than "forever". Off by
    // one here would silently convert the longest supported retention into
    // unbounded growth.
    expect(resolveRetentionWindow(MAX_STORABLE_OFFSET_MS, keeping)).toBe(
      MAX_STORABLE_OFFSET_MS
    );
  });
});
