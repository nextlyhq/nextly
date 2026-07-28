// Why: a Builder-authored opt-out lives only in the registry column, so boot
// has to read it back or the switch silently lapses on every restart and the
// collection resumes recording content the operator chose to keep out of the
// outbox. Code-first entities are excluded because the config publisher already
// applied them from live config, which outranks a row that may be stale.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isWebhookRecordingEnabled,
  resetWebhookRecordingPolicy,
  setWebhookRecording,
} from "../recording-policy";
import { publishStoredWebhookRecordingPolicies } from "../stored-recording-policy";

afterEach(() => {
  resetWebhookRecordingPolicy();
});

/** A reader that answers each registry table from a fixture. */
function adapterReturning(rows: {
  collections?: unknown[];
  singles?: unknown[];
}) {
  return {
    executeQuery: vi.fn(async (sql: string) =>
      sql.includes("dynamic_collections")
        ? (rows.collections ?? [])
        : (rows.singles ?? [])
    ),
  };
}

const noConfigSlugs = {
  collections: new Set<string>(),
  singles: new Set<string>(),
};

describe("publishStoredWebhookRecordingPolicies", () => {
  it("applies a stored opt-out for a builder-authored collection", async () => {
    const adapter = adapterReturning({
      collections: [
        { slug: "enquiries", source: "ui", webhooks: '{"record":false}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });

  it("ignores a code-first row so live config keeps precedence", async () => {
    const adapter = adapterReturning({
      collections: [
        { slug: "posts", source: "code", webhooks: '{"record":false}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(adapter, {
      collections: new Set(["posts"]),
      singles: new Set(),
    });

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("ignores a row whose slug the live config owns even when it is not marked code", async () => {
    // A config entity whose row has not been reconciled still belongs to code.
    const adapter = adapterReturning({
      collections: [
        { slug: "posts", source: "ui", webhooks: '{"record":false}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(adapter, {
      collections: new Set(["posts"]),
      singles: new Set(),
    });

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("accepts an already-parsed object, as the json dialects return", async () => {
    const adapter = adapterReturning({
      singles: [{ slug: "contact", source: "ui", webhooks: { record: false } }],
    });

    await publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs);

    expect(isWebhookRecordingEnabled("single", "contact")).toBe(false);
  });

  it("leaves recording on for a row that stored no opt-out", async () => {
    const adapter = adapterReturning({
      collections: [{ slug: "posts", source: "ui", webhooks: null }],
    });

    await publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("leaves recording on when the column does not exist yet", async () => {
    // An install that has not run `nextly migrate` since upgrading has no
    // `webhooks` column. The select throws and boot must continue recording
    // rather than fail, because the column is additive.
    const adapter = {
      executeQuery: vi.fn(async () => {
        throw new Error('column "webhooks" does not exist');
      }),
    };

    await expect(
      publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs)
    ).resolves.toBeUndefined();
    expect(isWebhookRecordingEnabled("collection", "anything")).toBe(true);
  });

  it("keeps collection opt-outs when the singles registry is unreadable", async () => {
    // The two scopes are read independently so one unreadable table cannot
    // discard decisions the other just published.
    const adapter = {
      executeQuery: vi.fn(async (sql: string) => {
        if (sql.includes("dynamic_collections")) {
          return [
            { slug: "enquiries", source: "ui", webhooks: '{"record":false}' },
          ];
        }
        throw new Error("no such table: dynamic_singles");
      }),
    };

    await publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });

  it("never overrides an opt-out already published by code or plugin", async () => {
    // The stored publisher only ever writes opt-outs, and skips config-owned
    // slugs, so a plugin's decision cannot be undone by a stale row.
    setWebhookRecording("collection", "form-submissions", false, "plugin");
    const adapter = adapterReturning({
      collections: [{ slug: "form-submissions", source: "ui", webhooks: null }],
    });

    await publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
      false
    );
  });

  it("tolerates a malformed stored value instead of throwing at boot", async () => {
    const adapter = adapterReturning({
      collections: [{ slug: "posts", source: "ui", webhooks: "not json" }],
    });

    await publishStoredWebhookRecordingPolicies(adapter, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });
});
