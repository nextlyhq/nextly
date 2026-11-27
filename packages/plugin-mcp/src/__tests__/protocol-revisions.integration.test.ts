/**
 * The door as each protocol revision in use reaches it, through the official client: one
 * address, no session kept, `server/discover` answered, answers marked private to the caller,
 * explicit limits on a request's size and on a call's input, and an unserved revision refused
 * with the revisions that are served.
 *
 * Every client here is the SDK's own `Client`, talking over its own Streamable HTTP transport.
 * Its `fetch` is the one seam: it hands each request to the handlers an app mounts, addressed
 * to the published host, so the request runs through core's dispatcher, its authentication and
 * the door's guard exactly as a deployed one does.
 *
 * Run on every configured dialect: the calls read the install's registry and review state.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_REQUEST_BYTES,
  MAX_TOOL_INPUT_ELEMENTS,
  SERVED_REVISIONS,
} from "../transport/limits";

import {
  ALLOWED,
  bearer,
  bootReview,
  keyGranting,
  params,
  payloadOf,
  post,
  type Handlers,
} from "./helpers";

/** The served revisions a client reaches through `server/discover` rather than `initialize`. */
const MODERN_REVISIONS = SERVED_REVISIONS.filter(
  revision => revision >= "2026-07-28"
);

/** One exchange the client made: the JSON-RPC method it sent, and what came back. */
interface Exchange {
  method: string | undefined;
  status: number;
  cacheControl: string | null;
  body: string;
}

/**
 * A `fetch` that serves the client's requests through `handlers`, as the key in `headers`,
 * recording each exchange in `seen`.
 */
function throughHandlers(
  handlers: Handlers,
  headers: Record<string, string>,
  seen: Exchange[]
) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const sent = new Request(url, init);
    const outgoing = new Headers(sent.headers);
    outgoing.set("host", ALLOWED);
    for (const [name, value] of Object.entries(headers)) {
      outgoing.set(name, value);
    }
    const body = sent.method === "POST" ? await sent.text() : undefined;
    const request = new Request("http://localhost/api/mcp", {
      method: sent.method,
      headers: outgoing,
      ...(body !== undefined ? { body } : {}),
    });
    const method = sent.method as "POST" | "GET" | "DELETE";
    const response = await handlers[method](request, params("mcp"));
    const text = await response.clone().text();
    let rpcMethod: string | undefined;
    try {
      rpcMethod = (JSON.parse(body ?? "{}") as { method?: string }).method;
    } catch {
      rpcMethod = undefined;
    }
    seen.push({
      method: rpcMethod,
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: text,
    });
    return response;
  };
}

/** A client of the official SDK, speaking `revision`, connected as the key in `headers`. */
async function connect(
  handlers: Handlers,
  headers: Record<string, string>,
  revision: string,
  seen: Exchange[] = []
): Promise<Client> {
  const modern = revision === "2026-07-28";
  const client = new Client(
    { name: "conformance-client", version: "0.0.0" },
    modern
      ? { versionNegotiation: { mode: { pin: revision } } }
      : { supportedProtocolVersions: [revision] }
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`https://${ALLOWED}/api/mcp`), {
      fetch: throughHandlers(handlers, headers, seen),
    })
  );
  return client;
}

/** The JSON-RPC payload of a recorded answer, whether JSON or one SSE frame. */
function payloadIn(exchange: Exchange | undefined): Record<string, unknown> {
  expect(exchange, "no such exchange was made").toBeDefined();
  const line = (exchange?.body ?? "")
    .split("\n")
    .find(l => l.startsWith("data: ") || l.trimStart().startsWith("{"));
  const json = line?.startsWith("data: ") ? line.slice(6) : (line ?? "");
  return JSON.parse(json) as Record<string, unknown>;
}

/** That a recorded answer's `Cache-Control` says private to the caller, and not to be stored. */
function expectPrivateHeader(exchange: Exchange | undefined, label: string) {
  const directives = (exchange?.cacheControl ?? "")
    .split(",")
    .map(directive => directive.trim().toLowerCase());
  expect(directives, label).toEqual(
    expect.arrayContaining(["private", "no-store"])
  );
  expect(directives, label).not.toContain("public");
}

