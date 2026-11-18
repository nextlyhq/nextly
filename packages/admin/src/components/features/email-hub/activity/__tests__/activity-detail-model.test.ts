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
  versionText,
} from "../activity-detail-model";

describe("detailState", () => {
  const delivery = { source: "delivery" as const, templateCaused: false };
  const queued = { source: "queued" as const, templateCaused: false };

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
      label: "Not recorded (sent before versions were kept)",
      digest: null,
    });
    expect(versionText(null)).toEqual({
      label: "Not sent yet",
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
