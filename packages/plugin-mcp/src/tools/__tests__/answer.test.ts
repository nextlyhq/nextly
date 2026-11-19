import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import {
  NextlyError,
  type AuthUser,
  type PluginWorkflowsService,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { INTERNAL_ERROR_TEXT, REFUSED_TEXT, type ToolCaller } from "../answer";
import { registerWorkflowTools } from "../workflows";

/**
 * What an agent is told when a review tool fails: never the failure itself.
 *
 * The protocol library answers a tool that throws with the thrown message as the result's text,
 * so a driver error, a bug or a `NextlyError`'s log context would reach the model verbatim. Each
 * tool catches every error: a `NextlyError` is answered with its public JSON, anything else with
 * one constant sentence, and the original goes to the plugin's log.
 *
 * The seam is the caller every tool is registered with. Tools take the request's context as an
 * argument rather than reading it (so a server answers for the caller it was built for), which
 * is what lets this suite hand them a service that throws, through the real protocol server and
 * handler, with nothing in the product code made replaceable for the test.
 */

/** What a failure must never show the agent: a credential and a query, as a driver might. */
const RAW =
  'connect ECONNREFUSED postgres://admin:hunter2@db.internal/cms: select * from "users"';

/** The person the tools act for. The id is branded by core; a fixed one is enough here. */
const PERSON: AuthUser = {
  id: "person-1" as AuthUser["id"],
  email: "person@example.com",
};

/** A service whose every method fails with `error`. */
function failingWith(error: unknown): PluginWorkflowsService {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return {
    definitionOf: fail,
    reviewState: fail,
    waiting: fail,
    submit: fail,
  };
}

/** A caller whose service fails with `error`, recording what is logged. */
function callerFailingWith(error: unknown) {
  const logged: { message: string; meta?: Record<string, unknown> }[] = [];
  const record = (message: string, meta?: Record<string, unknown>) => {
    logged.push({ message, ...(meta ? { meta } : {}) });
  };
  const caller: ToolCaller = {
    user: PERSON,
    logger: { debug: record, info: record, warn: record, error: record },
    services: { workflows: failingWith(error) },
  };
  return { caller, logged };
}

/** Each tool, with arguments its input accepts, so the call reaches the service. */
const CALLS: [string, Record<string, unknown>][] = [
  ["get_workflow", { collection: "posts" }],
  ["get_review_state", { document: { collection: "posts", id: "1" } }],
  ["list_waiting_for_review", {}],
  [
    "submit_for_review",
    {
      document: { collection: "posts", id: "1" },
      parts: ["en"],
      seen: [{ part: "en", revision: 0, version: "v1" }],
      comment: "Ready",
    },
  ],
];

interface CallBody {
  result?: {
    isError?: boolean;
    content?: { type: string; text: string }[];
    structuredContent?: { error?: Record<string, unknown> };
  };
  error?: { code: number; message: string };
}

/** One tool call, through the protocol server and handler a request reaches. */
async function call(
  caller: ToolCaller,
  name: string,
  args: Record<string, unknown>
): Promise<{ raw: string; body: CallBody }> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "nextly", version: "0.0.0" });
    registerWorkflowTools(server, caller);
    return server;
  });
  const response = await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    })
  );
  const raw = await response.text();
  const line = raw
    .split("\n")
    .find(l => l.startsWith("data: ") || l.trimStart().startsWith("{"));
  const json = line?.startsWith("data: ") ? line.slice(6) : (line ?? raw);
  return { raw, body: JSON.parse(json) as CallBody };
}

describe("a review tool that fails tells the agent nothing of the failure", () => {
  it.each(CALLS)(
    "%s: answers a non-Nextly error with the constant sentence, and logs the original",
    async (name, args) => {
      const { caller, logged } = callerFailingWith(new Error(RAW));

      const { raw, body } = await call(caller, name, args);

      expect(body.error, JSON.stringify(body.error)).toBeUndefined();
      expect(body.result?.isError).toBe(true);
      expect(body.result?.content).toEqual([
        { type: "text", text: INTERNAL_ERROR_TEXT },
      ]);
      expect(body.result?.structuredContent?.error).toMatchObject({
        code: "INTERNAL_ERROR",
        requestId: expect.any(String),
      });
      // Nothing of the raw message reaches the wire, in any field.
      expect(raw).not.toContain("hunter2");
      expect(raw).not.toContain("ECONNREFUSED");
      // The control: the service was reached and failed, and the operator can find it.
      expect(logged).toHaveLength(1);
      expect(JSON.stringify(logged[0])).toContain("hunter2");
      expect(JSON.stringify(logged[0])).toContain(
        String(body.result?.structuredContent?.error?.requestId)
      );
    }
  );

  it("answers a thrown value that is not an Error alike", async () => {
    const { caller } = callerFailingWith(RAW);

    const { raw, body } = await call(caller, "get_workflow", {
      collection: "posts",
    });

    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toBe(INTERNAL_ERROR_TEXT);
    expect(raw).not.toContain("hunter2");
  });

  it.each(CALLS)(
    "%s: answers a NextlyError with its public JSON, never its log context",
    async (name, args) => {
      const { caller, logged } = callerFailingWith(
        NextlyError.notFound({ logContext: { secret: RAW } })
      );

      const { raw, body } = await call(caller, name, args);

      expect(body.result?.isError).toBe(true);
      expect(body.result?.content).toEqual([
        { type: "text", text: REFUSED_TEXT },
      ]);
      const error = body.result?.structuredContent?.error;
      expect(error).toMatchObject({
        code: "NOT_FOUND",
        message: expect.any(String),
        requestId: expect.any(String),
      });
      expect(error).not.toHaveProperty("logContext");
      expect(raw).not.toContain("hunter2");
      // A deliberate refusal is not a fault: nothing is logged as one.
      expect(logged).toEqual([]);
    }
  );
});
