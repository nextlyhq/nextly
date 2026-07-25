import { afterEach, describe, it, expect, vi } from "vitest";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { recordMutationEvent } from "../record-mutation-event";
import {
  resetWebhookRecordingPolicy,
  setWebhookRecording,
} from "../recording-policy";

afterEach(() => {
  resetWebhookRecordingPolicy();
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
  it("records an outbox event for a collection with no opt-out", async () => {
    const { tx, insert } = makeTx();
    await recordMutationEvent(tx, entryArgs("posts"));
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("records nothing for a collection that opted out", async () => {
    setWebhookRecording("collection", "submissions", false);
    const { tx, insert } = makeTx();
    await recordMutationEvent(tx, entryArgs("submissions"));
    expect(insert).not.toHaveBeenCalled();
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
