/**
 * The detail sheet's words: its state first, with what to do for each kind
 * of failure, which version of its template was sent, and each attempt on
 * its timeline.
 *
 * @module components/features/email-hub/activity/__tests__/activity-detail-model.test
 */
import { describe, expect, it } from "vitest";

import type { DeliveryAttempt } from "@admin/services/emailActivityApi";

import {
  attemptText,
  detailState,
  emptyTimelineText,
  failureKindOf,
  versionText,
} from "../activity-detail-model";

describe("detailState", () => {
  const delivery = {
    source: "delivery" as const,
    templateCaused: false,
    attemptOnRecord: true,
  };
  const queued = {
    source: "queued" as const,
    templateCaused: false,
    attemptOnRecord: true,
  };

  it("says a sent email was sent, with nothing to do", () => {
    expect(
      detailState({
        ...delivery,
        outcome: "sent",
        failureKind: null,
        failureReason: null,
      })
    ).toEqual({ title: "Sent", todo: null });
  });

  it("says why a send failed, and what to do for each kind of failure", () => {
    const retryable = detailState({
      ...delivery,
      outcome: "failed",
      failureKind: "retryable",
      failureStatus: 503,
      failureReason: "Resend answered 503",
    });
    expect(retryable.title).toBe("Failed: the provider couldn’t take it then");
    expect(retryable.reason).toBe("Resend answered 503 (status 503)");
    expect(retryable.todo).toMatch(/isn’t retried.*send it again/i);

    const refused = detailState({
      ...delivery,
      outcome: "failed",
      failureKind: "refused",
      failureReason: "Mailbox unavailable",
    });
    expect(refused.title).toBe("Failed: the provider refused it");
    expect(refused.todo).toMatch(/address|provider/i);

    const unknown = detailState({
      ...delivery,
      outcome: "failed",
      failureKind: "unknown",
      failureReason: "Timed out",
    });
    expect(unknown.title).toBe("Unknown: it may have arrived");
    // The detail carries no message id, so the advice never promises one.
    expect(unknown.todo).toMatch(/provider’s own log/i);
    expect(unknown.todo).not.toMatch(/message id/i);
  });

  it("promises another try only while a queued email will still make one", () => {
    const retrying = detailState({
      ...queued,
      outcome: "retrying",
      failureKind: "retryable",
      failureReason: "Resend answered 503",
    });
    expect(retrying.todo).toMatch(/tries again by itself/i);

    // Out of attempts: failed for good, even though its last failure was retryable.
    const exhausted = detailState({
      ...queued,
      outcome: "failed",
      failureKind: "retryable",
      failureReason: "Resend answered 503",
    });
    expect(exhausted.todo).not.toMatch(/tries again by itself/i);
    expect(exhausted.todo).toMatch(/won’t be tried again/i);
  });

  it("blames the template, not the provider, for a failure the template caused", () => {
    // Rendering failed before any provider was asked: no attempt, no kind.
    const state = detailState({
      ...queued,
      templateCaused: true,
      outcome: "failed",
      failureKind: null,
      failureReason: "The Reply-To set by the template wasn't a valid address.",
    });
    expect(state.title).toBe("Failed: the template couldn’t be used");
    expect(state.reason).toBe(
      "The Reply-To set by the template wasn't a valid address."
    );
    expect(state.todo).toMatch(/fix the template/i);
    expect(state.title).not.toMatch(/provider/i);
  });

  it("never calls an attempt of a queued email a direct send", () => {
    const attempt = detailState({
      ...delivery,
      source: "attempt",
      outcome: "failed",
      failureKind: "retryable",
      failureReason: "Resend answered 503",
    });
    expect(attempt.todo).not.toMatch(/direct send/i);
    expect(attempt.todo).toMatch(/queued email/i);
  });

  it("words a queued failure with no attempt on record as neither the provider's nor proof none was asked", () => {
    // No attempt on record: one may never have been made, or retention may
    // have removed it, so the title claims neither.
    const state = detailState({
      ...queued,
      attemptOnRecord: false,
      outcome: "failed",
      failureKind: "refused",
      failureReason: "Mailbox unavailable",
    });
    expect(state.title).toBe("Failed");
    expect(state.reason).toBe("Mailbox unavailable");
    expect(state.todo).not.toMatch(/send it again/i);
  });

  it("tells a retrying email whose template failed to fix it, never to send it by hand", () => {
    const state = detailState({
      ...queued,
      templateCaused: true,
      outcome: "retrying",
      failureKind: "retryable",
      failureReason: "The attempt failed before a provider was asked.",
    });
    expect(state.title).toBe("Retrying: the template couldn’t be used");
    expect(state.todo).toMatch(/fix the template before its next attempt/i);
    expect(state.todo).toMatch(/don’t send it again by hand/i);
  });

  it("claims no kind for a failure recorded before kinds were kept", () => {
    const state = detailState({
      ...delivery,
      outcome: "failed",
      failureKind: null,
      failureReason: "Mailbox unavailable",
    });
    expect(state.title).toBe("Failed");
    expect(state.reason).toBe("Mailbox unavailable");
    expect(state.todo).toMatch(/recorded before failures were sorted by kind/i);
    expect(state.todo).not.toMatch(/isn’t retried/i);
  });

  it("puts a cancelled email's state first and keeps its last failure", () => {
    expect(
      detailState({
        ...queued,
        outcome: "cancelled",
        failureKind: "retryable",
        failureReason: "Internal server error",
      })
    ).toEqual({
      title: "Cancelled",
      reason: "Last failure: Internal server error",
      todo: null,
    });
  });
});

