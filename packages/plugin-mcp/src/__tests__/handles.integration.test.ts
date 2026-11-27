/**
 * Handles against an install: issued to one caller through core's one-purpose tokens, refused to
 * anyone else and after they expire, each refusal saying which.
 *
 * No tool hands out a handle yet, so the cases reach the helper through a fixture plugin's route
 * booted beside the door. The route is served by core's dispatcher like the door is: the context
 * it hands the helper is the one core built for the request, authenticated by a real key or a
 * real session, and the token store behind it is core's own table. Nothing here is a stand-in
 * for the binding or for the store.
 *
 * Run on every configured dialect: the store is a core table.
 */
import {
  definePlugin,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineHandle } from "../handles/handles";
import { mcpPlugin } from "../plugin";

import { ALLOWED, bearer, keyGranting, params, type Handlers } from "./helpers";

/** The kind the fixture issues: half an hour, as a page plan might last. */
const PLAN = defineHandle<{ step: string }>("page-plan", 30 * 60_000);

/** A route answering what `work` returns as JSON; a refusal is thrown and core answers it. */
function route(
  path: string,
  work: (body: { handle?: string }, ctx: PluginRouteContext) => Promise<unknown>
): PluginRoute {
  return {
    method: "POST",
    path,
    mount: "root",
    checksAccess: true,
    handler: async (request, ctx) =>
      Response.json(
        await work((await request.json()) as { handle?: string }, ctx)
      ),
  };
}

/** Issues, reads and spends `PLAN` handles for whoever calls it. */
const fixture = definePlugin({
  name: "handle-fixture",
  version: "0.0.0",
  // Any core: the fixture uses nothing a particular release added.
  nextly: "*",
  contributes: {
    routes: [
      route("/handle-test/issue", (_, ctx) =>
        PLAN.issue(ctx, { step: "hero" })
      ),
      route("/handle-test/read", (body, ctx) =>
        PLAN.read(ctx, body.handle ?? "")
      ),
      route("/handle-test/spend", (body, ctx) =>
        PLAN.spend(ctx, body.handle ?? "")
      ),
    ],
  },
});

/** The one permission every caller here holds: a role cannot be empty, and handles ask for none. */
const READS = "read-users";

/** How a caller authenticates: a key's bearer header, or a session's cookie. */
type Credential = Record<string, string>;

/** A second person, signed in with a session of their own. */
async function sessionOfSomeoneElse(handle: TestNextly): Promise<Credential> {
  const created = await handle.nextly.users.create({
    email: "bob@example.com",
    password: "Password123!",
    data: { name: "Bob", isActive: true },
  });
  const userId = created.item.id;
  // A role needs one permission; which one does not matter to a handle.
  const readUsers = (
    await handle.nextly.permissions.find({ limit: 1000 })
  ).items.find(permission => permission.slug === READS);
  expect(readUsers, `${READS} is not seeded`).toBeDefined();
  const role = await handle.nextly.roles.create({
    data: {
      name: "Reader",
      slug: "reader",
      permissionIds: [String(readUsers?.id)],
    },
  });
  const assigned = await new ServiceContainer(
    handle.adapter
  ).userRoles.assignRoleToUser(userId, role.item.id);
  expect(assigned.success).toBe(true);
  return sessionOf(userId, "bob@example.com", "Bob");
}

/** A session cookie for `userId`, signed as core signs one. */
async function sessionOf(
  userId: string,
  email: string,
  name: string
): Promise<Credential> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email,
      name,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { cookie: `nextly_session=${token}`, origin: "http://localhost" };
}

