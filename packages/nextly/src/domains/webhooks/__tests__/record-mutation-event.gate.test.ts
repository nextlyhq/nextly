import { afterEach, describe, it, expect, vi } from "vitest";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { recordMutationEvent } from "../record-mutation-event";
import {
  resetWebhookActivation,
  setEndpointPresenceProvider,
  setWebhookAuditEnabled,
} from "../recording-activation";
import {
  resetWebhookRecordingPolicy,
  setWebhookRecording,
} from "../recording-policy";

afterEach(() => {
  resetWebhookRecordingPolicy();
  resetWebhookActivation();
});

// A minimal tx: only `insert` is exercised (recordEvent appends one outbox row).
function makeTx() {
  const insert = vi.fn().mockResolvedValue(undefined);
  return { tx: { insert } as unknown as TransactionContext, insert };
}

const entryArgs = (collection: string) => ({
  type: "entry.created" as const,
  resource: { kind: "entry" as const, collection, id: "e1" },
  data: { title: "hi" },
  previous: null,
  fields: [],
});

describe("recordMutationEvent recording gate", () => {
  it("records an outbox event and returns true for a collection with no opt-out", async () => {
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("posts"));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(recorded).toBe(true);
  });

  it("records nothing and returns false for a collection that opted out", async () => {
    setWebhookRecording("collection", "submissions", false);
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("submissions"));
    expect(insert).not.toHaveBeenCalled();
    expect(recorded).toBe(false);
  });

  it("records nothing for an opted-out single", async () => {
    setWebhookRecording("single", "secret_settings", false);
    const { tx, insert } = makeTx();
    await recordMutationEvent(tx, {
      type: "single.updated",
      resource: { kind: "single", slug: "secret_settings", id: "s1" },
      data: { title: "hi" },
      previous: null,
      fields: [],
    });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("recordMutationEvent endpoint/audit gate", () => {
  it("does not record when there are no endpoints and audit is off", async () => {
    setEndpointPresenceProvider(() => Promise.resolve(false));
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("posts"));
    expect(insert).not.toHaveBeenCalled();
    expect(recorded).toBe(false);
  });

  it("records when an endpoint is present", async () => {
    setEndpointPresenceProvider(() => Promise.resolve(true));
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("posts"));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(recorded).toBe(true);
  });

  it("records when audit is on even with no endpoints (skips the endpoint check)", async () => {
    const provider = vi.fn(() => Promise.resolve(false));
    setEndpointPresenceProvider(provider);
    setWebhookAuditEnabled(true);
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("posts"));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(recorded).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it("records (fail-open) when the endpoint provider throws", async () => {
    setEndpointPresenceProvider(() => Promise.reject(new Error("db down")));
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("posts"));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(recorded).toBe(true);
  });

  it("the per-entity opt-out still wins over a present endpoint", async () => {
    setEndpointPresenceProvider(() => Promise.resolve(true));
    setWebhookRecording("collection", "submissions", false);
    const { tx, insert } = makeTx();
    const recorded = await recordMutationEvent(tx, entryArgs("submissions"));
    expect(insert).not.toHaveBeenCalled();
    expect(recorded).toBe(false);
  });
});
