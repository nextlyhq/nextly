import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthUser } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { INTERNAL_ERROR_TEXT } from "../answer";
import { registerInitialContext } from "../initial-context";

/**
 * `get_initial_context` fails the way every other tool does: the agent is told one constant
 * sentence and never the failure itself, and the log names the failure by its kind, not its
 * message. The protocol library answers a tool that throws with the thrown message as the
 * result's text, so a driver's error quoting a connection string would reach the model.
 *
 * The read is the SDK's own (`readableContent`), so the failure is made there.
 */
const RAW =
  'connect ECONNREFUSED postgres://admin:hunter2@db.internal/cms: select * from "users"';

vi.mock("@nextlyhq/plugin-sdk", async original => ({
  ...(await original<typeof import("@nextlyhq/plugin-sdk")>()),
  readableContent: () => Promise.reject(new Error(RAW)),
}));

const PERSON: AuthUser = {
  id: "person-1" as AuthUser["id"],
  email: "person@example.com",
};

describe("get_initial_context, when its read fails", () => {
  it("answers with the constant sentence and logs the failure without its message", async () => {
    const logged: unknown[] = [];
    const record = (message: string, meta?: Record<string, unknown>) => {
      logged.push({ message, ...(meta ? { meta } : {}) });
    };
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "nextly", version: "0.0.0" });
      registerInitialContext(server, {
        user: PERSON,
        logger: { debug: record, info: record, warn: record, error: record },
      });
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
          params: { name: "get_initial_context", arguments: {} },
        }),
      })
    );
    const raw = await response.text();

    // Nothing of the failure reaches the wire, and the answer says it failed.
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("ECONNREFUSED");
    expect(raw).toContain(INTERNAL_ERROR_TEXT);
    const line = raw
      .split("\n")
      .find(l => l.startsWith("data: ") || l.trimStart().startsWith("{"));
    const body = JSON.parse(
      line?.startsWith("data: ") ? line.slice(6) : (line ?? raw)
    ) as {
      result?: { isError?: boolean; structuredContent?: { error?: unknown } };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.error).toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: expect.any(String),
    });
    // The control: the read was reached and failed, and the operator has it by kind.
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).not.toContain("hunter2");
    expect(JSON.stringify(logged[0])).toContain('"name":"Error"');
  });
});
