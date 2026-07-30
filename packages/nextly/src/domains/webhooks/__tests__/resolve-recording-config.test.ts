import { describe, it, expect } from "vitest";

import { resolveWebhookRecording } from "../resolve-recording-config";

// The `webhooks` collection/single option normalizes to a single resolved shape
// so every consumer reads `{ record }` and never branches on the raw union. The
// default is to RECORD: a collection that never sets the option keeps emitting
// outbox events, exactly as it did before the option existed.
describe("resolveWebhookRecording", () => {
  it("defaults to recording when the option is absent", () => {
    expect(resolveWebhookRecording(undefined)).toEqual({ record: true });
  });

  it("treats a boolean as the record flag directly", () => {
    expect(resolveWebhookRecording(true)).toEqual({ record: true });
    expect(resolveWebhookRecording(false)).toEqual({ record: false });
  });

  it("reads `record` from the object form, defaulting to true", () => {
    expect(resolveWebhookRecording({})).toEqual({ record: true });
    expect(resolveWebhookRecording({ record: true })).toEqual({ record: true });
    expect(resolveWebhookRecording({ record: false })).toEqual({
      record: false,
    });
  });

  it("tolerates malformed values from untyped JS configs without throwing", () => {
    // `null` must not throw (as `null.record` would); a non-boolean `record`
    // must not escape the boolean return. Both fall back to recording.
    const asInput = (v: unknown) =>
      v as boolean | { record?: boolean } | undefined;
    expect(resolveWebhookRecording(asInput(null))).toEqual({ record: true });
    expect(resolveWebhookRecording(asInput({ record: "false" }))).toEqual({
      record: true,
    });
    expect(resolveWebhookRecording(asInput({ record: 0 }))).toEqual({
      record: true,
    });
  });

  it("resolves a curated emit and derives the resource kind from the event", () => {
    expect(
      resolveWebhookRecording({
        record: false,
        emit: {
          event: "form.submission.created",
          fields: ["form", "submittedAt", "status"],
        },
      })
    ).toEqual({
      record: false,
      emit: {
        event: "form.submission.created",
        kind: "form",
        fields: ["form", "submittedAt", "status"],
      },
    });
  });

  it("resolves an emit with no field allowlist", () => {
    expect(
      resolveWebhookRecording({
        record: false,
        emit: { event: "form.submission.created" },
      })
    ).toEqual({
      record: false,
      emit: { event: "form.submission.created", kind: "form" },
    });
  });

  it("derives the kind for any declared event family", () => {
    expect(
      resolveWebhookRecording({
        record: false,
        emit: { event: "user.created" },
      }).emit
    ).toEqual({ event: "user.created", kind: "user" });
  });

  it("drops a malformed emit rather than throwing", () => {
    const asInput = (v: unknown) =>
      v as boolean | { record?: boolean } | undefined;
    // Unknown event -> no curated event at all.
    expect(
      resolveWebhookRecording(
        asInput({ record: false, emit: { event: "nope.created" } })
      )
    ).toEqual({ record: false });
    // A non-object emit -> no curated event.
    expect(
      resolveWebhookRecording(
        asInput({ record: false, emit: "form.submission.created" })
      )
    ).toEqual({ record: false });
    // Non-string field names -> the event still resolves, the allowlist is
    // dropped (an empty projection is safer than shipping unexpected keys).
    expect(
      resolveWebhookRecording(
        asInput({
          record: false,
          emit: { event: "form.submission.created", fields: [1, 2] },
        })
      )
    ).toEqual({
      record: false,
      emit: { event: "form.submission.created", kind: "form" },
    });
  });
});
