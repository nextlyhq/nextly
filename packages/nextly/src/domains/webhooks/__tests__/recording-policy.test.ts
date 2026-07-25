import { afterEach, describe, it, expect } from "vitest";

import {
  isWebhookRecordingEnabled,
  resetWebhookRecordingPolicy,
  setWebhookRecording,
} from "../recording-policy";

// The recording policy is a process-level registry populated from code config
// at collection/single registration and read at the outbox choke point. It is a
// module singleton (like the event bus / hook registry) so a fresh boot must
// reset it — the tests do so between cases.
afterEach(() => {
  resetWebhookRecordingPolicy();
});

describe("webhook recording policy", () => {
  it("records by default for a slug that was never registered", () => {
    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
    expect(isWebhookRecordingEnabled("single", "settings")).toBe(true);
  });

  it("honors an explicit opt-out and keeps scopes separate", () => {
    setWebhookRecording("collection", "submissions", false);
    expect(isWebhookRecordingEnabled("collection", "submissions")).toBe(false);
    // A single that happens to share the slug is a different scope.
    expect(isWebhookRecordingEnabled("single", "submissions")).toBe(true);
  });

  it("records when explicitly enabled", () => {
    setWebhookRecording("collection", "posts", true);
    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("clears all entries on reset", () => {
    setWebhookRecording("collection", "submissions", false);
    resetWebhookRecordingPolicy();
    expect(isWebhookRecordingEnabled("collection", "submissions")).toBe(true);
  });
});
