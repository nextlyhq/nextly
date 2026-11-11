import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginContext, PluginDefinition } from "../../plugin-context";
import {
  answerProxyRequest,
  clearProxyHandlers,
  collectProxyHandlers,
  hasProxyHandlers,
  registerProxyHandler,
} from "../proxy-registry";
import type { PluginProxyHandler } from "../proxy-types";

function plugin(
  name: string,
  proxy: unknown[],
  enabled?: boolean
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    ...(enabled === undefined ? {} : { enabled }),
    contributes: { proxy: proxy as PluginProxyHandler[] },
  } as PluginDefinition;
}

function contextNamed(name: string) {
  const error = vi.fn();
  const ctx = { name, logger: { error } } as unknown as PluginContext;
  return { ctx, error };
}

const request = new Request("https://example.com/old");

/** A handler that answers nothing. */
const noop = (): undefined => undefined;

afterEach(() => clearProxyHandlers());

describe("collecting proxy handlers", () => {
  it("keeps every enabled plugin's handlers, in plugin order", () => {
    const a = { name: "a", handle: noop };
    const b = { name: "b", handle: noop };
    const off = { name: "off", handle: noop };
    expect(
      collectProxyHandlers([
        plugin("first", [a]),
        plugin("disabled", [off], false),
        plugin("second", [b]),
      ])
    ).toEqual([
      { pluginName: "first", handler: a },
      { pluginName: "second", handler: b },
    ]);
  });

  it.each([
    ["no name", [{ handle: noop }], "invalid-proxy-handler"],
    ["a blank name", [{ name: " ", handle: noop }], "invalid-proxy-handler"],
    ["no handle", [{ name: "x" }], "invalid-proxy-handler"],
    [
      "one name twice",
      [
        { name: "x", handle: noop },
        { name: "x", handle: noop },
      ],
      "duplicate-proxy-handler",
    ],
  ])("fails the boot on a handler with %s", (_, handlers, reason) => {
    expect(() => collectProxyHandlers([plugin("p", handlers)])).toThrow(
      expect.objectContaining({
        code: "PLUGIN_RESOLUTION_ERROR",
        logContext: expect.objectContaining({ reason, pluginName: "p" }),
      })
    );
  });
});

describe("putting a request to every handler", () => {
  it("hands each handler the request and its own plugin's context", async () => {
    const seen: unknown[] = [];
    const { ctx } = contextNamed("one");
    registerProxyHandler(
      {
        pluginName: "one",
        handler: {
          name: "h",
          handle: (req, given) => {
            seen.push(req, given);
            return undefined;
          },
        },
      },
      ctx
    );

    await answerProxyRequest(request);

    expect(seen).toEqual([request, ctx]);
  });

  it("answers with the first response in plugin order, and merges headers", async () => {
    const first = new Response("first");
    const second = new Response("second");
    registerProxyHandler(
      {
        pluginName: "a",
        handler: {
          name: "h",
          handle: async () => ({
            response: first,
            headers: { "x-a": "1", "x-both": "a" },
          }),
        },
      },
      contextNamed("a").ctx
    );
    registerProxyHandler(
      {
        pluginName: "b",
        handler: {
          name: "h",
          handle: () => ({
            response: second,
            headers: { "x-both": "b" },
            requestHeaders: { "x-path": "/old" },
          }),
        },
      },
      contextNamed("b").ctx
    );

    const answer = await answerProxyRequest(request);

    expect(answer.response).toBe(first);
    expect(answer.headers).toEqual({ "x-a": "1", "x-both": "b" });
    expect(answer.requestHeaders).toEqual({ "x-path": "/old" });
  });

  it("logs a handler that throws and goes on with the others", async () => {
    const failing = contextNamed("failing");
    registerProxyHandler(
      {
        pluginName: "failing",
        handler: {
          name: "boom",
          handle: () => {
            throw new Error("down");
          },
        },
      },
      failing.ctx
    );
    registerProxyHandler(
      {
        pluginName: "ok",
        handler: { name: "h", handle: () => ({ headers: { "x-ok": "1" } }) },
      },
      contextNamed("ok").ctx
    );

    const answer = await answerProxyRequest(request);

    expect(answer).toEqual({ headers: { "x-ok": "1" }, requestHeaders: {} });
    expect(failing.error).toHaveBeenCalledWith(
      "A proxy handler failed; the request goes on",
      expect.objectContaining({ plugin: "failing", handler: "boom" })
    );
  });

  it("says whether any handler is registered, and forgets them on clear", () => {
    expect(hasProxyHandlers()).toBe(false);
    registerProxyHandler(
      { pluginName: "a", handler: { name: "h", handle: noop } },
      contextNamed("a").ctx
    );
    expect(hasProxyHandlers()).toBe(true);
    clearProxyHandlers();
    expect(hasProxyHandlers()).toBe(false);
  });
});
