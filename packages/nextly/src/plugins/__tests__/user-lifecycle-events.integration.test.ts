/**
 * Plugins are told when a user is created or deleted.
 *
 * Without an in-process event a plugin has no way to clean up what it stored
 * against a user: the webhook outbox row is durable but reaches nothing inside
 * this process, so a plugin holding an external identity for a deleted account
 * would keep it forever — and the next person to be given that id inherits it.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  endpointsPresent,
  isWebhookAuditEnabled,
  refreshEndpointPresence,
  resetWebhookActivation,
  setEndpointPresenceRefresher,
  setWebhookAuditEnabled,
} from "../../domains/webhooks/recording-activation";

import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { ServiceContainer } from "../../services/index";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Module-level state, so a primed flag would otherwise leak into the next
  // test and quietly change what it is measuring.
  resetWebhookActivation();
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({});
  for (const statement of generateSqliteCoreTableStatements()) {
    await current.adapter.executeQuery(statement);
  }
  return current;
}

/**
 * Boot with recording OFF, which is what "no webhook endpoint" means here.
 *
 * `recordMutationEventInTx` returns false when the install has no enabled
 * endpoint and webhook auditing is disabled — the common installation. That
 * answer is about the OUTBOX, not about the account, so gating the in-process
 * event on it suppressed `user.created` exactly where webhooks were never in
 * use. The presence flag FAILS OPEN until primed, which is why it has to be
 * primed here rather than left at its default.
 */
async function bootWithRecordingOff(): Promise<TestNextly> {
  const t = await boot();
  setWebhookAuditEnabled(false);
  setEndpointPresenceRefresher(() => Promise.resolve(false));
  await refreshEndpointPresence();
  // The premise, asserted rather than assumed: unprimed this reads TRUE, and
  // the test would then run against the same conditions as every other one.
  expect(endpointsPresent()).toBe(false);
  expect(isWebhookAuditEnabled()).toBe(false);
  return t;
}

function services(t: TestNextly) {
  return new ServiceContainer(t.adapter);
}

async function makeUser(t: TestNextly, email: string): Promise<string> {
  const created = await services(t).users.createLocalUser({
    email,
    name: "Subject",
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

describe("user lifecycle events", () => {
  it("tells a subscriber when a user is created", async () => {
    const t = await boot();
    const seen: Array<{ userId: string }> = [];
    t.events.on("user.created", e => {
      seen.push(e.payload as { userId: string });
    });

    const userId = await makeUser(t, "created@example.com");
    await t.events.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(userId);
  });

  it("tells a subscriber when a user is deleted", async () => {
    const t = await boot();
    const userId = await makeUser(t, "deleted@example.com");

    const seen: Array<{ userId: string }> = [];
    t.events.on("user.deleted", e => {
      seen.push(e.payload as { userId: string });
    });

    await services(t).users.deleteUser(userId);
    await t.events.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(userId);
  });

  it("does not emit for a delete that removed no row", async () => {
    // Two concurrent deletes both read the account and only one removes it.
    // Emitting from the loser would hand subscribers a second deletion for a
    // user that was already gone.
    const t = await boot();
    const userId = await makeUser(t, "once@example.com");

    const seen: unknown[] = [];
    t.events.on("user.deleted", e => {
      seen.push(e.payload);
    });

    await services(t).users.deleteUser(userId);
    await services(t)
      .users.deleteUser(userId)
      .catch(() => undefined);
    await t.events.settle();

    expect(seen).toHaveLength(1);
  });

  it("carries only the id, never the person's details", async () => {
    // The payload outlives the account in whatever a subscriber does with it.
    const t = await boot();
    const seen: Array<Record<string, unknown>> = [];
    t.events.on("user.created", e => {
      seen.push(e.payload as Record<string, unknown>);
    });

    await makeUser(t, "private@example.com");
    await t.events.settle();

    expect(Object.keys(seen[0])).toEqual(["userId"]);
    expect(JSON.stringify(seen[0])).not.toContain("private@example.com");
  });

  it("tells a subscriber even when the webhook outbox took no row", async () => {
    // The separating property. `recorded` answers whether the outbox accepted
    // a row, not whether the account was created, so an install with no
    // webhook endpoint never told its plugins a user existed.
    const t = await bootWithRecordingOff();
    const seen: Array<{ userId: string }> = [];
    t.events.on("user.created", e => {
      seen.push(e.payload as { userId: string });
    });

    const userId = await makeUser(t, "no-outbox@example.com");
    await t.events.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(userId);
  });

  it("tells a subscriber about a DELETE without the outbox too", async () => {
    const t = await bootWithRecordingOff();
    const userId = await makeUser(t, "no-outbox-delete@example.com");
    const seen: Array<{ userId: string }> = [];
    t.events.on("user.deleted", e => {
      seen.push(e.payload as { userId: string });
    });

    await services(t).users.deleteUser(userId);
    await t.events.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(userId);
  });
});
