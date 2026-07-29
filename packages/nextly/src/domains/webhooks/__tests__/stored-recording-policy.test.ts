// Why: a Builder-authored opt-out lives only in the registry column, so boot
// has to read it back or the switch silently lapses on every restart and the
// collection resumes recording content the operator chose to keep out of the
// outbox. Code-first entities are excluded because the config publisher already
// applied them from live config, which outranks a row that may be stale.
import { getTableName } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyStoredRecordingDecisions,
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
function readerReturning(rows: {
  collections?: Row[] | Error;
  singles?: Row[] | Error;
}) {
  return {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: <T>() =>
      ({
        select: () => ({
          from: (table: Parameters<typeof getTableName>[0]) => ({
            where: async () => {
              // Drizzle keeps the table name under symbol metadata, so a plain
              // property read is always undefined — which silently routed both
              // queries to the collections fixture and left the Singles branch
              // untested. `getTableName` reads the real name.
              const result = getTableName(table).includes("singles")
                ? (rows.singles ?? [])
                : (rows.collections ?? []);
              if (result instanceof Error) throw result;
              return result;
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

  it("tolerates a registry table that does not exist yet", async () => {
    // No table means no entities, so no opt-outs can exist and recording
    // everything is correct. It also keeps the deliberately failure-safe
    // first-run path intact: when registry provisioning fails,
    // `initializeSchemaRegistry` swallows it so boot can reach the recovery
    // path, and this read must not turn that into a hard abort.
    const missingTable = new Error("Failed query: select `webhooks` from ...", {
      cause: new Error("Table 'nextly_test.dynamic_collections' doesn't exist"),
    });

    await expect(
      publishStoredWebhookRecordingPolicies(
        readerThrowing(missingTable),
        noConfigSlugs
      )
    ).resolves.toBeUndefined();
  });

  it("fails closed when a DIFFERENT column is missing", async () => {
    // A damaged registry missing some other selected column reports the same
    // generic wording. Treating that as the tolerated upgrade case would drop
    // every stored opt-out instead of surfacing the broken schema.
    const wrapped = new Error("Failed query: select `source` from ...", {
      cause: new Error('column "source" does not exist'),
    });

    await expect(
      publishStoredWebhookRecordingPolicies(
        readerThrowing(wrapped),
        noConfigSlugs
      )
    ).rejects.toThrow();
  });

  it("fails closed when the registry read fails for any other reason", async () => {
    // A transient failure is indistinguishable from "no opt-outs" to this
    // function. Swallowing it would boot with recording enabled and deliver
    // exactly the content an operator asked to withhold, so it must propagate.
    const reader = readerThrowing(new Error("connection terminated"));

    await expect(
      publishStoredWebhookRecordingPolicies(reader, noConfigSlugs)
      // Surfaced as the canonical error type, with the driver failure preserved
      // as the cause rather than thrown raw.
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      cause: expect.objectContaining({ message: "connection terminated" }),
    });
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

  it("skips a plugin-owned row so the refresh cannot drop its opt-out", async () => {
    // Plugin entities register as `plugin:<name>`. Publishing one as `db` would
    // let the next refresh — which replaces the whole `db` set — delete the
    // form-builder's submissions opt-out and resume recording PII.
    const reader = readerReturning({
      collections: [
        {
          slug: "form-submissions",
          source: "plugin:@nextlyhq/plugin-form-builder",
          webhooks: '{"record":false}',
        },
      ],
    });

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    // Not published as `db`, so a later swap leaves the plugin decision intact.
    applyStoredRecordingDecisions([]);
    expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
      true
    );
  });

  it("keeps the migrated scope's opt-outs when the other lacks the column", async () => {
    // An upgrade interrupted between the two ALTERs (MySQL DDL auto-commits)
    // must not discard opt-outs already read from the migrated table.
    const reader = readerReturning({
      collections: [
        { slug: "enquiries", source: "ui", webhooks: '{"record":false}' },
      ],
      singles: new Error("Unknown column 'webhooks' in 'field list'"),
    });

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });

  it("discards a snapshot older than a local toggle", async () => {
    // The read happens first; a Builder toggle lands before it applies. The
    // stale snapshot must not erase the newer decision.
    const reader = {
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      getDrizzle: <T>() =>
        ({
          select: () => ({
            from: () => ({
              where: async () => {
                // Simulates the local update committing mid-read.
                setWebhookRecording("collection", "enquiries", false, "db");
                return [];
              },
            }),
          }),
        }) as T,
    };

    await publishStoredWebhookRecordingPolicies(reader, noConfigSlugs);

    expect(isWebhookRecordingEnabled("collection", "enquiries")).toBe(false);
  });
});
