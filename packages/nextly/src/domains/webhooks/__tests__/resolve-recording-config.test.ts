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
});
