import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../errors/nextly-error";

import {
  resolveProvides,
  validateCapabilities,
  validateRequires,
} from "./capabilities";
import type { PluginDefinition } from "./plugin-context";

function plugin(over: Partial<PluginDefinition>): PluginDefinition {
  return {
    name: "@test/p",
    version: "1.0.0",
    nextly: ">=0.0.1",
    ...over,
  } as PluginDefinition;
}

/** The refusal reason, which is what the boot failure is judged on. */
function reasonOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (NextlyError.is(err)) {
      return (err.logContext as { reason?: string } | undefined)?.reason;
    }
    throw err;
  }
  return undefined;
}

describe("validateCapabilities", () => {
  it("refuses an unknown capability key and names the plugin", () => {
    const err = (() => {
      try {
        validateCapabilities([plugin({ capabilities: { fs: {} } as never })]);
      } catch (e) {
        return e as NextlyError;
      }
      return undefined;
    })();
    expect(err && NextlyError.is(err)).toBe(true);
    expect((err?.logContext as { reason?: string }).reason).toBe(
      "unknown-capability"
    );
    expect((err?.logContext as { plugin?: string }).plugin).toBe("@test/p");
  });

  it.each([
    ["http://x", "a URL rather than a host"],
    ["*", "a bare wildcard"],
    ["a*.b", "a wildcard that is not a whole label"],
    ["10.0.0.1", "an IP literal"],
    ["", "empty"],
  ])("refuses the outbound host %s (%s)", host => {
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({ capabilities: { net: { outbound: [host] } } }),
        ])
      )
    ).toBe("invalid-outbound-host");
  });

  it.each([["example.com"], ["*.example.com"], ["sub.example.co.uk"]])(
    "accepts the outbound host %s",
    host => {
      expect(() =>
        validateCapabilities([
          plugin({ capabilities: { net: { outbound: [host] } } }),
        ])
      ).not.toThrow();
    }
  );

  it("refuses a nested secret path whose LAST segment does not exist", () => {
    // Checking only the head accepted this: `providers` exists, so the typo
    // passed and `mapSecrets` then matched nothing — the real `clientSecret`
    // stored in plain text and returned unredacted, which is the exact
    // failure this validation exists to prevent.
    const settings = z.object({
      providers: z.object({ google: z.object({ clientSecret: z.string() }) }),
    });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["providers.google.clientSecrett"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("accepts the same path spelled correctly", () => {
    // The control. A check that refused every nested path would satisfy the
    // test above while making the feature unusable.
    const settings = z.object({
      providers: z.object({ google: z.object({ clientSecret: z.string() }) }),
    });
    expect(() =>
      validateCapabilities([
        plugin({
          contributes: { settings },
          capabilities: { secrets: ["providers.google.clientSecret"] },
        } as never),
      ])
    ).not.toThrow();
  });

  it("accepts a path below a record, whose keys cannot be enumerated", () => {
    // Traversal has to stop where the schema stops being enumerable, or every
    // legitimate per-tenant secret would be refused.
    const settings = z.object({
      tenants: z.record(z.string(), z.object({ apiKey: z.string() })),
    });
    expect(() =>
      validateCapabilities([
        plugin({
          contributes: { settings },
          capabilities: { secrets: ["tenants.acme.apiKey"] },
        } as never),
      ])
    ).not.toThrow();
  });

  it("accepts a wildcard segment and everything under it", () => {
    const settings = z.object({
      providers: z.object({ google: z.object({ clientSecret: z.string() }) }),
    });
    expect(() =>
      validateCapabilities([
        plugin({
          contributes: { settings },
          capabilities: { secrets: ["providers.*.clientSecret"] },
        } as never),
      ])
    ).not.toThrow();
  });

  it("resolves through an optional object rather than stopping at it", () => {
    // `.optional()` wraps the object, so the shape is one level in. Reading
    // only the outer node would find no shape and accept anything below it.
    const settings = z.object({
      smtp: z.object({ password: z.string() }).optional(),
    });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["smtp.passwrod"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("refuses a duplicated secret path", () => {
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({ capabilities: { secrets: ["a.b", "a.b"] } }),
        ])
      )
    ).toBe("invalid-secret-path");
  });

  it.each([[0], [1.5], [-1]])("refuses schemaVersion %s", version => {
    expect(
      reasonOf(() => validateCapabilities([plugin({ schemaVersion: version })]))
    ).toBe("invalid-schema-version");
  });

  it("accepts a positive integer schemaVersion", () => {
    expect(() =>
      validateCapabilities([plugin({ schemaVersion: 3 })])
    ).not.toThrow();
  });

  it("ignores a disabled plugin's manifest entirely", () => {
    expect(() =>
      validateCapabilities([
        plugin({
          enabled: false,
          capabilities: { net: { outbound: ["not a host"] } },
        }),
      ])
    ).not.toThrow();
  });
});

describe("validateRequires", () => {
  const provider = plugin({
    name: "@test/provider",
    version: "1.2.0",
    provides: ["auth-provider"],
  });

  it("refuses a requirement nothing provides", () => {
    expect(
      reasonOf(() =>
        validateRequires([plugin({ requires: { "auth-provider": ">=1.0.0" } })])
      )
    ).toBe("missing-capability");
  });

  it("is satisfied by a provider inside the range", () => {
    expect(() =>
      validateRequires([
        provider,
        plugin({ requires: { "auth-provider": ">=1.0.0" } }),
      ])
    ).not.toThrow();
  });

  it("refuses a provider outside the range, naming both plugins", () => {
    const err = (() => {
      try {
        validateRequires([
          plugin({
            name: "@test/old",
            version: "0.9.0",
            provides: ["auth-provider"],
          }),
          plugin({ requires: { "auth-provider": ">=1.0.0" } }),
        ]);
      } catch (e) {
        return e as NextlyError;
      }
      return undefined;
    })();
    const ctx = err?.logContext as {
      reason?: string;
      plugin?: string;
      provider?: string;
    };
    expect(ctx.reason).toBe("capability-version-incompatible");
    expect(ctx.plugin).toBe("@test/p");
    expect(ctx.provider).toBe("@test/old");
  });

  it("does not let a disabled plugin satisfy a requirement", () => {
    // A disabled plugin contributes nothing, so treating it as a provider
    // would let boot succeed and the capability be missing at runtime.
    expect(
      reasonOf(() =>
        validateRequires([
          { ...provider, enabled: false },
          plugin({ requires: { "auth-provider": ">=1.0.0" } }),
        ])
      )
    ).toBe("missing-capability");
  });

  it("does not require anything from a disabled plugin", () => {
    expect(() =>
      validateRequires([
        plugin({ enabled: false, requires: { "auth-provider": ">=1.0.0" } }),
      ])
    ).not.toThrow();
  });
});

describe("resolveProvides", () => {
  it("maps each capability to the plugin and version providing it", () => {
    const map = resolveProvides([
      plugin({ name: "@test/a", version: "2.0.0", provides: ["x", "y"] }),
    ]);
    expect(map.get("x")).toEqual({ plugin: "@test/a", version: "2.0.0" });
    expect(map.get("y")?.version).toBe("2.0.0");
    expect(map.has("z")).toBe(false);
  });
});
