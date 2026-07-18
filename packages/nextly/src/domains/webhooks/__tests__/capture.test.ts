import { describe, it, expect } from "vitest";

import { buildCollectionEnvelope, toWebhookActor } from "../capture";

describe("toWebhookActor", () => {
  it("maps a user with an id to a user actor", () => {
    expect(toWebhookActor({ id: "u1" })).toEqual({ type: "user", id: "u1" });
  });

  it("maps an absent or id-less user to a system actor", () => {
    expect(toWebhookActor(null)).toEqual({ type: "system" });
    expect(toWebhookActor(undefined)).toEqual({ type: "system" });
    expect(toWebhookActor({})).toEqual({ type: "system" });
  });
});

describe("buildCollectionEnvelope", () => {
  const baseInput = {
    eventId: "evt_1",
    timestamp: new Date("2026-07-18T00:00:00.000Z"),
    type: "entry.created" as const,
    collection: "posts",
    docId: "p1",
    fields: [
      { name: "title", type: "text" },
      { name: "secret", type: "password" },
    ],
  };

  it("assembles an entry envelope with resource, actor, and timestamp", () => {
    const env = buildCollectionEnvelope({
      ...baseInput,
      data: { id: "p1", title: "Hello", secret: "hash" },
      actor: { type: "user", id: "u1" },
    });
    expect(env.type).toBe("entry.created");
    expect(env.resource).toEqual({
      kind: "entry",
      collection: "posts",
      id: "p1",
    });
    expect(env.timestamp).toBe("2026-07-18T00:00:00.000Z");
    expect(env.actor).toEqual({ type: "user", id: "u1" });
    expect(env.previous).toBeNull();
  });

  it("strips the collection's password/hidden fields from data and previous", () => {
    const env = buildCollectionEnvelope({
      ...baseInput,
      type: "entry.updated",
      data: { id: "p1", title: "New", secret: "h2" },
      previous: { id: "p1", title: "Old", secret: "h1" },
    });
    expect(env.data).toEqual({ id: "p1", title: "New" });
    expect(env.previous).toEqual({ id: "p1", title: "Old" });
    // The secret changed but was stripped, so it never appears in changedFields.
    expect(env.changedFields).toEqual(["title"]);
  });
});
