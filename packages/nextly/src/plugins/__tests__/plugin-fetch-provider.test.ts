/**
 * How one plugin's `ctx.fetch` resolves names, and when it may reach
 * localhost.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";
import { checkPluginPackageDeclaration } from "../declaration";
import { createPluginFetchFor } from "../plugin-fetch-provider";

function plugin(outbound: string[]): PluginDefinition {
  return {
    name: "@acme/p",
    version: "1.0.0",
    nextly: ">=0.0.1",
    capabilities: { net: { outbound } },
  } as PluginDefinition;
}

async function reasonOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (NextlyError.is(error)) {
      return String((error.logContext as { reason?: string }).reason);
    }
    throw error;
  }
  return "not-refused";
}

function dnsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

afterEach(() => {
  lookup.mockReset();
  vi.unstubAllEnvs();
});

describe("name resolution", () => {
  it("asks the system resolver for every address", async () => {
    // Querying DNS directly skipped /etc/hosts and container host aliases.
    lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const fetch = createPluginFetchFor(plugin(["api.example.com"]));

    // The answer is private, so vetting refuses it — proving the resolver's
    // answer is the one judged.
    await reasonOf(fetch!("https://api.example.com/x"));
    expect(lookup).toHaveBeenCalledWith("api.example.com", {
      all: true,
      verbatim: true,
    });
  });

  it("reports a name that does not exist as unresolved", async () => {
    lookup.mockRejectedValue(dnsError("ENOTFOUND"));
    const fetch = createPluginFetchFor(plugin(["api.example.com"]));
    expect(await reasonOf(fetch!("https://api.example.com/x"))).toBe(
      "outbound-unresolved"
    );
  });

  it("reports a resolver failure as what it is, not as a missing name", async () => {
    // Every failure, timeouts included, read as "no such name", which sends
    // an operator looking for a typo in a manifest that is correct.
    lookup.mockRejectedValue(dnsError("ETIMEOUT"));
    const fetch = createPluginFetchFor(plugin(["api.example.com"]));
    expect(await reasonOf(fetch!("https://api.example.com/x"))).toBe(
      "outbound-dns-failed"
    );
  });
});

describe("the development-only loopback exception", () => {
  it.each([[""], ["production"], ["staging"]])(
    'is closed when NODE_ENV is "%s"',
    async mode => {
      // Core reads an unset NODE_ENV as development; a deployment that never
      // set it let a manifest's `localhost` reach local ports.
      vi.stubEnv("NODE_ENV", mode);
      const fetch = createPluginFetchFor(plugin(["localhost"]));
      expect(await reasonOf(fetch!("http://localhost:3999/x"))).toBe(
        "outbound-scheme"
      );
      expect(lookup).not.toHaveBeenCalled();
    }
  );

  it.each([["development"], ["test"]])(
    'is open when NODE_ENV is "%s"',
    async mode => {
      // The control: the exception exists for a fake provider in a test
      // suite. Past the scheme check, the name is resolved.
      vi.stubEnv("NODE_ENV", mode);
      lookup.mockRejectedValue(dnsError("ENOTFOUND"));
      const fetch = createPluginFetchFor(plugin(["localhost"]));
      expect(await reasonOf(fetch!("http://localhost:3999/x"))).toBe(
        "outbound-unresolved"
      );
    }
  );
});

describe("a package declaration that claims more than the definition", () => {
  it("does not widen the hosts ctx.fetch may reach", async () => {
    // The declaration is a promise compared with the definition, never a
    // grant: `ctx.fetch` is made from the definition alone, so a host only
    // the package.json names stays refused, and the comparison names it.
    const definition = plugin(["api.example.com"]);
    const manifest = {
      name: "@acme/p",
      nextly: {
        format: 1,
        core: ">=0.0.1",
        databases: ["sqlite"],
        access: { outbound: ["api.example.com", "evil.example.org"] },
      },
    };
    expect(checkPluginPackageDeclaration(manifest, definition)).toEqual([
      'The declaration lists the outbound host "evil.example.org", which the plugin\'s definition does not have.',
    ]);

    lookup.mockRejectedValue(dnsError("ENOTFOUND"));
    const fetch = createPluginFetchFor(definition);
    expect(await reasonOf(fetch!("https://evil.example.org/x"))).toBe(
      "outbound-host-not-declared"
    );
    // The control: the host both sides name gets past the host check to
    // name resolution, so the refusal above is the host check's.
    expect(await reasonOf(fetch!("https://api.example.com/x"))).toBe(
      "outbound-unresolved"
    );
  });
});
