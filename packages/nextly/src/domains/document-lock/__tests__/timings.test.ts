/**
 * The lease timings, and that they are DERIVED rather than written down.
 *
 * The derivation is the thing under test. Two numbers chosen side by side agree
 * on the day they are written and drift afterwards, each looking reasonable
 * alone — and the drift here is an editor that believes it is protected while
 * somebody else is already taking the document.
 *
 * @module domains/document-lock/__tests__/timings.test
 */

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  DOCUMENT_LOCK_LOSS_AFTER_MS,
  DOCUMENT_LOCK_RENEW_MARGIN_SECONDS,
  DOCUMENT_LOCK_TTL_SECONDS,
} from "../timings";

describe("document lock timings", () => {
  it("is the 150-second lease and 15-second heartbeat that were ruled", () => {
    expect(DOCUMENT_LOCK_TTL_SECONDS).toBe(150);
    expect(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });

  it("tells a holder it is losing the claim while it is still protected", () => {
    // Two heartbeats of lease remain at the loss deadline. A holder warned at
    // expiry would be told after it stopped being protected rather than while
    // it still is, which is too late to save anything.
    expect(DOCUMENT_LOCK_LOSS_AFTER_MS).toBe(
      DOCUMENT_LOCK_TTL_SECONDS * 1000 - 2 * DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
    );
    expect(DOCUMENT_LOCK_LOSS_AFTER_MS).toBeLessThan(
      DOCUMENT_LOCK_TTL_SECONDS * 1000
    );
  });

  it("requires a renewal to leave more than one heartbeat of lease in hand", () => {
    // The margin is what "usable" is judged against. Below one heartbeat a
    // claim could expire before its holder next asks, so a renewal returning
    // less than this is not a claim anything may rely on.
    expect(DOCUMENT_LOCK_RENEW_MARGIN_SECONDS * 1000).toBeGreaterThan(
      DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
    );
    expect(DOCUMENT_LOCK_RENEW_MARGIN_SECONDS).toBe(
      DOCUMENT_LOCK_LOSS_AFTER_MS / 1000
    );
  });
});
