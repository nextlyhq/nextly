/**
 * How REST answers the refusals the access table has no caller for.
 *
 * The table's callers all present a credential that is valid, or none at all,
 * and its limits never refuse. These are the other refusals: a credential
 * that is not valid (an unknown key, a revoked key, a key whose creator is
 * deactivated, a session cookie that is malformed or expired), a request no
 * credential comes with, and each limit that answers 429 (the per-address
 * limit, the one for requests whose address cannot be read, an address's
 * sign-in limit, an API key's own budget and a plugin route's limit). Each is
 * recorded as the table's refusals are, status, code, body shape and message,
 * in `access-every-way-in/refusal-cases-today.txt`, so a change to how any of
 * them is answered shows as a diff of that file.
 *
 * Beside them, a list a reader may make is answered 200 and leaves out the
 * rows they may not read, rather than being refused.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { container } from "../../di/container";
import {
  account,
  role,
  seedPermissions,
} from "../../direct-api/__tests__/checked-access-fixtures";
import type { RateLimitStore } from "../../middleware/rate-limit";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { sanitizeConfig } from "../../shared/types/config";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import { resetSessionStandingForTests } from "../session/session-standing";

import {
  formatRefusal,
  refusalOf,
  type Refusal,
} from "./access-every-way-in/refusals";

const ORIGIN = "http://localhost";
const NOTES = "refusalnotes";
const CASES_FILE = join(
  __dirname,
  "access-every-way-in",
  "refusal-cases-today.txt"
);
const LIMITED_PLUGIN = "refusalcases";

/** A plugin route allowing one request a minute, so the second is refused. */
const limitedPlugin = definePlugin({
  name: LIMITED_PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/limited",
        public: true,
        rateLimit: { max: 1, windowMs: 60_000 },
        handler: () => Response.json({ ok: true }),
      },
    ],
  },
});

interface KeyService {
  createApiKey(
    owner: string,
    input: { name: string; tokenType: "read-only"; expiresIn: "unlimited" }
  ): Promise<{ key: string; meta: { id: string } }>;
  revokeApiKey(
    id: string,
    owner: string,
    opts: { allUsers: boolean }
  ): Promise<unknown>;
}

/** The collection every case reads. */
const notes = defineCollection({
  slug: NOTES,
  status: true,
  fields: [text({ name: "title" })],
});

/** An address a trusted proxy names as the client's. */
const CLIENT_ADDRESS = "203.0.113.7";

