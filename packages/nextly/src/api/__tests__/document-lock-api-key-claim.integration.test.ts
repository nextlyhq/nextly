/**
 * A document claimed with an API key is named to the next editor as a key:
 * "<maker's name>'s API key", or "An API key" when its maker has no name.
 * Never "null", which is what the label was when only a session's name and
 * email were read and a key carries neither.
 *
 * Claimed through the REST dispatcher with a real key on each configured
 * dialect, and read back through the lock route, which is what a colleague's
 * editor asks: the label is stored with the claim, so it has to survive the
 * round trip through each dialect's row.
 *
 * @module api/__tests__/document-lock-api-key-claim.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../config";
import { getDialectTables } from "../../database/index";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "lock_apikey_notes";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface Holder {
  ownerLabel: string | null;
}

/** A lock route request with `key`, through the REST dispatcher. */
function lockRoute(
  method: "GET" | "POST",
  key: string,
  ref: { scopeKind: string; slug: string; entryId: string }
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const context = { params: Promise.resolve({ params: ["document-lock"] }) };
  if (method === "GET") {
    return handlers.GET(
      new Request(
        `http://localhost/api/document-lock?${new URLSearchParams(ref)}`,
        { headers: { authorization: `Bearer ${key}` } }
      ),
      context
    );
  }
  return handlers.POST(
    new Request("http://localhost/api/document-lock", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...ref, takeover: false, requestAccess: false }),
    }),
    context
  );
}

describe.each(getConfiguredTestDialects())(
  "a document claimed with an API key (%s)",
  (dialect: TestDialect) => {
    /**
     * A note, and a full-access key made by `maker`, who may edit and read
     * notes and is called `name` (no name at all when null).
     */
    async function boot(maker: string, name: string | null) {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: NOTES,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, maker, "update", [NOTES]);
      await grantTo(t, maker, "read", [NOTES]);
      const users = getDialectTables(t.adapter.dialect).users;
      await (
        t.adapter.getDrizzle() as unknown as {
          update(table: unknown): {
            set(values: unknown): {
              where(condition: unknown): Promise<unknown>;
            };
          };
        }
      )
        .update(users)
        .set({ name })
        .where(eq(users.id, maker));

      const apiKeys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const { key } = await apiKeys.createApiKey(maker, {
        name: "script",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      const created = await t.nextly.create({
        collection: NOTES,
        data: { title: "held by a script" },
      });
      const ref = {
        scopeKind: "collection",
        slug: NOTES,
        entryId: String((created.item as { id: string | number }).id),
      };
      return { key, ref };
    }

    /** Claims `ref` with `key`, then reads back who the route says holds it. */
    async function claimAndRead(
      key: string,
      ref: { scopeKind: string; slug: string; entryId: string }
    ): Promise<Holder | null> {
      const claimed = await lockRoute("POST", key, ref);
      expect(claimed.status, await claimed.clone().text()).toBe(200);
      const { item } = (await claimed.json()) as { item: { status: string } };
      expect(item.status).toBe("acquired");

      const read = await lockRoute("GET", key, ref);
      expect(read.status, await read.clone().text()).toBe(200);
      return ((await read.json()) as { holder: Holder | null }).holder;
    }

    it("names the key by its maker's name", async () => {
      const { key, ref } = await boot("lock-apikey-ana", "Ana");

      const holder = await claimAndRead(key, ref);

      expect(holder?.ownerLabel).toBe("Ana's API key");
    });

    it("names a key whose maker has the longest name a person may have, within the label's column", async () => {
      // 🔴 The label column is 255 characters on PostgreSQL and MySQL, as wide
      // as the widest name, and a key's label adds "'s API key" to that name.
      // Unbounded, the claim failed on those two and passed on SQLite.
      const longest = "N".repeat(255);
      const { key, ref } = await boot("lock-apikey-longname", longest);

      const holder = await claimAndRead(key, ref);

      expect(holder?.ownerLabel).toMatch(/^N+'s API key$/);
      expect(holder?.ownerLabel?.length).toBe(255);
    });

    it("names a key whose maker has no name as an API key", async () => {
      const { key, ref } = await boot("lock-apikey-nameless", null);

      const holder = await claimAndRead(key, ref);

      expect(holder?.ownerLabel).toBe("An API key");
    });
  }
);
