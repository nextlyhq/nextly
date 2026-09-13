import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { mcpPlugin } from "../plugin";

/**
 * What the endpoint answers through the dispatcher that actually serves it.
 *
 * The unit suite calls the route handler directly, which is the right way to
 * test the handler and the wrong way to describe the endpoint: it cannot see
 * anything core does BEFORE the handler runs, and core does something
 * significant there. A plugin route is authenticated first, so a caller with no
 * credentials never reaches the handler at all — and the address guard lives in
 * the handler.
 *
 * That is worth an executable statement rather than a comment, because the
 * consequence is a specification gap: the transport specification says a server
 * answers `403` to a disallowed `Origin`, and an unauthenticated caller here
 * gets `401`. Refused either way, and refused by the stronger of the two
 * checks — but not with the status the specification names, and the guard did
 * not run.
 *
 * These cases pin what actually happens, so the gap is a recorded fact rather
 * than something a reader has to discover.
 */
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The catch-all's params for an `/api/...` path, as Next.js supplies them. */
function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

async function bootWithEndpoint() {
  current = await createTestNextly({
    plugins: [mcpPlugin({ enabled: true, allowedHosts: ["cms.example.com"] })],
  });
  return createDynamicHandlers();
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

describe("the endpoint as the dispatcher serves it", () => {
  it("refuses an unauthenticated caller before the address is ever checked", async () => {
    // The unauthenticated probe, which is the shape a DNS-rebinding attempt
    // takes: the browser believes it is same-origin with the attacker's page,
    // so it carries no credential for this install. Core's authentication
    // answers first and the handler never runs.
    //
    // 401 rather than the 403 the transport specification names. The request is
    // refused, and by the check that does not depend on the attacker's
    // cooperation — but the address guard had no part in it.
    const handlers = await bootWithEndpoint();

    const res = await handlers.POST(
      initialize({ host: "evil.example.com" }),
      params("mcp")
    );

    expect(res.status).toBe(401);
  });

  it("refuses an unauthenticated caller on an allowed address too", async () => {
    // The control on the case above, and what makes its 401 mean "not
    // authenticated" rather than "wrong address". Both come back the same,
    // which is precisely why the status cannot be read as the address check
    // having run.
    const handlers = await bootWithEndpoint();

    const res = await handlers.POST(
      initialize({ host: "cms.example.com" }),
      params("mcp")
    );

    expect(res.status).toBe(401);
  });

  it("is reached at all, so the refusals are not a missing route", async () => {
    // Without this, every assertion above is equally satisfied by a plugin that
    // contributed no route: core declines a path it does not serve with 400,
    // and 400 is not 401. This separates "authenticated endpoint" from "no
    // endpoint", which is the whole difference between a guard and a typo.
    current = await createTestNextly({ plugins: [] });
    const handlers = createDynamicHandlers();

    const res = await handlers.POST(
      initialize({ host: "cms.example.com" }),
      params("mcp")
    );

    expect(res.status).toBe(400);
  });

  it("serves no endpoint at all while the plugin is off", async () => {
    // `enabled` decides whether the address exists, and this is the only place
    // that can say so about the ADDRESS rather than about the definition.
    current = await createTestNextly({ plugins: [mcpPlugin()] });
    const handlers = createDynamicHandlers();

    const res = await handlers.POST(
      initialize({ host: "cms.example.com" }),
      params("mcp")
    );

    expect(res.status).toBe(400);
  });
});
