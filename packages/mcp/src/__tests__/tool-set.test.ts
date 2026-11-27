/**
 * The adapter end to end, through the official SDK client over an in-memory
 * transport: what `tools/list` shows, what each call answers, and what the
 * door refuses.
 *
 * The client checks every answer's structured content against the output
 * schema it listed, so a call that returns here has already been validated by
 * the protocol library itself.
 */
import { NextlyError } from "nextly/errors";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_ANSWER_CHARACTERS } from "../answers";
import { buildToolSet } from "../tool-set";

import {
  connectedClient,
  FIND_ENTRIES,
  fencedData,
  fixtureEntries,
  FIXTURE_OPERATIONS,
  FIXTURE_TABLE,
  fixtureSource,
  fixtureToolSet,
  type FixtureRunOptions,
  type LoggedLine,
} from "./fixtures";

type Connected = Awaited<ReturnType<typeof connectedClient>>;
const open: Connected[] = [];

async function connect(
  runOptions: FixtureRunOptions = {},
  binding: Parameters<typeof connectedClient>[1] = {}
): Promise<Connected> {
  const connected = await connectedClient(fixtureToolSet(runOptions), binding);
  open.push(connected);
  // The client validates structured content against the schemas it listed.
  await connected.client.listTools();
  return connected;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map(connected => connected.close()));
});

function textOf(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const first: unknown = content[0];
  return typeof first === "object" &&
    first !== null &&
    "text" in first &&
    typeof first.text === "string"
    ? first.text
    : "";
}

describe("tools/list", () => {
  it("lists every served tool with its title, description, schemas and hints", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(
      fixtureToolSet()
        .tools.map(tool => tool.name)
        .sort()
    );
    const find = tools.find(tool => tool.name === "find_entries");
    expect(find).toMatchObject({
      title: "Find entries",
      description: FIND_ENTRIES.description,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(Object.keys(find?.inputSchema.properties ?? {}).sort()).toEqual([
      "after",
      "collection",
      "fields",
      "format",
      "limit",
      "search",
    ]);
    expect(Object.keys(find?.outputSchema?.properties ?? {}).sort()).toEqual([
      "collection",
      "items",
      "page",
    ]);
  });

  it("never lists an old name", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain("get_renamed");
    expect(names).not.toContain("get_old_name");
  });

  it("lists only what the caller may use, and refuses the rest as if it didn't exist", async () => {
    const { client } = await connect(
      {},
      { allows: operation => operation.level === "read" }
    );
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain("get_entry");
    expect(names).not.toContain("create_draft");

    const hidden = await client
      .callTool({ name: "create_draft", arguments: { id: "1" } })
      .catch((error: unknown) => error);
    const missing = await client
      .callTool({ name: "create_nothing", arguments: { id: "1" } })
      .catch((error: unknown) => error);
    expect(String(hidden)).toMatch(/Unknown tool\./);
    expect(String(hidden).replace("create_draft", "")).toBe(
      String(missing).replace("create_nothing", "")
    );
  });
});

describe("an answer, three ways", () => {
  it("gives Markdown, the same data in a fenced block, and structured content", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "get_entry",
      arguments: { collection: "posts", id: "1", format: "detailed" },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text.startsWith("**Get an entry**")).toBe(true);
    expect(text).toContain(
      "[Post 1](<https://site.example/admin/collections/posts/1>) (ID `1`)"
    );
    expect(text).toContain("  > ## Spring menu");
    expect(fencedData(text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({
      id: "1",
      body: expect.stringContaining("**fresh**"),
    });
  });

  it("answers concisely by default, and with every field when asked", async () => {
    const { client } = await connect();
    const concise = await client.callTool({
      name: "get_entry",
      arguments: { collection: "posts", id: "1" },
    });
    const detailed = await client.callTool({
      name: "get_entry",
      arguments: { collection: "posts", id: "1", format: "detailed" },
    });
    expect(Object.keys(concise.structuredContent ?? {}).sort()).toEqual([
      "adminPath",
      "id",
      "status",
      "title",
    ]);
    expect(Object.keys(detailed.structuredContent ?? {}).sort()).toEqual([
      "adminPath",
      "author",
      "body",
      "cover",
      "id",
      "status",
      "title",
    ]);
    expect(textOf(concise)).not.toContain("Spring menu");
    expect(textOf(concise).length).toBeLessThan(textOf(detailed).length);
  });

  it("returns only the fields a list call chooses", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts", fields: ["cover"], format: "detailed" },
    });
    const items = (
      result.structuredContent as { items: Record<string, unknown>[] }
    ).items;
    expect(items).toHaveLength(3);
    for (const item of items)
      expect(Object.keys(item).sort()).toEqual([
        "adminPath",
        "cover",
        "id",
        "title",
      ]);
    expect(textOf(result)).toContain(
      "cover: [spring.jpg](<https://site.example/admin/media/m1>)"
    );
  });
});