describe.each(getConfiguredTestDialects())(
  "the door's protocol (%s)",
  dialect => {
    let current: TestNextly | undefined;
    let handlers: Handlers;
    let key: string;
    const open: Client[] = [];

    beforeEach(async () => {
      const booted = await bootReview(dialect);
      current = booted.handle;
      handlers = booted.handlers;
      key = (await keyGranting(booted.handle, "reader", ["read-posts"])).key;
    });

    afterEach(async () => {
      for (const client of open.splice(0)) await client.close();
      await current?.destroy();
      current = undefined;
    });

    /** A connected client, closed after the case. */
    async function clientOn(revision: string, seen?: Exchange[]) {
      const client = await connect(handlers, bearer(key), revision, seen);
      open.push(client);
      return client;
    }

    it.each(SERVED_REVISIONS.map(revision => [revision]))(
      "serves %s: the official client connects, lists the tools and calls one",
      async revision => {
        const client = await clientOn(revision);

        expect(client.getNegotiatedProtocolVersion()).toBe(revision);
        const names = (await client.listTools()).tools.map(tool => tool.name);
        expect(names).toContain("get_initial_context");

        const result = await client.callTool({
          name: "get_initial_context",
          arguments: {},
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          entities: expect.arrayContaining([
            { slug: "posts", kind: "collection" },
          ]),
        });
      }
    );

    it("answers server/discover with the revisions it serves there, its capabilities and its identity", async () => {
      const client = await clientOn("2026-07-28");

      // Discovery lists the revisions a client reaches through discovery: the 2026 one. The 2025
      // revisions are reached through `initialize` (each case above), and the protocol keeps the
      // two lists apart so a 2026 client is never pointed at a revision its envelope cannot carry.
      const discovered = client.getDiscoverResult();
      expect(discovered?.supportedVersions).toEqual(MODERN_REVISIONS);
      expect(discovered?.capabilities).toHaveProperty("tools");
      expect(client.getServerVersion()).toMatchObject({ name: "nextly" });
    });

    it("keeps no session: no client is issued a session id", async () => {
      const seen: Exchange[] = [];
      const first = await clientOn("2025-11-25", seen);
      const second = await clientOn("2025-11-25", seen);
      await first.listTools();
      await second.listTools();

      expect(first.transport?.sessionId).toBeUndefined();
      expect(second.transport?.sessionId).toBeUndefined();
    });

    it("lists the tools in one fixed order, every time and on every revision", async () => {
      const orders: string[][] = [];
      for (const revision of SERVED_REVISIONS) {
        const client = await clientOn(revision);
        orders.push((await client.listTools()).tools.map(tool => tool.name));
        orders.push((await client.listTools()).tools.map(tool => tool.name));
      }

      expect(orders[0]?.length).toBeGreaterThan(1);
      for (const order of orders) expect(order).toEqual(orders[0]);
    });

    it("marks discovery and list answers private to the caller, on every revision", async () => {
      // The 2026 revision carries cache fields in the answer itself.
      const modern: Exchange[] = [];
      await (await clientOn("2026-07-28", modern)).listTools();
      for (const method of ["server/discover", "tools/list"]) {
        const answer = modern.find(e => e.method === method);
        // Literal values, not the door's own constant: a test reading the constant would agree
        // with any value the constant were changed to.
        expect(payloadIn(answer).result, method).toMatchObject({
          ttlMs: 0,
          cacheScope: "private",
        });
        expectPrivateHeader(answer, `2026-07-28 ${method}`);
      }

      // The 2025 revisions have no such fields, so the HTTP header is what says it: core's
      // boundary marks every answer to a signed-in caller, the door's included.
      for (const revision of ["2025-11-25", "2025-06-18"]) {
        const legacy: Exchange[] = [];
        await (await clientOn(revision, legacy)).listTools();
        for (const method of ["initialize", "tools/list"]) {
          const answer = legacy.find(e => e.method === method);
          expect(answer?.status, `${revision} ${method}`).toBe(200);
          expectPrivateHeader(answer, `${revision} ${method}`);
        }
      }
    });

    it("counter-offers its newest 2025 revision to a client opening with an older one", async () => {
      const response = await handlers.POST(
        post(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "conformance-client", version: "0.0.0" },
            },
          },
          bearer(key)
        ),
        params("mcp")
      );

      const body = (await payloadOf(response)) as {
        result?: { protocolVersion?: string };
      };
      expect(response.status).toBe(200);
      expect(body.result?.protocolVersion).toBe("2025-11-25");
    });

    it("refuses a revision it does not serve, naming all three it does", async () => {
      const response = await handlers.POST(
        post(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...bearer(key), "mcp-protocol-version": "1999-01-01" }
        ),
        params("mcp")
      );

      expect(response.status).toBe(400);
      const message = (await payloadOf(response)).error?.message ?? "";
      expect(message).toContain("1999-01-01");
      for (const revision of SERVED_REVISIONS) {
        expect(message).toContain(revision);
      }
    });

    it("refuses an unserved revision named in the 2026 envelope, naming the ones it does", async () => {
      const response = await handlers.POST(
        post(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2099-01-01",
                "io.modelcontextprotocol/clientInfo": {
                  name: "conformance-client",
                  version: "0.0.0",
                },
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          },
          { ...bearer(key), "mcp-protocol-version": "2099-01-01" }
        ),
        params("mcp")
      );

      // The protocol's unsupported-version error, carrying the revisions this envelope can ask
      // for: the 2026 ones the door serves.
      const body = (await response.json()) as {
        error?: { code: number; data?: { supported?: string[] } };
      };
      expect(body.error?.code, JSON.stringify(body)).toBe(-32022);
      expect(body.error?.data?.supported).toEqual(MODERN_REVISIONS);
    });

    describe("the request size limit", () => {
      /** A `tools/list` whose body is exactly `bytes` long, padded in its `_meta`. */
      function listOfSize(bytes: number): Request {
        const shape = (pad: string) =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: { _meta: { pad } },
          });
        const pad = "x".repeat(bytes - shape("").length);
        const body = shape(pad);
        expect(Buffer.byteLength(body)).toBe(bytes);
        return new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            host: ALLOWED,
            "mcp-protocol-version": "2025-11-25",
            ...bearer(key),
          },
          body,
        });
      }

      it("serves a request exactly at the limit", async () => {
        const response = await handlers.POST(
          listOfSize(MAX_REQUEST_BYTES),
          params("mcp")
        );

        expect(response.status).toBe(200);
        const body = await payloadOf(response);
        expect(body.error, JSON.stringify(body.error)).toBeUndefined();
        expect(body.result?.tools?.length).toBeGreaterThan(0);
      });

      it("refuses one byte over, naming the limit", async () => {
        const response = await handlers.POST(
          listOfSize(MAX_REQUEST_BYTES + 1),
          params("mcp")
        );

        expect(response.status).toBe(413);
        const body = await payloadOf(response);
        expect(body.error?.message).toContain(String(MAX_REQUEST_BYTES));
      });
    });

    describe("the input element limit", () => {
      /**
       * `submit_for_review`'s arguments holding exactly `elements` array elements and object
       * members, counted as the limit counts them: the four top-level members, the document's two,
       * the `seen` array's one element and that element's three, and one per part.
       */
      function argumentsOf(elements: number): Record<string, unknown> {
        const fixed = 4 + 2 + 1 + 3;
        return {
          document: { collection: "posts", id: "no-such-entry" },
          parts: Array.from({ length: elements - fixed }, () => "en"),
          seen: [{ part: "en", revision: 0, version: "v" }],
          comment: "Ready",
        };
      }

      it("hands a call exactly at the limit to the tool", async () => {
        const client = await clientOn("2025-11-25");

        const result = await client.callTool({
          name: "submit_for_review",
          arguments: argumentsOf(MAX_TOOL_INPUT_ELEMENTS),
        });
        // The tool ran and answered for itself: its own refusal, as data, not the limit's.
        expect(JSON.stringify(result)).not.toContain("maximum of");
        expect(result.structuredContent).toHaveProperty("error.code");
      });

      it("refuses one element over, naming the limit", async () => {
        const client = await clientOn("2025-11-25");

        const answer = await client
          .callTool({
            name: "submit_for_review",
            arguments: argumentsOf(MAX_TOOL_INPUT_ELEMENTS + 1),
          })
          .then(
            result => JSON.stringify(result),
            (error: unknown) => String(error)
          );
        expect(answer).toContain(
          `maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`
        );
      });
    });
  }
);
