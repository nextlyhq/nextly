/**
 * What a hook is told about the request behind an operation.
 *
 * Two things have to hold. The presence of `http` has to mean "a request
 * produced this", independently of whether an address could be resolved, or a
 * rule scoped to visitors would stand down for every visitor behind an
 * untrusted proxy. And the address itself has to be the one the deployment's
 * proxy-trust settings pick, not the leftmost hop, which is whatever the sender
 * chose to claim.
 */
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../di/container";

import { resolveRequestFacts } from "./request-facts";

function withTrustProxy(trustProxy: boolean): void {
  container.register("config", () => ({ security: { trustProxy } }));
}

const originalProxyIps = process.env.TRUSTED_PROXY_IPS;

afterEach(() => {
  if (originalProxyIps === undefined) delete process.env.TRUSTED_PROXY_IPS;
  else process.env.TRUSTED_PROXY_IPS = originalProxyIps;
});

function post(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/collections/forms", {
    method: "POST",
    headers,
  });
}

describe("resolveRequestFacts", () => {
  it("says nothing when no request produced the operation", () => {
    const facts = resolveRequestFacts(undefined);
    expect(facts.http).toBeUndefined();
    expect(facts.headers).toBeUndefined();
  });

  it("reports that a request happened even when no address can be trusted", () => {
    withTrustProxy(false);
    const facts = resolveRequestFacts(
      post({ "x-forwarded-for": "203.0.113.7" })
    );
    // The distinction the whole channel exists for: a visitor behind an
    // untrusted proxy is still a visitor. Folding this case into "no request"
    // would exempt exactly the callers a request-scoped rule is aimed at.
    expect(facts.http).toBeDefined();
    expect(facts.http?.ip).toBeNull();
    expect(facts.http?.method).toBe("POST");
  });

  it("takes the closest untrusted hop, not the one the sender claims", () => {
    withTrustProxy(true);
    process.env.TRUSTED_PROXY_IPS = "10.0.0.0/8";
    const facts = resolveRequestFacts(
      post({ "x-forwarded-for": "198.51.100.9, 203.0.113.7, 10.1.2.3" })
    );
    expect(facts.http?.ip).toBe("203.0.113.7");
  });

  it("carries the headers a hook may want to read", () => {
    withTrustProxy(false);
    const facts = resolveRequestFacts(post({ "user-agent": "probe/1.0" }));
    expect(facts.headers?.["user-agent"]).toBe("probe/1.0");
  });

  it("hands every hook the same unwritable answer", () => {
    // `readonly` refuses the assignment at compile time; the cast below takes
    // that away, so this still measures the runtime freeze rather than the
    // type. Both matter: a plugin compiled against an older contract reaches
    // the same object.
    withTrustProxy(true);
    process.env.TRUSTED_PROXY_IPS = "";
    const facts = resolveRequestFacts(post({ "x-real-ip": "203.0.113.7" }));
    expect(facts.http?.ip).toBe("203.0.113.7");
    expect(() => {
      (facts.http as { ip: string | null }).ip = "198.51.100.1";
    }).toThrow();
  });
});