describe("pages", () => {
  it("walks three pages with an opaque cursor, 20 by default", async () => {
    const { client } = await connect({ entries: fixtureEntries(45) });
    const seen: string[] = [];
    let after: string | undefined;
    const pageSizes: number[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await client.callTool({
        name: "find_entries",
        arguments: { collection: "posts", ...(after ? { after } : {}) },
      });
      const data = result.structuredContent as {
        items: { id: string }[];
        page: { next: string | null; limit: number; total: number };
      };
      pageSizes.push(data.items.length);
      seen.push(...data.items.map(item => item.id));
      expect(data.page.limit).toBe(20);
      if (data.page.next !== null) {
        // Opaque: not the operation's own offset.
        expect(data.page.next).not.toMatch(/^\d+$/);
        after = data.page.next;
      }
      expect(data.page.next === null).toBe(page === 2);
    }
    expect(pageSizes).toEqual([20, 20, 5]);
    expect(seen).toEqual(
      Array.from({ length: 45 }, (_, index) => String(index + 1))
    );
  });

  it("refuses more than 100 to a page", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts", limit: 101 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("**Refused: `VALIDATION_ERROR`**");
    expect(JSON.stringify(result.structuredContent)).toContain(
      "Must be a whole number from 1 to 100."
    );
  });

  it("refuses a cursor sent with other filters, or one made up", async () => {
    const { client } = await connect({ entries: fixtureEntries(45) });
    const first = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts" },
    });
    const next = (first.structuredContent as { page: { next: string } }).page
      .next;

    const otherFilter = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts", search: "x", after: next },
    });
    expect(otherFilter.isError).toBe(true);
    expect(JSON.stringify(otherFilter.structuredContent)).toContain(
      "was issued for different inputs"
    );

    const madeUp = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts", after: "40" },
    });
    expect(madeUp.isError).toBe(true);
    expect(JSON.stringify(madeUp.structuredContent)).toContain(
      "is not one this server issued"
    );
  });
});

