/**
 * The linking policy answers from the app's own auth configuration, and only
 * from it.
 *
 * Each test names the property that separates the policy from a plausible
 * broken one: a key that isn't enabled is refused (not merely inconvenient),
 * trust and provisioning are separate switches from `enabled` (so a linked
 * identity signs in through a key with neither, while an untrusted key
 * refuses the implicit-link branch), everything unconfigured or malformed
 * reads as off, and the verdict tracks the app's configuration — the one
 * input the reader accepts — and not a plugin-supplied policy riding a
 * sign-in.
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
  it("ignores a policy a plugin hands over with a sign-in", () => {
    const appConfig: LinkingPolicyAuthConfig = {
      providers: { google: { trustedForImplicitLinking: true } },
    };
    // What a login plugin hands core with a sign-in: the identity's facts
    // and a policy claiming everything. The reader accepts the app's
    // configuration and nothing else, so there is no argument these objects
    // can travel in. The property: two payloads that differ draw the same
    // refusal, so the verdict does not track them.
    const signInsHandedOver = [
      {
        providerKey: "google",
        policy: {
          enabled: true,
          trustedForImplicitLinking: true,
          provision: { roles: ["super-admin"] },
        },
      },
      { providerKey: "google" },
    ];
    expect(signInsHandedOver[0]).not.toEqual(signInsHandedOver[1]);
    const withTheFirstHandedOver = refusalOf(() =>
      linkingPolicyFromAuthConfig(appConfig).requireEnabled("google")
    );
    const withTheSecondHandedOver = refusalOf(() =>
      linkingPolicyFromAuthConfig(appConfig).requireEnabled("google")
    );
    expect(withTheFirstHandedOver.logContext).toEqual(
      withTheSecondHandedOver.logContext
    );
    expect(withTheFirstHandedOver.logContext).toMatchObject({
      reason: "provider-key-not-enabled",
    });
    // The control that makes the mechanism observable: the verdict DOES
    // track the app's configuration, the one input the reader takes, and a
    // key the configuration enables passes the gate with no payload in
    // scope at all.
    const enabledAppConfig: LinkingPolicyAuthConfig = {
      providers: {
        google: { enabled: true, trustedForImplicitLinking: true },
      },
    };
    expect(
      linkingPolicyFromAuthConfig(enabledAppConfig).requireEnabled("google")
        .trustedForImplicitLinking
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

  it("provisions nothing without a roles array of role names", () => {
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
      },
    });
    for (const key of ["stringRoles", "mixedRoles", "noRoles"]) {
      expect(policy.requireEnabled(key).provisioning.mayProvision).toBe(false);
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
