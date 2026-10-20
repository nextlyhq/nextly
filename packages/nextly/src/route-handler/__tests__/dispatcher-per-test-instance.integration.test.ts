/**
 * Each test instance answers REST dispatcher routes from its own database.
 *
 * The REST catch-all keeps one `ServiceDispatcher` for the life of the
 * process, built on the adapter that was registered when it was first asked
 * for. A server has one adapter for its whole life, so that is right there.
 * A test file is different: it boots one instance after another in the same
 * process, and each `destroy()` disconnects the adapter the cached dispatcher
 * still holds. The next instance's dispatcher routes then ran against that
 * closed adapter and answered 500, or, had it stayed open, against the
 * previous instance's data.
 *
 * Two instances in one file, each holding one account the other does not,
 * read `GET /api/users` in turn. The users list is served by the dispatcher
 * rather than a direct-dispatch handler, so it is the route the cache decides.
 * Each instance must answer 200 and list its own account and not the other's.
 */

// API keys sign with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { seedPermissions } from "../../database/seeders";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { sanitizeConfig } from "../../shared/types/config";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Boot an instance whose only account is `email`, and return a key of that
 * account for a role holding `read-users`, so the request reaches the list
 * rather than stopping at authorization.
 */
async function boot(dialect: TestDialect, email: string): Promise<string> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  const nextly = current.nextly as unknown as {
    users: {
      create: (a: {
        data: Record<string, unknown>;
      }) => Promise<{ item: { id: string } }>;
    };
    permissions: {
      find: (a: {
        limit: number;
      }) => Promise<{ items: { id: string; slug: string }[] }>;
    };
    roles: {
      create: (a: {
        data: Record<string, unknown>;
      }) => Promise<{ item: { id: string } }>;
    };
  };
  const account = await nextly.users.create({
    data: { email, password: "Str0ng-P@ssw0rd!", name: email, isActive: true },
  });

  // The core permissions are seeded by first-run setup, which a harness
  // instance never runs, so they are seeded here as setup seeds them.
  await seedPermissions(current.adapter, { silent: true });
  const permissions = await nextly.permissions.find({ limit: 300 });
  const readUsers = permissions.items.find(p => p.slug === "read-users");
  expect(
    readUsers,
    "`read-users` must be seeded, or every answer is a refusal for the wrong reason"
  ).toBeDefined();
  const role = await nextly.roles.create({
    data: {
      name: "User reader",
      slug: "user-reader",
      permissionIds: [readUsers!.id],
    },
  });

  const apiKeys = current.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(String(account.item.id), {
    name: "reader",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** `GET /api/users` through the handler a Next.js route mounts. */
async function listUsers(
  key: string
): Promise<{ status: number; emails: string[]; text: string }> {
  const res = await createDynamicHandlers({
    config: sanitizeConfig({ collections: [] }),
  }).GET(
    new Request("http://localhost/api/users", {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params: ["users"] }) }
  );
  const text = await res.text();
  let emails: string[] = [];
  if (res.ok) {
    const body = JSON.parse(text) as { items?: { email: string }[] };
    emails = (body.items ?? []).map(u => u.email).sort();
  }
  return { status: res.status, emails, text };
}

describe.each(getConfiguredTestDialects())(
  "REST dispatcher per test instance (%s)",
  dialect => {
    it("serves each instance's users from that instance", async () => {
      const firstKey = await boot(dialect, "first@example.com");
      const first = await listUsers(firstKey);
      expect(first.status, first.text).toBe(200);
      expect(first.emails).toEqual(["first@example.com"]);

      // The first instance is gone before the second boots, as between two
      // tests of one file.
      await current!.destroy();
      current = undefined;

      const secondKey = await boot(dialect, "second@example.com");
      const second = await listUsers(secondKey);
      expect(second.status, second.text).toBe(200);
      expect(second.emails).toEqual(["second@example.com"]);
    });
  }
);