describe("unknown outcomes", () => {
  const unknown = {
    templateCaused: false,
    attemptOnRecord: true,
    failureKind: "unknown" as const,
    failureReason: "The provider's answer was lost.",
  };

  it("tells a queued email still retrying not to be sent by hand as well", () => {
    const state = detailState({
      ...unknown,
      source: "queued",
      outcome: "retrying",
    });
    expect(state.todo).toMatch(/don’t send it by hand/i);
    expect(state.todo).not.toMatch(/before sending it again/i);
  });

  it("sends one attempt of a queued email to the queued email", () => {
    const state = detailState({
      ...unknown,
      source: "attempt",
      outcome: "failed",
    });
    expect(state.todo).toMatch(/open the queued email/i);
  });

  it("asks a direct send to be checked before it is sent again", () => {
    const state = detailState({
      ...unknown,
      source: "delivery",
      outcome: "failed",
    });
    expect(state.todo).toMatch(/provider’s own log before sending it again/i);
  });
});

describe("emptyTimelineText", () => {
  it("says no attempt yet only for a queued email still waiting for its first", () => {
    expect(emptyTimelineText({ state: "waiting", attempts: 0 })).toBe(
      "No attempt yet."
    );
    const none =
      "No delivery is on record: none was made, or it’s no longer kept.";
    // Sent, attempted, or with its count pruned: it may well have been tried.
    expect(emptyTimelineText({ state: "sent", attempts: 1 })).toBe(none);
    expect(emptyTimelineText({ state: "waiting", attempts: 2 })).toBe(none);
    expect(emptyTimelineText({ state: "failed", attempts: null })).toBe(none);
    expect(emptyTimelineText(null)).toBe(none);
  });
});

describe("versionText", () => {
  it("names the owner's default, the site's override, and a draft test", () => {
    expect(
      versionText({
        owner: "plugin:shop",
        overridden: false,
        digest: "e3b7a6d4c0ffee",
      })
    ).toEqual({ label: "Owner’s default", digest: "e3b7a6d4" });
    expect(
      versionText({ owner: "core", overridden: true, digest: "a91f3c07aa" })
    ).toEqual({ label: "The site’s version", digest: "a91f3c07" });
    // A template the site owns is never overridden: it is the site's own.
    expect(
      versionText({ owner: "site", overridden: false, digest: "b0b0cafe11" })
    ).toEqual({ label: "The site’s own template", digest: "b0b0cafe" });
    // The site's code-first version has no saved version to digest.
    expect(
      versionText({ owner: "code", overridden: false, digest: null })
    ).toEqual({ label: "The site’s code version", digest: null });
    expect(
      versionText({
        owner: "site",
        overridden: false,
        digest: null,
        draft: true,
      })
    ).toEqual({ label: "A draft test, never saved", digest: null });
  });

  it("says plainly when there was no template, or the version wasn't recorded", () => {
    expect(versionText("none")).toEqual({ label: "No template", digest: null });
    expect(versionText("not-recorded")).toEqual({
      label: "Not recorded (from before versions were kept)",
      digest: null,
    });
    // "Not sent yet" only while it can still be sent; a failed or cancelled
    // email never will be.
    expect(versionText(null, true)).toEqual({
      label: "Not sent yet",
      digest: null,
    });
    expect(versionText(null)).toEqual({
      label: "No version recorded",
      digest: null,
    });
  });
});

describe("attemptText", () => {
  const attempt = (over: Partial<DeliveryAttempt>): DeliveryAttempt => ({
    id: "d1",
    createdAt: "2026-11-16T11:00:00.000Z",
    outcome: "failed",
    recipientKind: "to",
    provider: { id: null, type: "resend" },
    failureKind: "retryable",
    failureStatus: 503,
    failureReason: "Resend answered 503",
    templateVersion: "none",
    erased: false,
    ...over,
  });

  it("names each attempt's outcome, provider, recipient kind and answer", () => {
    expect(attemptText(attempt({}))).toEqual({
      outcome: "Failed",
      detail: "resend · To · retryable, status 503 · Resend answered 503",
    });
    expect(
      attemptText(
        attempt({
          outcome: "sent",
          failureKind: null,
          failureStatus: null,
          failureReason: null,
        })
      )
    ).toEqual({ outcome: "Sent", detail: "resend · To" });
  });
});

describe("failureKindOf", () => {
  const newest = (over: Partial<DeliveryAttempt>): DeliveryAttempt => ({
    id: "d1",
    createdAt: "2026-11-16T11:00:00.000Z",
    outcome: "failed",
    recipientKind: "to",
    provider: { id: null, type: "resend" },
    failureKind: "unknown",
    failureStatus: null,
    failureReason: "The provider's answer was lost.",
    templateVersion: "none",
    erased: false,
    ...over,
  });

  it("reads an unknown outcome from the newest attempt, since the queue's row never keeps one", () => {
    // The row's failure as the server sends it: retryable, with no unknown.
    const lost = { retryable: true, reason: "The provider's answer was lost." };
    expect(failureKindOf(lost, newest({}))).toBe("unknown");
    expect(failureKindOf(lost, newest({ failureKind: "retryable" }))).toBe(
      "retryable"
    );
    expect(failureKindOf(lost)).toBe("retryable");
    // A refusal stays one, whatever an earlier attempt said.
    expect(failureKindOf({ retryable: false, reason: "x" }, newest({}))).toBe(
      "refused"
    );
    expect(failureKindOf(null, newest({}))).toBeNull();
  });
});
