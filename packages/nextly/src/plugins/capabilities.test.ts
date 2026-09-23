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

  it("refuses a typoed suffix reached through an ARRAY of objects", () => {
    // An array exposes an element schema rather than a record value schema,
    // and treating "no value schema" as "accept" waved the typo through —
    // `mapSecrets` then never matched the real field, so every element's
    // credential was stored in plain text and returned unredacted.
    const settings = z.object({
      providers: z.array(
        z.object({ clientSecret: z.string(), name: z.string() })
      ),
    });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["providers.*.clientSecrett"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("accepts a correctly spelled secret path through an array's elements", () => {
    // The control for the case above: the wildcard descends into the ELEMENT
    // schema, so the real field is found and the path is legitimate.
    const settings = z.object({
      providers: z.array(
        z.object({ clientSecret: z.string(), name: z.string() })
      ),
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

  it("refuses a NAMED member of an array, whose elements have no names", () => {
    const settings = z.object({
      providers: z.array(z.object({ clientSecret: z.string() })),
    });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["providers.google.clientSecret"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("refuses a path that descends past a scalar into a typo", () => {
    // `clientSecret.typo` over a plain string: the string is neither an
    // object nor a record, and accepting whatever cannot be enumerated let
    // this typo pass too — nothing inside a string can match the secret map.
    const settings = z.object({ clientSecret: z.string() });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["clientSecret.typo"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("refuses a path descending past a scalar behind an optional", () => {
    // The wrapper is unwrapped before the leaf is judged, so an optional
    // credential is protected exactly where a required one is.
    const settings = z.object({ clientSecret: z.string().optional() });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["clientSecret.oops"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("accepts a path below a union, whose options cannot be enumerated", () => {
    // The control for the leaf refusal: a union is not a leaf — one of its
    // options may hold the declared path — and neither accepting nor
    // refusing can be proven from the union itself.
    const settings = z.object({
      config: z.union([
        z.object({ apiKey: z.string() }),
        z.object({ token: z.string() }),
      ]),
    });
    expect(() =>
      validateCapabilities([
        plugin({
          contributes: { settings },
          capabilities: { secrets: ["config.apiKey"] },
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

  it("checks the segments after a wildcard over an OBJECT", () => {
    // A `*` over an object matches whichever keys it HAS — but the suffix
    // still has to exist under one of them. Accepting at the wildcard was the
    // record case's defect wearing the other shape, and the consequence is the
    // same: `mapSecrets` matches nothing, so the credential is stored in plain
    // text and returned unredacted.
    const settings = z.object({
      providers: z.object({ google: z.object({ clientSecret: z.string() }) }),
    });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["providers.*.clientSecrett"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("accepts a wildcard suffix that exists under ONE of the keys", () => {
    // The control, and the reason the rule is "some" rather than "every": a
    // wildcard names any key, so a suffix present under one of them is a
    // declaration that matches something real.
    const settings = z.object({
      providers: z.object({
        google: z.object({ clientSecret: z.string() }),
        anonymous: z.object({ enabled: z.boolean() }),
      }),
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

  it("checks the segments AFTER a wildcard over a record", () => {
    // A record accepts any KEY, which says nothing about what is beneath it.
    // Stopping at the `*` accepted this typo exactly as stopping at the head
    // accepted `providers.google.clientSecrett` — and a secret path matching
    // nothing is not inert: `mapSecrets` never finds the real credential, so
    // it is stored in plain text and returned unredacted.
    const settings = z.object({
      providers: z.record(z.string(), z.object({ clientSecret: z.string() })),
    });
    expect(
      reasonOf(() =>
        validateCapabilities([
          plugin({
            contributes: { settings },
            capabilities: { secrets: ["providers.*.clientSecrett"] },
          } as never),
        ])
      )
    ).toBe("unknown-secret-path");
  });

  it("accepts the correct suffix through that same record", () => {
    // The control. Refusing everything below a record would satisfy the test
    // above while rejecting the per-tenant declarations this feature is for.
    const settings = z.object({
      providers: z.record(z.string(), z.object({ clientSecret: z.string() })),
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

describe("a capability has ONE provider", () => {
  const providing = (name: string, capability: string) =>
    ({
      name,
      version: "1.0.0",
      nextly: ">=0.0.1",
      provides: [capability],
    }) as unknown as PluginDefinition;

  it("REFUSES two plugins providing the same capability, naming both", () => {
    // Overwriting made the winner depend on config array order, so a
    // consumer's version requirement passed or failed for a reason no
    // manifest records.
    let caught: unknown;
    try {
      validateRequires([
        providing("@acme/a", "webhook-signing"),
        providing("@acme/b", "webhook-signing"),
      ]);
    } catch (err) {
      caught = err;
    }
    const context = (caught as NextlyError | undefined)?.logContext as
      | { reason?: string; providers?: string[] }
      | undefined;
    expect(context?.reason).toBe("capability-provided-twice");
    expect(context?.providers).toEqual(["@acme/a", "@acme/b"]);
  });

  it("allows two plugins providing DIFFERENT capabilities", () => {
    // The control: refusing any two providers at all would satisfy the test
    // above while making a second plugin impossible to install.
    expect(() =>
      validateRequires([
        providing("@acme/a", "webhook-signing"),
        providing("@acme/b", "image-resizing"),
      ])
    ).not.toThrow();
  });

  it("ignores a DISABLED plugin's provides", () => {
    // A plugin that is off provides nothing, so it cannot collide.
    expect(() =>
      validateRequires([
        providing("@acme/a", "webhook-signing"),
        {
          ...providing("@acme/b", "webhook-signing"),
          enabled: false,
        } as unknown as PluginDefinition,
      ])
    ).not.toThrow();
  });
});

describe("localhost is declarable for development", () => {
  const outbound = (host: string) =>
    ({
      name: "@acme/p",
      version: "1.0.0",
      nextly: ">=0.0.1",
      capabilities: { net: { outbound: [host] } },
    }) as unknown as PluginDefinition;

  it("accepts the bare name, which has no dot", () => {
    // The documented development-only loopback exception was unreachable
    // through a real manifest: the hostname pattern requires a dot, so a
    // plugin could not declare the host its own tests need.
    expect(() => validateCapabilities([outbound("localhost")])).not.toThrow();
  });

  it("still refuses an address literal", () => {
    // The control, and the reason the exception is a NAME rather than a
    // loosened pattern: `ctx.fetch` vets the resolved address, and a literal
    // declared here would bypass the name it is supposed to check.
    expect(() => validateCapabilities([outbound("127.0.0.1")])).toThrow();
  });
});