describe("the 50,000-character cap", () => {
  it("refuses an answer over the cap with no partial data, and says how to narrow it", async () => {
    const entries = fixtureEntries(100).map(entry => ({
      ...entry,
      title: `${entry.title} ${"x".repeat(600)}`,
    }));
    const { client } = await connect({ entries });
    const result = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts", limit: 100, format: "detailed" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("**Refused: `PAYLOAD_TOO_LARGE`**");
    expect(text).toContain(
      "name fewer fields with `fields`, set a smaller `limit`, add a filter"
    );
    expect(JSON.stringify(result)).not.toContain("Post 1 ");
    expect(JSON.stringify(result).length).toBeLessThan(MAX_ANSWER_CHARACTERS);
  });

  it("answers the same list once it is narrowed below the cap", async () => {
    const entries = fixtureEntries(100).map(entry => ({
      ...entry,
      title: `${entry.title} ${"x".repeat(600)}`,
    }));
    const { client } = await connect({ entries });
    const result = await client.callTool({
      name: "find_entries",
      arguments: { collection: "posts", limit: 20, format: "detailed" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result).length).toBeLessThanOrEqual(MAX_ANSWER_CHARACTERS);
  });
});

describe("refusals", () => {
  it("names a misspelled collection with the close ones", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "find_entries",
      arguments: { collection: "psots" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      "No collection is called `psots`. Close names you may use: `posts`."
    );
  });

  it("names an input the tool doesn't take with the close ones it does", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "find_entries",
      arguments: { colection: "posts" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Close names you may use: `collection`.");
  });

  it("answers an operation's schema refusal as a tool error, not a protocol error", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "get_entry",
      arguments: { collection: 7, id: "1" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("**Refused: `VALIDATION_ERROR`**");
  });

  it("refuses arguments with more elements than one call may send", async () => {
    const toolSet = buildToolSet(fixtureSource(), {
      door: "chat",
      table: FIXTURE_TABLE,
      maxInputElements: 5,
    });
    const connected = await connectedClient(toolSet);
    open.push(connected);
    await connected.client.listTools();
    const result = await connected.client.callTool({
      name: "find_entries",
      arguments: {
        collection: "posts",
        fields: ["title", "status", "body", "author", "cover"],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("**Refused: `PAYLOAD_TOO_LARGE`**");
  });
});

/** Arguments each fixture tool accepts, so a call reaches the operation. */
const ARGUMENTS: Readonly<Record<string, Record<string, unknown>>> = {
  find_entries: { collection: "posts" },
  get_entry: { collection: "posts", id: "1" },
};

describe("the leak rule on every tool", () => {
  const SECRET = "postgres://admin:hunter2@db.internal:5432/site";

  it.each(fixtureToolSet().tools.map(tool => tool.name))(
    "%s answers a driver failure with nothing from it",
    async name => {
      const { client, logged } = await connect({
        fail: Object.assign(
          new Error(`ECONNREFUSED ${SECRET} /srv/app/node_modules/pg`),
          { code: "ECONNREFUSED" }
        ),
      });
      const result = await client.callTool({
        name,
        arguments: ARGUMENTS[name] ?? { id: "1" },
      });
      const whole = JSON.stringify(result);
      expect(result.isError).toBe(true);
      expect(whole).not.toContain("hunter2");
      expect(whole).not.toContain("/srv/app");
      expect(textOf(result)).toContain("`INTERNAL_ERROR`");
      expect(JSON.stringify(logged satisfies LoggedLine[])).not.toContain(
        "hunter2"
      );
    }
  );

  it("answers a refusal from the engine with core's public JSON only", async () => {
    const refusal = NextlyError.forbidden({
      logContext: { secret: "hunter2" },
    });
    const { client } = await connect({ fail: refusal });
    const result = await client.callTool({
      name: "get_entry",
      arguments: { collection: "posts", id: "1" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("**Refused: `FORBIDDEN`**");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("answers a result outside the operation's own schema as an internal error, unsent", async () => {
    const source = fixtureSource();
    const toolSet = buildToolSet(
      {
        ...source,
        run: async () => ({
          result: { id: "1", title: "x", adminPath: "/a", stray: "hunter2" },
        }),
      },
      { door: "chat", table: FIXTURE_TABLE }
    );
    const connected = await connectedClient(toolSet);
    open.push(connected);
    await connected.client.listTools();
    const result = await connected.client.callTool({
      name: "get_entry",
      arguments: { collection: "posts", id: "1" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(connected.logged[0]?.message).toContain("failed its output schema");
  });
});

describe("a renamed tool", () => {
  it("answers under its old name, unlisted, and names the new one", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "get_old_name",
      arguments: { id: "7" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(
      "This tool is now called `get_renamed`; the name `get_old_name` may stop working from release 1.3.0."
    );
    expect(result.structuredContent).toEqual({ id: "7", done: true });
  });
});

describe("definitions are built once", () => {
  /** The fixture operations with every schema conversion counted. */
  function counted(): {
    source: ReturnType<typeof fixtureSource>;
    conversions: () => number;
  } {
    let conversions = 0;
    const operations = FIXTURE_OPERATIONS.map(operation => {
      const wrap = (schema: typeof operation.input): typeof operation.input => {
        const standard = schema["~standard"];
        const jsonSchema = standard.jsonSchema;
        return {
          "~standard": {
            ...standard,
            ...(jsonSchema
              ? {
                  jsonSchema: {
                    input: options => {
                      conversions++;
                      return jsonSchema.input(options);
                    },
                    output: options => {
                      conversions++;
                      return jsonSchema.output(options);
                    },
                  },
                }
              : {}),
          },
        };
      };
      return {
        ...operation,
        input: wrap(operation.input),
        output: wrap(operation.output),
      };
    });
    return {
      source: fixtureSource(operations),
      conversions: () => conversions,
    };
  }

  it("converts no schema on a request: a second request builds nothing", async () => {
    const { source, conversions } = counted();
    const toolSet = buildToolSet(source, {
      door: "chat",
      table: FIXTURE_TABLE,
    });
    const atStart = conversions();
    expect(atStart).toBe(toolSet.tools.length * 2);

    for (let request = 0; request < 2; request++) {
      const connected = await connectedClient(toolSet);
      open.push(connected);
      await connected.client.listTools();
      await connected.client.callTool({
        name: "get_entry",
        arguments: { collection: "posts", id: "1" },
      });
    }
    expect(conversions()).toBe(atStart);
  });

  it("lists 40 tools quickly once built", async () => {
    const operations = Array.from({ length: 40 }, (_, index) => ({
      ...FIND_ENTRIES,
      id: `fixture${index}.find`,
    }));
    const table = operations.map((operation, index) => ({
      name: `find_fixture_${index}`,
      operation: operation.id,
    }));
    const toolSet = buildToolSet(
      {
        ...fixtureSource(operations),
        toolNameOf: operation =>
          `find_fixture_${operation.id.replace(/\D/g, "")}`,
      },
      { door: "chat", table }
    );
    const connected = await connectedClient(toolSet);
    open.push(connected);
    await connected.client.listTools();
    const started = performance.now();
    for (let round = 0; round < 20; round++) await connected.client.listTools();
    const perList = (performance.now() - started) / 20;
    expect((await connected.client.listTools()).tools).toHaveLength(40);
    // Generous for a shared CI runner; a list that rebuilt 40 schemas per
    // request would not be measured in single milliseconds here either, so
    // the build-once test above is the precise check and this one the bound.
    expect(perList).toBeLessThan(50);
  });
});