function request(
  segments: string[],
  headers: Record<string, string> = {},
  handlers: ReturnType<typeof createDynamicHandlers> = createDynamicHandlers()
): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}`, {
    headers: { origin: ORIGIN, ...headers },
  });
  return handlers.GET(req, {
    params: Promise.resolve({ params: segments }),
  });
}

/**
 * The REST handler behind a proxy the site trusts, so a client's address
 * resolves from the header the proxy sets, and is counted under it.
 */
function handlersBehindProxy(): ReturnType<typeof createDynamicHandlers> {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: [notes],
      plugins: [limitedPlugin],
      security: { trustProxy: true },
    }),
  });
}

/** A JSON POST, from the trusted proxy's client. */
function postFromClient(
  segments: string[],
  body: unknown,
  handlers: ReturnType<typeof createDynamicHandlers>
): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": CLIENT_ADDRESS,
    },
    body: JSON.stringify(body),
  });
  return handlers.POST(req, { params: Promise.resolve({ params: segments }) });
}

/** A request's refusal, which every case below must be. */
async function refusalAt(res: Promise<Response>): Promise<Refusal> {
  const refusal = await refusalOf(await res);
  expect(refusal, "the request was refused").toBeDefined();
  return refusal!;
}

/**
 * A request's refusal by a limit: a 429, so a request refused for anything
 * else, such as wanting a credential, cannot stand in for the limit's answer.
 */
async function limitRefusalAt(res: Promise<Response>): Promise<Refusal> {
  const refusal = await refusalAt(res);
  expect(refusal.status, "the limit refused the request").toBe(429);
  return refusal;
}

/**
 * Runs `work` with every limit counted in a store that refuses the keys
 * `refuses` picks, and counts the rest where they counted before.
 */
async function refusingLimits<T>(
  refuses: (key: string) => boolean,
  work: () => Promise<T>
): Promise<T> {
  const counted = container.get<RateLimitStore>("coreRateLimitStore");
  const refusing: RateLimitStore = {
    increment: (key, windowMs) =>
      refuses(key)
        ? Promise.resolve({
            count: Number.MAX_SAFE_INTEGER,
            resetTime: Date.now() + windowMs,
          })
        : counted.increment(key, windowMs),
    reset: key => counted.reset(key),
    consume: (key, limit, windowMs) =>
      refuses(key)
        ? Promise.resolve({
            count: limit + 1,
            resetTime: Date.now() + windowMs,
            allowed: false,
          })
        : counted.consume
          ? counted.consume(key, limit, windowMs)
          : counted
              .increment(key, windowMs)
              .then(r => ({ ...r, allowed: r.count <= limit })),
  };
  container.register<RateLimitStore>("coreRateLimitStore", () => refusing);
  try {
    return await work();
  } finally {
    container.register<RateLimitStore>("coreRateLimitStore", () => counted);
  }
}

describe.each(getConfiguredTestDialects())(
  "refusals the access table has no caller for (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let ownerId: string;
    let readerId: string;
    let readerRoleId: string;
    const cases = new Map<string, Refusal>();

    async function cookieOf(userId: string, roleIds: string[], ttl = 900) {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: "reader",
          image: null,
          roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? "",
        ttl
      );
      return `nextly_session=${token}`;
    }

    function keys(): KeyService {
      return t.getService("apiKeyService") as unknown as KeyService;
    }

    async function keyOf(owner: string): Promise<{ key: string; id: string }> {
      const made = await keys().createApiKey(owner, {
        name: "case key",
        tokenType: "read-only",
        expiresIn: "unlimited",
      });
      return { key: made.key, id: made.meta.id };
    }

    const entries = ["collections", NOTES, "entries"];

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [limitedPlugin],
        collections: [notes],
        // The auth routes read the proxy they trust from the app's config, so
        // the sign-in case can name its client through one; a request naming
        // no client is unresolved whatever this says.
        security: { trustProxy: true },
      });
      await seedPermissions(t);
      ownerId = await account(t, "owner@example.com");
      readerRoleId = await role(t, "note-readers", [`read-${NOTES}`]);
      readerId = await account(t, "reader@example.com", [readerRoleId]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("a credential that is not valid", () => {
      it("an unknown key", async () => {
        cases.set(
          "unknown key",
          await refusalAt(
            request(entries, { authorization: "Bearer nx_not_a_key_at_all" })
          )
        );
      });

      it("a revoked key", async () => {
        const { key, id } = await keyOf(readerId);
        await keys().revokeApiKey(id, readerId, { allUsers: true });
        cases.set(
          "revoked key",
          await refusalAt(request(entries, { authorization: `Bearer ${key}` }))
        );
      });

      it("a key whose creator is deactivated", async () => {
        const maker = await account(t, "maker@example.com", [readerRoleId]);
        const { key } = await keyOf(maker);
        await t.nextly.users.update({ id: maker, data: { isActive: false } });
        resetSessionStandingForTests();
        cases.set(
          "deactivated creator's key",
          await refusalAt(request(entries, { authorization: `Bearer ${key}` }))
        );
      });

      it("a malformed session cookie", async () => {
        cases.set(
          "malformed session",
          await refusalAt(
            request(entries, { cookie: "nextly_session=not-a-token" })
          )
        );
      });

      it("an expired session cookie", async () => {
        cases.set(
          "expired session",
          await refusalAt(
            request(entries, {
              cookie: await cookieOf(readerId, [readerRoleId], -60),
            })
          )
        );
      });
    });

    describe("no credential", () => {
      it("a visitor listing a collection", async () => {
        cases.set("visitor", await refusalAt(request(entries)));
      });
    });

    describe("a limit", () => {
      it("the per-address limit", async () => {
        // An address resolves only through a proxy the site trusts, so the
        // handler trusts one, and only that address's own budget is spent.
        const behindProxy = handlersBehindProxy();
        cases.set(
          "address limit",
          await refusingLimits(
            key => key === `ratelimit:${CLIENT_ADDRESS}:read`,
            () =>
              limitRefusalAt(
                request(
                  entries,
                  { "x-forwarded-for": CLIENT_ADDRESS },
                  behindProxy
                )
              )
          )
        );
      });

      it("the limit for requests whose address cannot be read", async () => {
        cases.set(
          "unresolved-address limit",
          await refusingLimits(
            key => key === "ratelimit:unresolved:read",
            () => limitRefusalAt(request(entries))
          )
        );
      });

      it("an API key's own budget", async () => {
        const { key, id } = await keyOf(readerId);
        cases.set(
          "key budget",
          await refusingLimits(
            counted => counted === id,
            () =>
              limitRefusalAt(
                request(entries, { authorization: `Bearer ${key}` })
              )
          )
        );
      });

      it("the sign-in limit for an address", async () => {
        // The auth routes count each address apart from the REST limit.
        cases.set(
          "auth route limit",
          await refusingLimits(
            key => key === `auth-ip:${CLIENT_ADDRESS}`,
            () =>
              limitRefusalAt(
                postFromClient(
                  ["auth", "login"],
                  { email: "reader@example.com", password: "Password123!" },
                  handlersBehindProxy()
                )
              )
          )
        );
      });

      it("a plugin route's limit", async () => {
        const path = ["plugins", LIMITED_PLUGIN, "limited"];
        expect((await request(path)).status, "the first request").toBe(200);
        cases.set("plugin route limit", await limitRefusalAt(request(path)));
      });
    });

    describe("a list a reader may make", () => {
      it("is answered 200, leaving out the rows they may not read", async () => {
        const live = await t.nextly.create({
          collection: NOTES,
          data: { title: "live", status: "published" },
          user: { id: ownerId },
        });
        const draft = await t.nextly.create({
          collection: NOTES,
          data: { title: "draft", status: "draft" },
          user: { id: ownerId },
        });
        const res = await request(entries, {
          cookie: await cookieOf(readerId, [readerRoleId]),
        });
        expect(res.status).toBe(200);
        const ids = (
          (await res.json()) as { items: { id: unknown }[] }
        ).items.map(item => String(item.id));
        expect(ids).toContain(String((live.item as { id: unknown }).id));
        expect(ids).not.toContain(String((draft.item as { id: unknown }).id));
      });
    });

    describe("today's answers", () => {
      it("are the answers the file records", async () => {
        // POPULATION CONTROL: every case above recorded its refusal.
        expect(cases.size).toBe(11);
        const recorded = [...cases.entries()]
          .map(([name, refusal]) => formatRefusal(name, refusal))
          .join("\n");
        await expect(`${recorded}\n`).toMatchFileSnapshot(CASES_FILE);
      });
    });
  }
);
