// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { mcpPlugin } from "../plugin";

/**
 * Who reaches the protocol, who is refused, and which check refused them.
 *
 * The endpoint delegates authentication to core rather than performing any of
 * its own, which is the whole reason it is a route contribution. That decision
 * is only worth anything if it is exercised end to end: a plugin route with a
 * mistyped `public`, or a dispatcher that stopped authenticating root-mounted
 * routes, both look exactly like this package working.
 *
 * The address guard is the half that cannot be seen without a credential. Core
 * answers an unauthenticated caller before the handler runs, so every
 * unauthenticated probe is a `401` whatever address it used, and the guard has
 * no part in it. Only a caller who HAS authenticated can demonstrate that the
 * guard runs at all, and that is the browser half of DNS rebinding: a real
 * session or key, sent from a page that had no business sending it.
 */
const ALLOWED = "cms.example.com";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The catch-all's params for an `/api/...` path, as Next.js supplies them. */
function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

function initialize(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    }),
  });
}

async function bootWithEndpoint() {
  current = await createTestNextly({
    plugins: [mcpPlugin({ enabled: true, allowedHosts: [ALLOWED] })],
  });
  return createDynamicHandlers();
}

/**
 * A real API key on a real user, minted through the service an operator uses.
 *
 * The first user of an install holds the seeded super-admin role, and a
 * read-only key is the obvious thing to hand an agent. Nothing here is a
 * fixture standing in for authentication: the token below is one core will
 * verify, and a change that stopped verifying it fails these cases rather than
 * passing them.
 */
async function readOnlyKey(handle: TestNextly): Promise<string> {
  const nextly = handle.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const owner = await nextly.users.create({
    data: {
      email: "agent-owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });

  const apiKeys = handle.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: { name: string; tokenType: string; expiresIn: string }
    ) => Promise<{ key: string; meta: { id: string } }>;
  };
  const { key } = await apiKeys.createApiKey(owner.item.id, {
    name: "an agent's read-only key",
    tokenType: "read-only",
    expiresIn: "never",
  });
  return key;
}

describe("what the endpoint answers, by who is asking", () => {
  it("refuses a caller with no credential, before the address is looked at", async () => {
    // The shape a DNS-rebinding attempt takes when the browser holds nothing
    // for this install. Core answers first and the handler never runs.
    const handlers = await bootWithEndpoint();

    const res = await handlers.POST(
      initialize({ host: "evil.example.com" }),
      params("mcp")
    );

    expect(res.status).toBe(401);
  });

  it("refuses a credential it cannot verify", async () => {
    // A bearer token that is not a key. Separates "authentication ran and said
    // no" from "no credential was present at all", which the case above cannot
    // distinguish on its own.
    const handlers = await bootWithEndpoint();

    const res = await handlers.POST(
      initialize({ host: ALLOWED, authorization: "Bearer not-a-real-key" }),
      params("mcp")
    );

    expect(res.status).toBe(401);
  });

  it("serves a real API key on an address it answers on", async () => {
    // The positive control the whole matrix rests on. Without it every refusal
    // below is equally satisfied by an endpoint that refuses everybody, which
    // is the state this package would be in if the route never mounted.
    const handlers = await bootWithEndpoint();
    const key = await readOnlyKey(current!);

    const res = await handlers.POST(
      initialize({ host: ALLOWED, authorization: `Bearer ${key}` }),
      params("mcp")
    );

    expect(
      res.status,
      "a 401 here means the key never authenticated, and every refusal in " +
        "this file would then prove nothing about the checks it names"
    ).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it("refuses that same key on an address it does not answer on", async () => {
    // The guard, finally observable. Same credential as the case above, so the
    // only difference is the address, and the status separates the two checks:
    // 403 is the guard, 401 would have been authentication.
    const handlers = await bootWithEndpoint();
    const key = await readOnlyKey(current!);

    const res = await handlers.POST(
      initialize({ host: "evil.example.com", authorization: `Bearer ${key}` }),
      params("mcp")
    );

    expect(res.status).toBe(403);
  });

  it("refuses it on a foreign Origin, which is the browser's half", async () => {
    // `Host` is what a rebinding attack rewrites; `Origin` is what the browser
    // itself attaches and cannot be forged by the page. Both are refused, and
    // covering only one leaves the attack that does not need the other.
    const handlers = await bootWithEndpoint();
    const key = await readOnlyKey(current!);

    const res = await handlers.POST(
      initialize({
        host: ALLOWED,
        origin: "https://evil.example.com",
        authorization: `Bearer ${key}`,
      }),
      params("mcp")
    );

    expect(res.status).toBe(403);
  });

  it("serves it on the configured site's own Origin", async () => {
    // The control on the case above, and the finding this programme refuted
    // once already: an allowlist compared as serialized origins refuses the
    // configured site's own browser clients. Hostnames are what it compares,
    // so a page on the configured site is served.
    const handlers = await bootWithEndpoint();
    const key = await readOnlyKey(current!);

    const res = await handlers.POST(
      initialize({
        host: ALLOWED,
        origin: `https://${ALLOWED}`,
        authorization: `Bearer ${key}`,
      }),
      params("mcp")
    );

    expect(res.status).toBe(200);
  });

  it("puts authentication first, so a bad address with no credential is 401", async () => {
    // The ordering, stated as a case rather than left in a comment. Both
    // checks would refuse this request; which one answers decides the status a
    // client sees, and the transport specification names 403 for the address.
    // It is 401, because core authenticates before the handler runs.
    const handlers = await bootWithEndpoint();

    const res = await handlers.POST(
      initialize({
        host: "evil.example.com",
        origin: "https://evil.example.com",
      }),
      params("mcp")
    );

    expect(res.status).toBe(401);
  });
});
