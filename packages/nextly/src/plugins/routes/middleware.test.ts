import { describe, expect, it } from "vitest";

import type { PluginRouteContext } from "./route-types";
import { composeMiddleware } from "./middleware";

const ctx = {} as PluginRouteContext;
const req = () => new Request("http://x");

describe("composeMiddleware", () => {
  it("runs middleware in order, wrapping the handler (onion model)", async () => {
    const calls: string[] = [];
    const run = composeMiddleware(
      [
        async (_r, _c, next) => {
          calls.push("a:in");
          const res = await next();
          calls.push("a:out");
          return res;
        },
        async (_r, _c, next) => {
          calls.push("b");
          return next();
        },
      ],
      () => {
        calls.push("handler");
        return new Response("h");
      }
    );
    const res = await run(req(), ctx);
    expect(await res.text()).toBe("h");
    expect(calls).toEqual(["a:in", "b", "handler", "a:out"]);
  });

  it("lets a middleware short-circuit without calling next", async () => {
    let handlerRan = false;
    const run = composeMiddleware(
      [async () => new Response("blocked", { status: 403 })],
      () => {
        handlerRan = true;
        return new Response("h");
      }
    );
    const res = await run(req(), ctx);
    expect(res.status).toBe(403);
    expect(handlerRan).toBe(false);
  });

  it("runs the handler directly when there is no middleware", async () => {
    const run = composeMiddleware([], () => new Response("h"));
    expect(await (await run(req(), ctx)).text()).toBe("h");
  });

  it("propagates a thrown error (runPluginRoute maps it to a Response)", async () => {
    const run = composeMiddleware(
      [
        async () => {
          throw new Error("boom");
        },
      ],
      () => new Response("h")
    );
    await expect(run(req(), ctx)).rejects.toThrow("boom");
  });
});