/** The answer to one fixture call: its status and its JSON. */
async function call(
  handlers: Handlers,
  credential: Credential,
  action: "issue" | "read" | "spend",
  handle?: string
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await handlers.POST(
    new Request(`http://localhost/api/handle-test/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: ALLOWED,
        ...credential,
      },
      body: JSON.stringify(handle === undefined ? {} : { handle }),
    }),
    params("handle-test", action)
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

/** A handle issued to `credential`, from a call that must have succeeded. */
async function issued(
  handlers: Handlers,
  credential: Credential
): Promise<string> {
  const answer = await call(handlers, credential, "issue");
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  expect(typeof answer.json.handle).toBe("string");
  return String(answer.json.handle);
}

describe.each(getConfiguredTestDialects())("handles (%s)", dialect => {
  let current: TestNextly | undefined;
  let handlers: Handlers;
  let aliceKey: Credential;
  let aliceOtherKey: Credential;
  let aliceSession: Credential;
  let bob: Credential;

  beforeEach(async () => {
    current = await createTestNextly({
      dialect,
      plugins: [mcpPlugin({ enabled: true, allowedHosts: [ALLOWED] }), fixture],
    });
    handlers = createDynamicHandlers();
    // The install's owner, Alice, holds every key `keyGranting` mints.
    aliceKey = bearer((await keyGranting(current, "one", [READS])).key);
    aliceOtherKey = bearer((await keyGranting(current, "two", [READS])).key);
    const owner = await current.nextly.users.find({ limit: 1 });
    const alice = owner.items[0];
    expect(alice).toBeDefined();
    aliceSession = await sessionOf(
      String(alice?.id),
      String(alice?.email),
      "Owner"
    );
    bob = await sessionOfSomeoneElse(current);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await current?.destroy();
    current = undefined;
  });

  it("gives its holder back what it carries, as often as asked", async () => {
    const handle = await issued(handlers, aliceKey);

    for (let i = 0; i < 2; i += 1) {
      const read = await call(handlers, aliceKey, "read", handle);
      expect(read.status).toBe(200);
      expect(read.json.data).toEqual({ step: "hero" });
    }
  });

  it("is refused when two people swap handles, each told it is not theirs", async () => {
    const alices = await issued(handlers, aliceKey);
    const bobs = await issued(handlers, bob);

    const bobReadingAlices = await call(handlers, bob, "read", alices);
    const aliceReadingBobs = await call(handlers, aliceKey, "read", bobs);

    for (const refused of [bobReadingAlices, aliceReadingBobs]) {
      expect(refused.status).toBe(403);
      expect(refused.json.error).toMatchObject({
        code: "MCP_HANDLE_NOT_YOURS",
        message: expect.stringContaining("issued to someone else"),
      });
    }
    // The control: each still works for the person it was issued to.
    expect((await call(handlers, aliceKey, "read", alices)).status).toBe(200);
    expect((await call(handlers, bob, "read", bobs)).status).toBe(200);
  });

  it("is refused to the same person on another key or on their session", async () => {
    const handle = await issued(handlers, aliceKey);

    for (const other of [aliceOtherKey, aliceSession]) {
      const refused = await call(handlers, other, "read", handle);
      expect(refused.status).toBe(403);
      expect(refused.json.error).toMatchObject({
        code: "MCP_HANDLE_NOT_YOURS",
      });
    }
  });

  it("cannot be used up by someone else", async () => {
    const handle = await issued(handlers, aliceKey);

    expect((await call(handlers, bob, "spend", handle)).status).toBe(403);
    const spent = await call(handlers, aliceKey, "spend", handle);
    expect(spent.status).toBe(200);
    expect(spent.json.data).toEqual({ step: "hero" });

    const again = await call(handlers, aliceKey, "spend", handle);
    expect(again.status).toBe(410);
    expect(again.json.error).toMatchObject({ code: "MCP_HANDLE_USED" });
  });

  it("is refused after its lifetime, saying it expired and how long it lasts", async () => {
    const handle = await issued(handlers, aliceKey);
    expect((await call(handlers, aliceKey, "read", handle)).status).toBe(200);

    // Only the clock moves: timers stay real, so the database drivers keep working.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + PLAN.lifetimeMs + 1_000);

    const refused = await call(handlers, aliceKey, "read", handle);
    expect(refused.status).toBe(410);
    expect(refused.json.error).toMatchObject({
      code: "MCP_HANDLE_EXPIRED",
      message: expect.stringContaining("it lasts 30 minutes"),
    });
  });

  it("is refused when this server never issued it", async () => {
    const refused = await call(handlers, aliceKey, "read", "not-a-handle");

    expect(refused.status).toBe(404);
    expect(refused.json.error).toMatchObject({ code: "MCP_HANDLE_UNKNOWN" });
  });
});
