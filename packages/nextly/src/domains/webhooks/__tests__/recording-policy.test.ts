import { afterEach, describe, it, expect } from "vitest";

import {
  applyStoredRecordingDecisions,
  currentRecordingGeneration,
  isRecordingDisabledByConfig,
  clearWebhookRecording,
  isWebhookRecordingEnabled,
  pruneRemovedCodeFirstRecording,
  resetWebhookRecordingPolicy,
  setStoredRecordingClock,
  setStoredRecordingRefresher,
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

  it("swaps the whole db set so an opt-in elsewhere lifts here too", () => {
    // A refresh that could only ADD opt-outs would never lift one, so a switch
    // turned back on in another process would stay suppressed here forever.
    applyStoredRecordingDecisions([
      { scope: "collection", slug: "enquiries" },
      { scope: "single", slug: "contact" },
    ]);
    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);

    // `enquiries` opted back in; `contact` is still off.
    applyStoredRecordingDecisions([{ scope: "single", slug: "contact" }]);

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(true);
    expect(isWebhookRecordingEnabled("single", "contact")).toBe(false);
  });

  it("leaves code and plugin decisions alone when the db set is swapped", () => {
    setWebhookRecording("collection", "posts", false, "code");
    setWebhookRecording("collection", "form-submissions", false, "plugin");

    applyStoredRecordingDecisions([]);

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(false);
    expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
      false
    );
  });

  it("schedules a background refresh once the stored set goes stale", async () => {
    // The gate runs inside the content write transaction, so it must return
    // synchronously and reload out of band — never read the database inline.
    let clock = 1_000_000;
    setStoredRecordingClock(() => clock);
    applyStoredRecordingDecisions([{ scope: "collection", slug: "enquiries" }]);

    let refreshes = 0;
    setStoredRecordingRefresher(async () => {
      refreshes += 1;
    });

    // Fresh: no reload.
    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
    expect(refreshes).toBe(0);

    // Past the TTL: the caller still gets the last known value immediately.
    clock += 31_000;
    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
    await Promise.resolve();
    expect(refreshes).toBe(1);
  });

  it("coalesces a burst of stale reads into one reload", async () => {
    let clock = 1_000_000;
    setStoredRecordingClock(() => clock);
    applyStoredRecordingDecisions([]);

    let refreshes = 0;
    let release: (() => void) | undefined;
    setStoredRecordingRefresher(
      () =>
        new Promise<void>(resolve => {
          refreshes += 1;
          release = resolve;
        })
    );

    clock += 31_000;
    for (let i = 0; i < 5; i += 1) {
      isWebhookRecordingEnabled("collection", "posts");
    }

    expect(refreshes).toBe(1);
    release?.();
  });

  it("does nothing when no refresher is registered", () => {
    // Single-instance installs never wire one; the gate must not throw or spin.
    let clock = 1_000_000;
    setStoredRecordingClock(() => clock);
    applyStoredRecordingDecisions([{ scope: "collection", slug: "enquiries" }]);
    clock += 31_000;

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });

  it("reports only config decisions as stable enough to skip expansion", () => {
    // The pre-record field expansion skips component expansion when a write will
    // not be recorded. That is only safe against a decision that holds for the
    // whole write: a `db` decision can be flipped mid-write by the background
    // refresh, and skipping expansion then recording would ship
    // component-nested secret/hidden values unstripped.
    setWebhookRecording("collection", "from-code", false, "code");
    setWebhookRecording("collection", "from-plugin", false, "plugin");
    setWebhookRecording("collection", "from-db", false, "db");

    expect(isRecordingDisabledByConfig("collection", "from-code")).toBe(true);
    expect(isRecordingDisabledByConfig("collection", "from-plugin")).toBe(true);
    expect(isRecordingDisabledByConfig("collection", "from-db")).toBe(false);
  });

  it("reports nothing stable for a slug that records", () => {
    setWebhookRecording("collection", "posts", true, "code");

    expect(isRecordingDisabledByConfig("collection", "posts")).toBe(false);
    expect(isRecordingDisabledByConfig("collection", "never-seen")).toBe(false);
  });

  it("rejects a refresh captured before a reset, even when the counter collides", () => {
    // ABA: a background read captures generation N, then `clearServices()`
    // resets and the next boot performs the SAME number of writes, so a
    // zero-based counter lands back on exactly N. The stale snapshot — taken
    // against the previous adapter and config — would then pass the guard and
    // wipe every `db` decision the new boot had just published.
    //
    // Constructed so both epochs reach the identical count; that collision is
    // the whole point, and without a monotonic counter this test fails.
    resetWebhookRecordingPolicy();
    setWebhookRecording("collection", "old-epoch", false, "db");
    const captured = currentRecordingGeneration();

    resetWebhookRecordingPolicy();
    setWebhookRecording("collection", "enquiries", false, "db");

    applyStoredRecordingDecisions([], captured);

    // The stale snapshot was discarded, so the new boot's opt-out survives.
    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });
});
