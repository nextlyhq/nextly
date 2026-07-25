import { afterEach, describe, it, expect } from "vitest";

import {
  isWebhookRecordingEnabled,
  pruneRemovedCodeFirstRecording,
  resetWebhookRecordingPolicy,
  setWebhookRecording,
  webhookRecordingKey,
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

  it("prunes a removed code-first slug but preserves plugin and present slugs", () => {
    setWebhookRecording("collection", "leads", false, "code"); // removed below
    setWebhookRecording("collection", "posts", false, "code"); // still present
    setWebhookRecording("collection", "form-submissions", false, "plugin");

    // Reconcile against the config that no longer lists `leads`.
    pruneRemovedCodeFirstRecording(
      new Set([webhookRecordingKey("collection", "posts")])
    );

    // The removed code-first slug reverts to the default (record)...
    expect(isWebhookRecordingEnabled("collection", "leads")).toBe(true);
    // ...while a still-present code-first slug and the plugin slug keep opt-out.
    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(false);
    expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
      false
    );
  });
});
