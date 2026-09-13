// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  defineCollection,
  defineSingle,
  group,
  relationship,
  select,
  text,
} from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

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

type Payload = Awaited<ReturnType<typeof payloadOf>>;

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
        fields: {
          name?: string;
          type: string;
          options?: unknown;
          relationTo?: string | string[];
          hasMany?: boolean;
          fields?: { name?: string; type: string }[];
          [key: string]: unknown;
        }[];
      };
    };
    error?: { code: number; message: string };
  };
}

const homepage = defineSingle({
  slug: "homepage",
  fields: [
    text({ name: "headline" }),
    select({
      name: "theme",
      options: [
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    }),
  ],
});

const catalog = defineCollection({
  slug: "catalog",
  fields: [
    text({ name: "title" }),
    select({
      name: "status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Live", value: "live" },
      ],
    }),
    relationship({ name: "authors", relationTo: "posts", hasMany: true }),
    relationship({ name: "owner", relationTo: "users" }),
  ],
});

const layouts = defineCollection({
  slug: "layouts",
  fields: [
    text({ name: "title" }),
    group({
      name: "hero",
      label: "Hero",
      fields: [text({ name: "heading" })],
    }),
  ],
});

/**
 * The two readings every case here takes, each in one place.
 *
 * Repeating `body.result?.structuredContent?.fields ?? []` per assertion is not
 * only noise: each `?.` and `??` is a branch, so the repetition is what made
 * these cases read as some of the most complex functions in the package while
 * asserting one thing apiece.
 */
function fieldsOf(body: Payload) {
  return body.result?.structuredContent?.fields ?? [];
}

/** Every text block of an answer, joined. */
function textOf(body: Payload) {
  const blocks = body.result?.content ?? [];
  return blocks.map(c => c.text).join("");
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
    collections: [posts, secrets, layouts, catalog],
    singles: [homepage],
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
    const names = fieldsOf(body).map(f => f.name);
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

  it("returns a real single's declared fields", async () => {
    // The case whose absence let a shape mismatch ship. Every other single
    // assertion here exercises the REFUSAL path, which returns before the
    // registry is read, so the read itself was never once driven successfully.
    const handlers = await boot();
    const key = await keyGranting(current!, "single-reader", ["homepage"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_single_schema", { slug: "homepage" }, auth),
        params("mcp")
      )
    );

    expect(
      body.result?.isError,
      `expected a schema, got: ${JSON.stringify(body.error ?? body.result?.content ?? {})}`
    ).not.toBe(true);
    expect(body.result?.structuredContent?.slug).toBe("homepage");
    expect(body.result?.structuredContent?.kind).toBe("single");
    expect(fieldsOf(body).map(f => f.name)).toContain("headline");
  });

  it("does not answer a SINGLE through the collection tool", async () => {
    // The inverse of the kind check the single tool already had. Without it a
    // single's slug reaches the collection registry, which has no such record,
    // and its not-found surfaces in place of the uniform refusal this file is
    // careful to keep indistinguishable.
    const handlers = await boot();
    const key = await keyGranting(current!, "wrong-kind", ["homepage"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "homepage" }, auth),
        params("mcp")
      )
    );

    expect(body.result?.isError).toBe(true);
    expect(
      textOf(body),
      "the refusal must be the uniform one, not a registry not-found"
    ).toContain("No readable entity");
  });

  it("serves clients that read only `content`", async () => {
    // A client on a 2025 revision consumes `content` and does not understand
    // structured output. The protocol library appends a text rendering only
    // when `structuredContent` is a NON-object value, so an object-shaped
    // result reaches those clients as a success with an empty body unless the
    // handler writes one itself.
    const handlers = await boot();
    const key = await keyGranting(current!, "legacy", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "posts" }, auth),
        params("mcp")
      )
    );

    const text = textOf(body);
    expect(
      text,
      "a client reading only `content` must get the schema"
    ).toContain("posts");
    expect(text).toContain("title");
  });

  it("does not read the registry at all when it refuses", async () => {
    // The ordering, asserted on the ACT rather than on the answer. A tool that
    // read the unauthorized schema and discarded it afterwards returns exactly
    // the same refusal, so the final value cannot tell the two apart.
    const handlers = await boot();
    const key = await keyGranting(current!, "ordering", ["posts"]);
    const auth = { authorization: `Bearer ${key}` };
    await handlers.POST(initialize(auth), params("mcp"));

    const service = current!.getService("collectionService") as unknown as {
      getCollection: (...args: unknown[]) => Promise<unknown>;
    };
    const read = vi.spyOn(service, "getCollection");

    await handlers.POST(
      callTool("get_collection_schema", { slug: "secrets" }, auth),
      params("mcp")
    );
    const afterDenied = read.mock.calls.length;

    await handlers.POST(
      callTool("get_collection_schema", { slug: "posts" }, auth),
      params("mcp")
    );
    const afterAllowed = read.mock.calls.length;
    read.mockRestore();

    expect(
      afterAllowed,
      "the spy must observe the ALLOWED read, or its silence on the denied " +
        "one is the instrument not reaching rather than the gate working"
    ).toBeGreaterThan(afterDenied);
    expect(afterDenied).toBe(0);
  });
});

