/**
 * The pinned request reaches a call path nobody threaded.
 *
 * That is the whole point of pinning it. A version restore's read gate, a
 * Direct API form read, a form lookup and a bulk update's readback all reach
 * the hook layer without naming a request, because each is an intermediate
 * call several layers below the one the caller made. A rule reading
 * `ctx.req.http` takes an unnamed request for background work, so a path that
 * cannot name one has to inherit it instead.
 *
 * The other half matters as much: a job started from inside a request must not
 * inherit it, or a server-side import is judged as the visitor who set it off.
 */
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../di/container";

import { resolveRequestFacts } from "./request-facts";
import { currentRequest, runWithRequestScope } from "./request-scope";

const originalProxyIps = process.env.TRUSTED_PROXY_IPS;

afterEach(() => {
  if (originalProxyIps === undefined) delete process.env.TRUSTED_PROXY_IPS;
  else process.env.TRUSTED_PROXY_IPS = originalProxyIps;
});

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/collections/notes", {
    method: "POST",
    headers,
  });
}

describe("the pinned request", () => {
  it("reaches a resolver that was handed nothing", () => {
    container.register("config", () => ({ security: { trustProxy: true } }));
    process.env.TRUSTED_PROXY_IPS = "";
    const request = post({ "x-forwarded-for": "203.0.113.7" });
    const facts = runWithRequestScope(request, () =>
      // The call every unthreaded layer makes: it names no request, because
      // nobody passed it one.
      resolveRequestFacts(undefined)
    );
    expect(facts.http?.ip).toBe("203.0.113.7");
  });

  it("loses to a request the caller named", () => {
    container.register("config", () => ({ security: { trustProxy: true } }));
    process.env.TRUSTED_PROXY_IPS = "";
    const named = post({ "x-forwarded-for": "198.51.100.4" });
    const facts = runWithRequestScope(
      post({ "x-forwarded-for": "203.0.113.7" }),
      () => resolveRequestFacts(named)
    );
    // A floor, not an override. A caller that knows better keeps saying so.
    expect(facts.http?.ip).toBe("198.51.100.4");
  });

  it("says nothing outside a scope", () => {
    // The control. Without this the two cases above would pass against a
    // resolver that reported a request for everything it was ever asked.
    expect(currentRequest()).toBeUndefined();
    expect(resolveRequestFacts(undefined).http).toBeUndefined();
  });

  it("is cleared, not inherited, by work that runs on nobody's request", () => {
    const facts = runWithRequestScope(post(), () =>
      // What the jobs client does around every bound operation.
      runWithRequestScope(undefined, () => resolveRequestFacts(undefined))
    );
    expect(facts.http).toBeUndefined();
  });

  it("survives an await, which is why a module variable would not do", async () => {
    container.register("config", () => ({ security: { trustProxy: true } }));
    process.env.TRUSTED_PROXY_IPS = "";
    const facts = await runWithRequestScope(
      post({ "x-forwarded-for": "203.0.113.7" }),
      async () => {
        await Promise.resolve();
        return resolveRequestFacts(undefined);
      }
    );
    expect(facts.http?.ip).toBe("203.0.113.7");
  });
});
