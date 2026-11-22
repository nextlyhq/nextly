/**
 * The linking policy answers from the app's own auth configuration, and only
 * from it.
 *
 * Each test names the property that separates the policy from a plausible
 * broken one: a key that isn't enabled is refused (not merely inconvenient),
 * trust and provisioning are separate switches from `enabled` (so a linked
 * identity signs in through a key with neither, while an untrusted key
 * refuses the implicit-link branch), everything unconfigured or malformed
 * reads as off — including fields a polluted prototype would feed a row that
 * never wrote them — and the verdict follows the app's configuration, the
 * one input the reader accepts.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  linkingPolicyFromAuthConfig,
  type LinkingPolicyAuthConfig,
} from "../linking-policy";

/** The refusal `requireEnabled` makes, as a FORBIDDEN NextlyError. */
function refusalOf(build: () => unknown): NextlyError {
  try {
    build();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    expect(NextlyError.isCode(error, "FORBIDDEN")).toBe(true);
    return error as NextlyError;
  }
  throw new Error("expected the policy to refuse, and it did not");
}

describe("a key the configuration doesn't enable", () => {
  it("refuses a key named without enabled: true, before any lookup", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { google: { trustedForImplicitLinking: true } },
    });
    const refusal = refusalOf(() => policy.requireEnabled("google"));
    expect(refusal.logContext).toMatchObject({
      reason: "provider-key-not-enabled",
      providerKey: "google",
    });
  });

  it("refuses a key named with enabled: false", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { google: { enabled: false } },
    });
    const refusal = refusalOf(() => policy.requireEnabled("google"));
    expect(refusal.logContext).toMatchObject({
      reason: "provider-key-not-enabled",
    });
  });

  it("refuses a provider key absent from the configuration", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { github: { enabled: true } },
    });
    const refusal = refusalOf(() => policy.requireEnabled("google"));
    expect(refusal.logContext).toMatchObject({
      reason: "provider-key-not-configured",
      providerKey: "google",
    });
  });

  it("refuses every key when the configuration is missing entirely", () => {
    const policy = linkingPolicyFromAuthConfig(undefined);
    const refusal = refusalOf(() => policy.requireEnabled("google"));
    expect(refusal.logContext).toMatchObject({
      reason: "provider-key-not-configured",
    });
    // The non-throwing read refuses across the board too: absent
    // configuration enables nothing.
    expect(policy.policyFor("google")).toEqual({
      enabled: false,
      trustedForImplicitLinking: false,
      provisioning: { mayProvision: false },
    });
  });

  it("refuses a key inherited from the prototype, not written by the app", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { github: { enabled: true } },
    });
    // A key that reaches the matrix only through the prototype chain —
    // `constructor`, `__proto__` — is not one the app wrote, so it finds the
    // refused row rather than an inherited object to resolve.
    const refusal = refusalOf(() => policy.requireEnabled("constructor"));
    expect(refusal.logContext).toMatchObject({
      reason: "provider-key-not-configured",
    });
    expect(policy.policyFor("__proto__").enabled).toBe(false);
  });
});

describe("trust for implicit linking and permission to provision", () => {
  it("answers false for the implicit-link branch through a key not trusted", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { google: { enabled: true } },
    });
    // The gate passes: the sign-in itself is not refused. The branch answer
    // is what refuses the implicit link, and it is false while a trusted
    // key's is true, so enabled-ness alone does not answer the question.
    const google = policy.requireEnabled("google");
    expect(google.trustedForImplicitLinking).toBe(false);
    expect(
      linkingPolicyFromAuthConfig({
        providers: {
          github: { enabled: true, trustedForImplicitLinking: true },
        },
      }).requireEnabled("github").trustedForImplicitLinking
    ).toBe(true);
  });

  it("refuses provisioning through a key that may not provision", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { google: { enabled: true } },
    });
    const google = policy.requireEnabled("google");
    // mayProvision false, and no roles to read: the switch is the presence
    // of a configured role set, not a flag beside one.
    expect(google.provisioning.mayProvision).toBe(false);
    expect("roles" in google.provisioning).toBe(false);
    // The control: a key configured to provision carries its role set.
    const office = linkingPolicyFromAuthConfig({
      providers: {
        office: { enabled: true, provision: { roles: ["editor", "viewer"] } },
      },
    }).requireEnabled("office");
    expect(office.provisioning).toEqual({
      mayProvision: true,
      roles: ["editor", "viewer"],
    });
  });

  it("lets a linked identity sign in through a key with neither", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { google: { enabled: true } },
    });
    // Neither trusted for implicit linking nor allowed to provision, and the
    // gate still opens: those two govern their own branches only, so an
    // identity already linked signs in through this key.
    const google = policy.requireEnabled("google");
    expect(google.trustedForImplicitLinking).toBe(false);
    expect(google.provisioning.mayProvision).toBe(false);
  });
});

