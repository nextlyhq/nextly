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

interface Row {
  slug: string | null;
  source: string | null;
  webhooks: unknown;
}

/**
 * A Drizzle stub that answers each registry table from a fixture. The table is
 * identified by the object the query is built `from`, which is the real dialect
 * table, so the stub cannot drift from the column names the code selects.
 */
function readerReturning(rows: { collections?: Row[]; singles?: Row[] }) {
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: <T>() =>
      ({
        select: () => ({
          from: (
            table: { slug: { name?: string } } & Record<string, unknown>
          ) => ({
            where: async () => {
              // Both registry tables declare a `slug` column; the table name
              // lives on Drizzle's internal symbol, so match on the object
              // identity the caller passed instead.
              const isSingles = String(
                (table as { _?: { name?: string } })._?.name ?? ""
              ).includes("singles");
              return isSingles
                ? (rows.singles ?? [])
                : (rows.collections ?? []);
            },
          }),
        }),
      }) as T,
  };
}

/** A reader whose registry read fails with the given error. */
function readerThrowing(error: Error) {
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: <T>() =>
      ({
        select: () => ({
          from: () => ({
            where: vi.fn(async () => {
              throw error;
            }),
          }),
        }),
      }) as T,
  };
}

const noConfigSlugs = {
  collections: new Set<string>(),
  singles: new Set<string>(),
};

describe("publishStoredWebhookRecordingPolicies", () => {
  it("applies a stored opt-out for a builder-authored collection", async () => {
    const reader = readerReturning({
      collections: [
        { slug: "enquiries", source: "ui", webhooks: '{"record":false}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });

  it("ignores a code-first row so live config keeps precedence", async () => {
    const reader = readerReturning({
      collections: [
        { slug: "posts", source: "code", webhooks: '{"record":false}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(reader, {
      collections: new Set(["posts"]),
      singles: new Set(),
    });

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("ignores a row whose slug the live config owns even when it is not marked code", async () => {
    // A config entity whose row has not been reconciled still belongs to code.
    const reader = readerReturning({
      collections: [
        { slug: "posts", source: "ui", webhooks: '{"record":false}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(reader, {
      collections: new Set(["posts"]),
      singles: new Set(),
    });

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("accepts an already-parsed object, as the json dialects return", async () => {
    const reader = readerReturning({
      collections: [
        { slug: "contact", source: "ui", webhooks: { record: false } },
      ],
    });

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "contact")).toBe(false);
  });

  it("leaves recording on for a row that stored no opt-out", async () => {
    const reader = readerReturning({
      collections: [{ slug: "posts", source: "ui", webhooks: null }],
    });

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });

  it("leaves recording on when the column does not exist yet", async () => {
    // An install that has not run `nextly migrate` since upgrading has no
    // `webhooks` column. That one case fails open: the column is additive, so
    // recording everything is the correct previous behavior. A driver error is
    // used deliberately — the classification reads the driver's message, so a
    // NextlyError here would stop exercising what the guard actually inspects.
    const reader = readerThrowing(
      new Error('column "webhooks" does not exist')
    );

    await expect(
      publishStoredWebhookRecordingPolicies(reader, noConfigSlugs)
    ).resolves.toBeUndefined();
    expect(isWebhookRecordingEnabled("collection", "anything")).toBe(true);
  });

  it("recognises the missing column through Drizzle's wrapper error", async () => {
    // Drizzle reports `Failed query: ...` and hangs the driver's real message
    // off `cause`. Inspecting only the wrapper would misread a pre-migration
    // database as a hard failure and refuse to boot.
    const wrapped = new Error("Failed query: select `webhooks` from ...", {
      cause: new Error("Unknown column 'webhooks' in 'field list'"),
    });

    await expect(
      publishStoredWebhookRecordingPolicies(
        readerThrowing(wrapped),
        noConfigSlugs
      )
    ).resolves.toBeUndefined();
  });

  it("still fails closed when a wrapped error is not a missing column", async () => {
    const wrapped = new Error("Failed query: select `webhooks` from ...", {
      cause: new Error("Table 'nextly_test.dynamic_collections' doesn't exist"),
    });

    await expect(
      publishStoredWebhookRecordingPolicies(
        readerThrowing(wrapped),
        noConfigSlugs
      )
    ).rejects.toThrow("Failed query");
  });

  it("fails closed when the registry read fails for any other reason", async () => {
    // A transient failure is indistinguishable from "no opt-outs" to this
    // function. Swallowing it would boot with recording enabled and deliver
    // exactly the content an operator asked to withhold, so it must propagate.
    const reader = readerThrowing(new Error("connection terminated"));

    await expect(
      publishStoredWebhookRecordingPolicies(reader, noConfigSlugs)
    ).rejects.toThrow("connection terminated");
  });

  it("never overrides a decision the config publisher already made", async () => {
    // A stale row carrying a CONFLICTING opt-in must not undo a plugin opt-out:
    // config-owned slugs are skipped outright, and only opt-outs are published.
    setWebhookRecording("collection", "form-submissions", false, "plugin");
    const reader = readerReturning({
      collections: [
        { slug: "form-submissions", source: "ui", webhooks: '{"record":true}' },
      ],
    });

    await publishStoredWebhookRecordingPolicies(reader, {
      collections: new Set(["form-submissions"]),
      singles: new Set(),
    });

    expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
      false
    );
  });

  it("tolerates a malformed stored value instead of throwing at boot", async () => {
    const reader = readerReturning({
      collections: [{ slug: "posts", source: "ui", webhooks: "not json" }],
    });

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
  });
});
