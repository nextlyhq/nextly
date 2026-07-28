import { afterEach, describe, it, expect } from "vitest";

import {
  clearWebhookRecording,
  isWebhookRecordingEnabled,
  pruneRemovedCodeFirstRecording,
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

  it("prunes a removed code-first slug but preserves plugin, present, and other-scope slugs", () => {
    setWebhookRecording("collection", "leads", false, "code"); // removed below
    setWebhookRecording("collection", "posts", false, "code"); // still present
    setWebhookRecording("collection", "form-submissions", false, "plugin");
    setWebhookRecording("single", "leads", false, "code"); // other scope, untouched

    // Reconcile the COLLECTION scope against a config that no longer lists `leads`.
    pruneRemovedCodeFirstRecording("collection", new Set(["posts"]));

    // The removed code-first collection reverts to the default (record)...
    expect(isWebhookRecordingEnabled("collection", "leads")).toBe(true);
    // ...while a still-present collection, the plugin slug, and the same-named
    // slug in the OTHER scope all keep their opt-out.
    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(false);
    expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
      false
    );
    expect(isWebhookRecordingEnabled("single", "leads")).toBe(false);
  });

  it("keeps a db-sourced decision when a code-first reconcile prunes", () => {
    // A Builder-authored collection never appears in the code-first config, so
    // the reconcile that clears removed code entities must not touch it —
    // otherwise its opt-out would lapse on the first HMR reload and the
    // collection would resume recording without anyone changing the switch.
    setWebhookRecording("collection", "enquiries", false, "db");
    setWebhookRecording("collection", "posts", false, "code");

    pruneRemovedCodeFirstRecording("collection", new Set<string>());

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("clears a single stored decision without disturbing the others", () => {
    setWebhookRecording("collection", "enquiries", false, "db");
    setWebhookRecording("single", "enquiries", false, "db");

    clearWebhookRecording("collection", "enquiries");

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(true);
    expect(isWebhookRecordingEnabled("single", "enquiries")).toBe(false);
  });
});
