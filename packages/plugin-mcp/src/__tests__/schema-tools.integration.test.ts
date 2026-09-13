// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { mcpPlugin } from "../plugin";

/**
 * What the schema tools disclose, and to whom.
 *
 * The registry read behind these is deliberately NOT access-controlled: the
 * registry is how the system describes itself, and `getCollection` takes a
 * request context it does not use. Everything protecting an install here is
 * therefore the gate in the tool, which makes its ORDERING the property worth
 * testing rather than an implementation detail.
 *
 * The second property is quieter and matters as much. A refusal must not
 * separate "you may not read this" from "no such entity", because a caller who
 * can tell those apart can enumerate an install's slugs by asking.
 */
const ALLOWED = "cms.example.com";

let current: TestNextly | undefined;
let ownerId: string | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ownerId = undefined;
});

function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

function rpc(body: unknown, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: ALLOWED,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const initialize = (h: Record<string, string>) =>
  rpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    },
    h
  );

const callTool = (name: string, args: unknown, h: Record<string, string>) =>
  rpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    h
  );

async function payloadOf(response: Response) {
  const text = await response.text();
  const line = text
    .split("\n")
    .find(l => l.startsWith("data: ") || l.trimStart().startsWith("{"));
  const json = line?.startsWith("data: ") ? line.slice(6) : (line ?? text);
  return JSON.parse(json) as {
    result?: {
      isError?: boolean;
      content?: { type: string; text: string }[];
      structuredContent?: {
        slug: string;
        kind: string;
        label?: string;
        fields: { name: string; type: string }[];
      };
    };
    error?: { code: number; message: string };
  };
}

const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title" }), text({ name: "body" })],
});
const secrets = defineCollection({
  slug: "secrets",
  fields: [text({ name: "classified" })],
});

async function boot() {
  current = await createTestNextly({
    collections: [posts, secrets],
    plugins: [mcpPlugin({ enabled: true, allowedHosts: [ALLOWED] })],
  });
  return createDynamicHandlers();
}

/** A key granting read on exactly the slugs named, minted by the install owner. */
async function keyGranting(
  handle: TestNextly,
  label: string,
  slugs: string[]
): Promise<string> {
  const nextly = handle.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
    permissions: {
      find: (a: { limit: number }) => Promise<{
        items: { id: string; slug: string }[];
      }>;
    };
    roles: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  if (ownerId === undefined) {
    const owner = await nextly.users.create({
      data: {
        email: "owner@example.com",
        password: "Password123!",
        name: "Owner",
        isActive: true,
      },
    });
    ownerId = owner.item.id;
  }
  const permissions = await nextly.permissions.find({ limit: 500 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(p => p.slug === `read-${slug}`);
    expect(found, `read-${slug} must be seeded`).toBeDefined();
    return found!.id;
  });
  const role = await nextly.roles.create({
    data: {
      name: `Reader ${label}`,
      slug: `reader-${label}`,
      permissionIds: ids,
    },
  });
  const apiKeys = handle.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string; meta: { id: string } }>;
  };
  const { key } = await apiKeys.createApiKey(ownerId, {
    name: `key ${label}`,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "never",
  });
  return key;
}

describe("the schema tools describe only what the caller may read", () => {
  it("returns the declared fields of a collection the caller may read", async () => {
    // The positive control the whole file rests on. Without it every refusal
    // below is satisfied by a tool that refuses everybody.
    const handlers = await boot();
    const key = await keyGranting(current!, "posts-only", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "posts" }, auth),
        params("mcp")
      )
    );

    expect(
      body.result?.isError,
      `expected a schema, got: ${JSON.stringify(body.error ?? body.result?.content ?? {})}`
    ).not.toBe(true);
    expect(body.result?.structuredContent?.slug).toBe("posts");
    expect(body.result?.structuredContent?.kind).toBe("collection");
    const names = (body.result?.structuredContent?.fields ?? []).map(
      f => f.name
    );
    expect(names).toContain("title");
    expect(names).toContain("body");
  });

  it("refuses a collection the caller may not read", async () => {
    // The gate. The registry read behind this is not access-controlled, so
    // nothing but this check stands between a scoped key and the shape of an
    // entity it was never granted.
    const handlers = await boot();
    const key = await keyGranting(current!, "narrow", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "secrets" }, auth),
        params("mcp")
      )
    );

    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent).toBeUndefined();
  });

  it("leaks nothing: a refused entity reads the same as one that does not exist", async () => {
    // The enumeration property. A caller able to tell "not permitted" from "no
    // such entity" can map an install's slugs by asking about guesses, which is
    // disclosure by error message.
    const handlers = await boot();
    const key = await keyGranting(current!, "guessing", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };
    await handlers.POST(initialize(auth), params("mcp"));

    const textOf = async (slug: string) => {
      const body = await payloadOf(
        await handlers.POST(
          callTool("get_collection_schema", { slug }, auth),
          params("mcp")
        )
      );
      return (body.result?.content ?? []).map(c => c.text).join("\n");
    };

    const refused = await textOf("secrets");
    const absent = await textOf("no-such-collection-anywhere");

    expect(
      refused,
      "the refusal must actually say something, or equality is vacuous"
    ).not.toBe("");
    expect(refused.replace("secrets", "X")).toBe(
      absent.replace("no-such-collection-anywhere", "X")
    );
  });

  it("does not answer a collection through the SINGLE tool", async () => {
    // Registered and readable, and still the wrong tool. Answering anyway would
    // make `kind` decorative, and a client that branches on it would read a
    // collection as a document.
    const handlers = await boot();
    const key = await keyGranting(current!, "kinds", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_single_schema", { slug: "posts" }, auth),
        params("mcp")
      )
    );

    expect(body.result?.isError).toBe(true);
  });

  it("advertises both schema tools alongside the initial context", async () => {
    // Without this, every case above is equally satisfied by tools an agent can
    // call and never discover, which is the same as not having them.
    const handlers = await boot();
    const key = await keyGranting(current!, "listing", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const res = await handlers.POST(
      rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, auth),
      params("mcp")
    );
    const listed = await res.text();

    expect(listed).toContain("get_initial_context");
    expect(listed).toContain("get_collection_schema");
    expect(listed).toContain("get_single_schema");
  });
});
