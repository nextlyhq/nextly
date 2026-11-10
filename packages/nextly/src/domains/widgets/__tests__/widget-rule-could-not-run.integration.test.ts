/**
 * A dashboard card whose collection's read rule could not run says so: its
 * slot carries `RULE_COULD_NOT_RUN` naming the collection, or the whole batch
 * ends with that 503.
 *
 * Through `POST /api/dashboard/query`, the request the dashboard makes, with a
 * key holding the collection's read grant, so the rule is what decides. A rule
 * whose own query waited out the bound for a database connection never
 * answered. The plausible broken implementation, the one the batch had, files
 * the rejected read decision as any other failure: a slot with the generic
 * sentence and no code, which the card draws as an unexplained error, or as a
 * source the reader may not read. The control is the same card with the rule
 * answering, which counts the entry and shows the fixture reaches the rule.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import { clearSources } from "../sources";

const NOTES = "widgetrulenotes";

interface Slot {
  ok: boolean;
  error?: string;
  code?: string;
  subject?: string;
  result?: { op: string };
}

/** Armed after seeding, so the boot and the trusted writes never ask it. */
interface Probe {
  armed: boolean;
  calls: number;
}

let current: TestNextly | undefined;
afterEach(async () => {
  clearSources();
  await current?.destroy();
  current = undefined;
});

interface AdminApi {
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

async function boot(dialect: TestDialect, probe: Probe): Promise<string> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: NOTES,
        access: {
          // The rule's own query waited out the pool's bound, as the adapter
          // reports it.
          read: () => {
            if (!probe.armed) return true;
            probe.calls += 1;
            throw poolWaitTimeoutError(15_000);
          },
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  await current.nextly.create({
    collection: NOTES,
    data: { title: "A note" },
  });
  clearSources();
  return keyReadingNotes(current);
}

/**
 * A key holding `read-<notes>` alone, minted by the install's first user, its
 * super-admin, through the role table the product reads.
 */
async function keyReadingNotes(t: TestNextly): Promise<string> {
  const api = t.nextly as unknown as AdminApi;
  // The first user an instance creates, active, is its super-admin.
  const ownerId = await seedLiveAuthor(t);
  const slug = `read-${NOTES}`;
  const seeded = await api.permissions.find({ limit: 1000 });
  const permissionId =
    seeded.items.find(permission => permission.slug === slug)?.id ??
    (
      await api.permissions.create({
        data: { action: "read", resource: NOTES, name: `read ${NOTES}`, slug },
      })
    ).item.id;
  const role = await api.roles.create({
    data: {
      name: "Note readers",
      slug: "note-readers",
      permissionIds: [permissionId],
    },
  });
  const { key } = await (
    t.getService("apiKeyService") as unknown as ApiKeys
  ).createApiKey(ownerId, {
    name: "notes key",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/**
 * The batch's answer for one count of the notes: its slot, or, where the
 * whole request ended, the error it ended with.
 */
async function countNotes(
  key: string
): Promise<{ status: number; slot?: Slot; error?: Record<string, unknown> }> {
  const res = await createDynamicHandlers().POST(
    new Request("http://localhost/api/dashboard/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        queries: [{ source: `collection:${NOTES}`, op: "count" }],
      }),
    }),
    { params: Promise.resolve({ params: ["dashboard", "query"] }) }
  );
  const body = (await res.json()) as {
    results?: Slot[];
    error?: Record<string, unknown>;
  };
  return { status: res.status, slot: body.results?.[0], error: body.error };
}

describe.each(getConfiguredTestDialects())(
  "a dashboard card whose collection's rule could not run (integration, %s)",
  dialect => {
    it("counts the entry while the rule answers", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const key = await boot(dialect, probe);

      const answer = await countNotes(key);

      expect(answer.status, JSON.stringify(answer)).toBe(200);
      expect(answer.slot?.ok, JSON.stringify(answer)).toBe(true);
      expect(answer.slot?.result?.op).toBe("count");
    });

    it("carries the rule's answer, naming the collection, not a bare failure", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const key = await boot(dialect, probe);

      probe.armed = true;
      const answer = await countNotes(key);

      expect(probe.calls, JSON.stringify(answer)).toBeGreaterThan(0);
      if (answer.status === 503) {
        // The whole batch ended with it.
        expect(answer.error).toMatchObject({
          code: "RULE_COULD_NOT_RUN",
          data: { subject: NOTES },
        });
        return;
      }
      expect(answer.status, JSON.stringify(answer)).toBe(200);
      expect(answer.slot).toMatchObject({
        ok: false,
        code: "RULE_COULD_NOT_RUN",
        subject: NOTES,
      });
    });
  }
);