describe("where the policy comes from", () => {
  it("follows the app's configuration, the reader's only input", () => {
    // The reader takes the app's auth configuration and nothing else; a
    // sign-in a plugin hands over carries no argument into it, so the
    // verdict can move only when the configuration moves. Asserted on
    // both sides of that: one configuration refuses the key, and the
    // configuration that enables it passes the gate. That a plugin
    // supplying its own policy is refused where the payload first arrives,
    // at the sign-in boundary, is the identity-service slice's test.
    const refuses = refusalOf(() =>
      linkingPolicyFromAuthConfig({
        providers: { google: { trustedForImplicitLinking: true } },
      }).requireEnabled("google")
    );
    expect(refuses.logContext).toMatchObject({
      reason: "provider-key-not-enabled",
    });
    expect(
      linkingPolicyFromAuthConfig({
        providers: {
          google: { enabled: true, trustedForImplicitLinking: true },
        },
      }).requireEnabled("google").trustedForImplicitLinking
    ).toBe(true);
  });
});

describe("unconfigured and malformed configuration reads as off", () => {
  it("enables nothing a boolean true did not switch on", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: {
        google: {
          enabled: "true" as unknown as boolean,
          trustedForImplicitLinking: 1 as unknown as boolean,
          provision: "on" as unknown as { roles?: readonly string[] },
        },
        legacy: "enabled" as unknown as {
          enabled?: boolean;
          trustedForImplicitLinking?: boolean;
          provision?: { roles?: readonly string[] };
        },
      },
    });
    for (const key of ["google", "legacy"]) {
      const refusal = refusalOf(() => policy.requireEnabled(key));
      expect(refusal.logContext).toMatchObject({
        reason: "provider-key-not-enabled",
      });
    }
    expect(policy.policyFor("google").trustedForImplicitLinking).toBe(false);
    expect(policy.policyFor("google").provisioning.mayProvision).toBe(false);
  });

  it("provisions nothing without a roles array of at least one role name", () => {
    // A hole between real role names: `["editor", <hole>, "viewer"]`. zod
    // reads the hole as an element and `z.string()` refuses it, so the
    // array is refused whole rather than compacted around the hole.
    const gapRoles: string[] = ["editor"];
    gapRoles[2] = "viewer";
    const policy = linkingPolicyFromAuthConfig({
      providers: {
        stringRoles: {
          enabled: true,
          provision: { roles: "editor" as unknown as readonly string[] },
        },
        mixedRoles: {
          enabled: true,
          provision: { roles: ["editor", 42] as unknown as readonly string[] },
        },
        noRoles: { enabled: true, provision: {} },
        // An empty array is off, not zero-role provisioning: the roles are
        // the switch, and at least one is required to switch on.
        emptyRoles: { enabled: true, provision: { roles: [] } },
        // A holey array carries an element zod reads as undefined, which
        // z.string() refuses: pinning that a hole is not a role name.
        holeyRoles: {
          enabled: true,
          provision: {
            roles: new Array(1) as unknown as readonly string[],
          },
        },
        gapRoles: { enabled: true, provision: { roles: gapRoles } },
        // An empty string names no role, and one blank element refuses the
        // whole provision, as every malformed line here does.
        blankRoles: { enabled: true, provision: { roles: [""] } },
        trailingBlank: {
          enabled: true,
          provision: { roles: ["editor", ""] },
        },
      },
    });
    for (const key of [
      "stringRoles",
      "mixedRoles",
      "noRoles",
      "emptyRoles",
      "holeyRoles",
      "gapRoles",
      "blankRoles",
      "trailingBlank",
    ]) {
      expect(policy.requireEnabled(key).provisioning.mayProvision).toBe(false);
    }
  });

  it("refuses a row whose gate fields are malformed, not only absent", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: {
        // A gate field carrying anything but literal true fails the row
        // itself: the key refuses across the board, so a malformed gate
        // value cannot leave the row standing with the other gate on.
        google: {
          trustedForImplicitLinking: true,
          enabled: "yes" as unknown as boolean,
        },
      },
    });
    const refusal = refusalOf(() => policy.requireEnabled("google"));
    expect(refusal.logContext).toMatchObject({
      reason: "provider-key-not-enabled",
    });
    expect(policy.policyFor("google")).toEqual({
      enabled: false,
      trustedForImplicitLinking: false,
      provisioning: { mayProvision: false },
    });
  });

  it("reads no field a polluted Object.prototype feeds an empty row", () => {
    // The three switch fields, planted on the prototype every object
    // inherits. Saved and restored around the assertion, because this
    // worker runs other files' modules after this one and they must not
    // see the pollution.
    const fields = [
      "enabled",
      "trustedForImplicitLinking",
      "provision",
    ] as const;
    const saved = fields.map(field =>
      Object.getOwnPropertyDescriptor(Object.prototype, field)
    );
    try {
      for (const field of fields) {
        (Object.prototype as Record<string, unknown>)[field] =
          field === "provision" ? { roles: ["editor"] } : true;
      }
      const policy = linkingPolicyFromAuthConfig({
        providers: { google: {} },
      });
      // The app wrote an empty row for this key: nothing it configured
      // enables anything, and the fields every object now inherits are
      // never read, so the row refuses across the board.
      const refusal = refusalOf(() => policy.requireEnabled("google"));
      expect(refusal.logContext).toMatchObject({
        reason: "provider-key-not-enabled",
      });
      expect(policy.policyFor("google")).toEqual({
        enabled: false,
        trustedForImplicitLinking: false,
        provisioning: { mayProvision: false },
      });
    } finally {
      fields.forEach((field, index) => {
        const descriptor = saved[index];
        if (descriptor) {
          Object.defineProperty(Object.prototype, field, descriptor);
        } else {
          delete (Object.prototype as Record<string, unknown>)[field];
        }
      });
    }
  });

  it("reads no providers map a polluted Object.prototype feeds", () => {
    // A fully-enabled provider map, planted on the prototype the app's auth
    // object inherits. Saved and restored in finally, like the pollution
    // test above, because this worker's modules outlive this file.
    const saved = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "providers"
    );
    try {
      (Object.prototype as Record<string, unknown>).providers = {
        google: {
          enabled: true,
          trustedForImplicitLinking: true,
          provision: { roles: ["admin"] },
        },
      };
      // The app's auth object owns no providers field, so the map every
      // object now inherits is not its configuration: nothing is
      // configured, and every key refuses as the all-refused default does.
      const policy = linkingPolicyFromAuthConfig({});
      const refusal = refusalOf(() => policy.requireEnabled("google"));
      expect(refusal.logContext).toMatchObject({
        reason: "provider-key-not-configured",
      });
    } finally {
      if (saved) {
        Object.defineProperty(Object.prototype, "providers", saved);
      } else {
        delete (Object.prototype as Record<string, unknown>).providers;
      }
    }
  });

  it("reads no roles a polluted Object.prototype feeds an empty provision", () => {
    // One level down from the row: the app's row owns its provision object,
    // and that object owns no roles field. A `roles` array planted on the
    // prototype would otherwise speak as the app's role set.
    const saved = Object.getOwnPropertyDescriptor(Object.prototype, "roles");
    try {
      (Object.prototype as Record<string, unknown>).roles = ["admin"];
      const policy = linkingPolicyFromAuthConfig({
        providers: { google: { enabled: true, provision: {} } },
      });
      expect(policy.requireEnabled("google").provisioning.mayProvision).toBe(
        false
      );
    } finally {
      if (saved) {
        Object.defineProperty(Object.prototype, "roles", saved);
      } else {
        delete (Object.prototype as Record<string, unknown>).roles;
      }
    }
  });

  it("reads no role name a polluted Array.prototype feeds a hole", () => {
    // A hole in the roles array, with a role name planted at its index on
    // Array.prototype: reading the hole by index would find the planted
    // name, and a holey array would provision with attacker roles. Only
    // indices the array OWNS are read, so the hole refuses.
    const saved = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    try {
      (Array.prototype as unknown as Record<string, unknown>)[0] = "admin";
      const policy = linkingPolicyFromAuthConfig({
        providers: {
          google: {
            enabled: true,
            provision: { roles: new Array(1) as unknown as readonly string[] },
          },
        },
      });
      expect(policy.requireEnabled("google").provisioning.mayProvision).toBe(
        false
      );
    } finally {
      if (saved) {
        Object.defineProperty(Array.prototype, "0", saved);
      } else {
        delete (Array.prototype as unknown as Record<string, unknown>)[0];
      }
    }
  });
});

describe("the matrix is a snapshot of the configuration as the app wrote it", () => {
  it("keeps its answers when the app's configuration object is edited afterwards", () => {
    const roles: string[] = ["editor"];
    const appConfig: { providers?: LinkingPolicyAuthConfig["providers"] } = {
      providers: {
        google: { enabled: true, provision: { roles } },
      },
    };
    const policy = linkingPolicyFromAuthConfig(appConfig);
    // A plugin's setup transformer, or anything else holding the app's
    // object, edits it after the boot resolved the matrix.
    appConfig.providers = undefined;
    roles.push("super-admin");
    const google = policy.requireEnabled("google");
    expect(google.provisioning).toEqual({
      mayProvision: true,
      roles: ["editor"],
    });
  });

  it("freezes its rows, so nothing later flips a key on through them", () => {
    const policy = linkingPolicyFromAuthConfig({
      providers: { google: { enabled: true } },
    });
    const row = policy.policyFor("google");
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.provisioning)).toBe(true);
    expect(() => {
      (row as { enabled: boolean }).enabled = false;
    }).toThrow();
  });
});