describe("the shape the schema tools return", () => {
  it("describes a container field's children, not just its name", async () => {
    // A repeater or a group holds its own fields. A projection that stopped at
    // the top level would report `hero` as a field of no particular shape, and
    // an agent cannot read or write such a document's values from that.
    const handlers = await boot();
    const key = await keyGranting(current!, "nested", ["layouts"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "layouts" }, auth),
        params("mcp")
      )
    );

    const fields = body.result?.structuredContent?.fields ?? [];
    const hero = fields.find(f => f.name === "hero");

    expect(
      hero,
      `the group must be in the answer at all: ${JSON.stringify(fields)}`
    ).toBeDefined();
    expect(
      (hero?.fields ?? []).map(f => f.name),
      "the group's children must survive the projection"
    ).toContain("heading");
  });

  it("returns a select field's options as the array they are declared as", async () => {
    // The server validates a tool result against the advertised output schema,
    // so a schema admitting only an object turned every select field's
    // otherwise successful lookup into a validation failure. `options` is one
    // key with two shapes: an array of label/value pairs here, an object bag on
    // the legacy definition. Both have to be answerable.
    const handlers = await boot();
    const key = await keyGranting(current!, "catalog-select", ["catalog"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "catalog" }, auth),
        params("mcp")
      )
    );

    expect(
      body.result?.isError,
      `a select field must not fail validation: ${JSON.stringify(body.error ?? body.result?.content ?? {})}`
    ).not.toBe(true);
    const status = fieldsOf(body).find(f => f.name === "status");
    expect(status, "the select field must be in the answer").toBeDefined();
    expect(
      Array.isArray(status?.options),
      `options must survive as an array: ${JSON.stringify(status?.options)}`
    ).toBe(true);
    expect((status?.options as unknown[])?.length).toBe(2);
  });

  it("carries a relationship's target and cardinality", async () => {
    // `relationTo` and `hasMany` are top-level on the field config, not entries
    // in the options bag, so a projection copying only the bag returned the
    // relationship's name and type and nothing a client could act on: one id,
    // an array of ids and a polymorphic reference are told apart by these two.
    //
    // The key is granted BOTH slugs. Targets are authorized now, so a
    // catalog-only key is the redaction case rather than this one, and it is
    // covered below.
    const handlers = await boot();
    const key = await keyGranting(current!, "catalog-rel", [
      "catalog",
      "posts",
    ]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "catalog" }, auth),
        params("mcp")
      )
    );

    const authors = fieldsOf(body).find(f => f.name === "authors");
    expect(authors, "the relationship must be in the answer").toBeDefined();
    expect(authors?.relationTo).toBe("posts");
    expect(authors?.hasMany).toBe(true);
  });

  it("asks the registry for the one single it wants", async () => {
    // The registry deserializes every record it returns, fields JSON included,
    // so an unfiltered list materializes the whole registry to answer about
    // one. Asserted on the ARGUMENTS rather than the answer, because listing
    // everything and searching in memory returns exactly the same schema.
    const handlers = await boot();
    const key = await keyGranting(current!, "single-narrow", ["homepage"]);
    const auth = { authorization: `Bearer ${key}` };
    await handlers.POST(initialize(auth), params("mcp"));

    const registry = current!.getService(
      "singleRegistryService"
    ) as unknown as {
      listSingles: (...args: unknown[]) => Promise<unknown>;
    };
    const listed = vi.spyOn(registry, "listSingles");

    await handlers.POST(
      callTool("get_single_schema", { slug: "homepage" }, auth),
      params("mcp")
    );

    expect(
      listed,
      "the spy must observe the call, or its arguments prove nothing"
    ).toHaveBeenCalled();
    const args = listed.mock.calls[0]?.[0] as
      | { slugAllowlist?: string[]; limit?: number }
      | undefined;
    listed.mockRestore();

    expect(args?.slugAllowlist).toEqual(["homepage"]);
    expect(args?.limit).toBe(1);
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

describe("what a schema discloses about OTHER entities", () => {
  it("carries a single's type-specific declaration, not just its name", async () => {
    // The Singles facade published `name`, `type` and nested `fields` and
    // nothing else, so a Single's select could not answer with its choices
    // however this tool projected them. Driven end to end because the defect
    // lived a layer below this file: every case here passed with it in place,
    // and the tool's own projection looked correct the whole time.
    const handlers = await boot();
    const key = await keyGranting(current!, "single-decl", ["homepage"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_single_schema", { slug: "homepage" }, auth),
        params("mcp")
      )
    );

    const theme = fieldsOf(body).find(f => f.name === "theme");
    expect(
      theme,
      `the select must be in the answer: ${JSON.stringify(fieldsOf(body))}`
    ).toBeDefined();
    expect(
      Array.isArray(theme?.options),
      `a single's select must carry its choices: ${JSON.stringify(theme)}`
    ).toBe(true);
    expect((theme?.options as unknown[])?.length).toBe(2);
  });

  it("withholds a target whose registry lookup FAILED, rather than publishing it", async () => {
    // The disclosure path reads absence as permission: a target that is not a
    // registered content entity is safe to name. So a lookup that THREW must
    // not arrive as absence, or a degraded registry publishes the slug of the
    // very collection the caller was refused, exactly when the install is
    // already unwell.
    //
    // The key is granted BOTH slugs, so `posts` would otherwise be named. Only
    // the collection lookup for `posts` is made to fail; everything else
    // answers normally, which is what keeps the tool reaching the read at all.
    const handlers = await boot();
    const key = await keyGranting(current!, "degraded-registry", [
      "catalog",
      "posts",
    ]);
    const auth = { authorization: `Bearer ${key}` };
    await handlers.POST(initialize(auth), params("mcp"));

    const registry = current!.getService(
      "collectionRegistryService"
    ) as unknown as {
      getCollectionBySlug: (slug: string) => Promise<unknown>;
    };
    const real = registry.getCollectionBySlug.bind(registry);
    const lookup = vi
      .spyOn(registry, "getCollectionBySlug")
      .mockImplementation((slug: string) =>
        slug === "posts"
          ? Promise.reject(new Error("registry unavailable"))
          : real(slug)
      );

    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "catalog" }, auth),
        params("mcp")
      )
    );

    expect(
      lookup,
      "the spy must observe the failing lookup, or this case proves nothing"
    ).toHaveBeenCalled();
    lookup.mockRestore();

    const fields = fieldsOf(body);
    const authors = fields.find(f => f.name === "authors");
    expect(
      authors,
      `the relationship must still be described: ${JSON.stringify(fields)}`
    ).toBeDefined();
    expect(
      authors?.relationTo,
      "a target whose existence could not be established must not be named"
    ).toBeUndefined();
  });

  it("withholds a relationship target the caller may not read, and keeps one that is not content", async () => {
    // A schema names other entities from inside itself. `catalog.authors`
    // points at `posts`, which this key was never granted, so forwarding the
    // slug would tell the caller that a collection it is refused by name
    // nonetheless exists — the same enumeration the uniform refusal prevents,
    // reached from a different direction.
    //
    // The second assertion is the CONTROL, and without it the first is
    // satisfied by a tool that strips every target it sees. `users` is not in
    // either content registry, so it is not a withheld entity and must
    // survive; a redaction keyed on readability alone cannot tell the two apart
    // and would leave every upload and every system relationship describing a
    // reference to nothing.
    const handlers = await boot();
    const key = await keyGranting(current!, "catalog-only", ["catalog"]);
    const auth = { authorization: `Bearer ${key}` };

    await handlers.POST(initialize(auth), params("mcp"));
    const body = await payloadOf(
      await handlers.POST(
        callTool("get_collection_schema", { slug: "catalog" }, auth),
        params("mcp")
      )
    );

    const fields = fieldsOf(body);
    const authors = fields.find(f => f.name === "authors");
    const owner = fields.find(f => f.name === "owner");

    expect(
      authors,
      `the relationship must still be described: ${JSON.stringify(fields)}`
    ).toBeDefined();
    expect(
      authors?.relationTo,
      "a withheld collection's slug must not travel in another schema"
    ).toBeUndefined();
    // Still a relationship, and still says it holds many: what is withheld is
    // the target's NAME, not the fact that the field exists.
    expect(authors?.hasMany).toBe(true);

    expect(
      owner?.relationTo,
      "a target outside both content registries is not a withheld entity"
    ).toBe("users");
  });
});
