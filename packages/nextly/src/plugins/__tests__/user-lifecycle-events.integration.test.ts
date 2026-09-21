/**
 * Plugins are told when a user is created or deleted.
 *
 * Without an in-process event a plugin has no way to clean up what it stored
 * against a user: the webhook outbox row is durable but reaches nothing inside
 * this process, so a plugin holding an external identity for a deleted account
 * would keep it forever — and the next person to be given that id inherits it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { ServiceContainer } from "../../services/index";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({});
  for (const statement of generateSqliteCoreTableStatements()) {
    await current.adapter.executeQuery(statement);
  }
  return current;
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
    t.events.on("user.created", p => seen.push(p as { userId: string }));

    const userId = await makeUser(t, "created@example.com");
    await t.events.settle();

    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(userId);
  });

  it("tells a subscriber when a user is deleted", async () => {
    const t = await boot();
    const userId = await makeUser(t, "deleted@example.com");

    const seen: Array<{ userId: string }> = [];
    t.events.on("user.deleted", p => seen.push(p as { userId: string }));

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
    t.events.on("user.deleted", p => seen.push(p));

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
    t.events.on("user.created", p => seen.push(p as Record<string, unknown>));

    await makeUser(t, "private@example.com");
    await t.events.settle();

    expect(Object.keys(seen[0])).toEqual(["userId"]);
    expect(JSON.stringify(seen[0])).not.toContain("private@example.com");
  });
});
