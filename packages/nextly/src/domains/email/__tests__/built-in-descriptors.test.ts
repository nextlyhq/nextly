/**
 * The descriptors the built-in providers publish, pinned field by field.
 *
 * A descriptor is a contract with a form that is compiled separately and reads
 * it at runtime, so nothing in TypeScript connects the two: renaming a field
 * here drops it from the admin with no build error and no failing test
 * elsewhere. That is what this pins.
 *
 * The `secret` flags are pinned for a sharper reason. A rename produces a
 * visibly broken form; a credential losing its flag produces a form that works
 * perfectly while the descriptor endpoint and the provider read path stop
 * withholding the value. This file is the guard for that.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertConfigFieldsAreUsable,
  defineEmailProvider,
  toDescriptor,
  type RegisteredEmailProvider,
} from "../provider-definition";
import { getEmailProviderRegistry } from "../services/email-provider-registry";
import {
  BUILT_IN_EMAIL_PROVIDERS,
  resendDefinition,
  sendLayerDefinition,
  smtpDefinition,
} from "../services/providers/built-in-definitions";

/** Field name → whether it is a credential, for one provider. */
function secrecyByField(
  provider: (typeof BUILT_IN_EMAIL_PROVIDERS)[number]
): Record<string, boolean> {
  return Object.fromEntries(
    toDescriptor(provider).configFields.map(field => [
      field.name,
      field.secret === true,
    ])
  );
}

describe("built-in provider descriptors", () => {
  it("publishes exactly the three built-ins", () => {
    expect(BUILT_IN_EMAIL_PROVIDERS.map(provider => provider.type)).toEqual([
      "smtp",
      "resend",
      "sendlayer",
    ]);
  });

  it("pins SMTP's fields and which of them are credentials", () => {
    expect(secrecyByField(smtpDefinition)).toEqual({
      host: false,
      port: false,
      secure: false,
      // Dotted: a PATH into the stored configuration, not a key. The admin
      // nests on it and the service masks on it, so shortening it to `pass`
      // would break both at once.
      "auth.user": false,
      "auth.pass": true,
    });
  });

  it("pins Resend's fields and which of them are credentials", () => {
    expect(secrecyByField(resendDefinition)).toEqual({ apiKey: true });
  });

  it("pins SendLayer's fields and which of them are credentials", () => {
    expect(secrecyByField(sendLayerDefinition)).toEqual({ apiKey: true });
  });

  it("marks every password-kind field as secret", () => {
    // The two are separable on purpose -- a masked input is not necessarily a
    // stored credential -- but no built-in has a reason to be one without the
    // other, and an unflagged password field would be served in the clear.
    for (const provider of BUILT_IN_EMAIL_PROVIDERS) {
      for (const field of toDescriptor(provider).configFields) {
        if (field.kind === "password") {
          expect({
            type: provider.type,
            name: field.name,
            secret: field.secret,
          }).toEqual({ type: provider.type, name: field.name, secret: true });
        }
      }
    }
  });

  it("never publishes a value for a credential", () => {
    for (const provider of BUILT_IN_EMAIL_PROVIDERS) {
      for (const field of toDescriptor(provider).configFields) {
        if (field.secret === true) {
          expect(field.default).toBeUndefined();
        }
      }
    }
  });

  it("declares a verified-sender requirement rather than implying it", () => {
    // The admin warns about this, and it used to infer it from `docsUrl` being
    // present -- true of the built-ins by coincidence and of nothing in
    // general, so a provider documenting itself elsewhere lost the warning and
    // could be saved with a sender it can never send from.
    expect(
      toDescriptor(resendDefinition).capabilities.requiresVerifiedSender
    ).toBe(true);
    expect(
      toDescriptor(sendLayerDefinition).capabilities.requiresVerifiedSender
    ).toBe(true);
    // The negative control. A relay the operator runs accepts whatever sender
    // it is configured to accept, so asserting the flag on all three would
    // pass without the distinction meaning anything.
    expect(
      toDescriptor(smtpDefinition).capabilities.requiresVerifiedSender
    ).toBeUndefined();
  });

  it("advertises a connection test only where a probe exists", () => {
    // SMTP can open a session and authenticate; a REST provider cannot check
    // anything short of sending, so offering the button would be a lie.
    expect(toDescriptor(smtpDefinition).capabilities.connectionTest).toBe(true);
    expect(toDescriptor(resendDefinition).capabilities.connectionTest).toBe(
      false
    );
    expect(toDescriptor(sendLayerDefinition).capabilities.connectionTest).toBe(
      false
    );
  });

  it("keeps every declared field renderable by the admin", () => {
    // The admin renders one control per `kind` from a closed union. A kind
    // outside it renders as nothing at all, which is invisible in every test
    // that only checks the field list.
    const renderable = ["text", "password", "number", "boolean", "select"];
    for (const provider of BUILT_IN_EMAIL_PROVIDERS) {
      for (const field of toDescriptor(provider).configFields) {
        expect(renderable).toContain(field.kind);
      }
    }
  });
});

describe("descriptor constraints are honoured by the parser", () => {
  it("refuses the values its own bounds exclude", () => {
    // The form validates from `constraints` and the server validates in
    // `parseConfig`. They are two statements of one rule, so the bound the
    // descriptor advertises has to be a bound the parser actually enforces --
    // otherwise the form blocks input the server would have accepted, or
    // accepts input the server refuses, and neither failure names its cause.
    const port = toDescriptor(smtpDefinition).configFields.find(
      field => field.name === "port"
    );
    expect(port?.constraints).toEqual({ min: 1, max: 65535 });

    const config = {
      host: "smtp.example.com",
      secure: true,
      auth: { user: "postmaster", pass: "secret" },
    };

    expect(() =>
      smtpDefinition.validateConfig({ ...config, port: 0 })
    ).toThrow();
    expect(() =>
      smtpDefinition.validateConfig({ ...config, port: 65536 })
    ).toThrow();
    expect(() =>
      smtpDefinition.validateConfig({ ...config, port: 465 })
    ).not.toThrow();
  });
});

describe("a credential can only be declared on a control that can hold one", () => {
  // A secret is masked on read, so the value a client holds for it is a string
  // standing in for the stored one. A switch has nowhere to put that, a select
  // would have to list it as an option, and a number input rejects it. Refused
  // where the definition is written, so the failure names the plugin at boot
  // instead of appearing as a form nobody can submit.
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it.each(["boolean", "number", "select"] as const)(
    "refuses a secret %s field",
    kind => {
      expect(() =>
        defineEmailProvider({
          ...base,
          configFields: [
            { name: "credential", label: "Credential", kind, secret: true },
          ],
        })
      ).toThrow(/can only be declared on a text or password field/);
    }
  );

  it.each(["text", "password"] as const)("accepts a secret %s field", kind => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "credential", label: "Credential", kind, secret: true },
        ],
      })
    ).not.toThrow();
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses a field name whose path reaches %s",
    segment => {
      // A field name is a PATH that clients walk to read and write a value.
      // These reach the object prototype instead, and a client building a form
      // from the descriptor would corrupt every plain object it holds just by
      // rendering it.
      expect(() =>
        defineEmailProvider({
          ...base,
          configFields: [
            { name: `${segment}.polluted`, label: "X", kind: "text" },
          ],
        })
      ).toThrow(/cannot be used/);
    }
  );

  it("refuses a field name with an empty path segment", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [{ name: "a..b", label: "X", kind: "text" }],
      })
    ).toThrow(/cannot be used/);
  });

  it("accepts an ordinary dotted path", () => {
    // The control for the rule's scope: nesting itself is the supported case,
    // and SMTP's own credentials depend on it.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [{ name: "auth.pass", label: "X", kind: "password" }],
      })
    ).not.toThrow();
  });

  it("leaves a non-secret field of any kind alone", () => {
    // The positive control for the rule's scope: it is `secret` that is
    // restricted, not the kinds themselves.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "sandbox", label: "Sandbox", kind: "boolean" },
          { name: "retries", label: "Retries", kind: "number" },
          { name: "region", label: "Region", kind: "select", options: [] },
        ],
      })
    ).not.toThrow();
  });
});

describe("the field rules hold at the registry boundary too", () => {
  // `RegisteredEmailProvider` is structural, so a JavaScript plugin or a
  // hand-built object registers without passing through `defineEmailProvider`.
  // Checking only in the authoring helper would enforce the rules for the
  // authors least likely to break them.
  const registered = (
    configFields: Parameters<typeof assertConfigFieldsAreUsable>[1]
  ): RegisteredEmailProvider => ({
    type: "hand-built",
    label: "Hand Built",
    configFields,
    validateConfig: () => {},
    createAdapterFrom: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
    hasConnectionTest: false,
  });

  let registry: ReturnType<typeof getEmailProviderRegistry>;

  beforeEach(() => {
    registry = getEmailProviderRegistry();
    registry.reset();
  });

  afterEach(() => {
    registry.reset();
  });

  it("refuses a secret declared on a switch", () => {
    expect(() =>
      registry.register(
        registered([
          { name: "flag", label: "Flag", kind: "boolean", secret: true },
        ])
      )
    ).toThrow(/text or password field/);
  });

  it("refuses a path that reaches an object prototype", () => {
    expect(() =>
      registry.register(
        registered([{ name: "__proto__.x", label: "X", kind: "text" }])
      )
    ).toThrow(/cannot be used/);
  });

  it("accepts an ordinary hand-built provider", () => {
    // The control that keeps the guard from rejecting the legitimate case it
    // exists to let through.
    expect(() =>
      registry.register(
        registered([
          {
            name: "auth.pass",
            label: "Password",
            kind: "password",
            secret: true,
          },
        ])
      )
    ).not.toThrow();
  });
});

describe("a default a control cannot hold", () => {
  const base = {
    type: "defaults",
    label: "Defaults",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it.each([
    ["select", true],
    ["number", "3"],
    ["text", 3],
    ["boolean", "yes"],
  ] as const)("refuses a %s field defaulting to %p", (kind, value) => {
    // A select defaulting to `true` renders as unselected and then fails its
    // own generated string schema before anyone touches it; a number
    // defaulting to "3" renders blank and submits a string. Both fail far from
    // the declaration that caused them.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "field", label: "Field", kind, default: value, options: [] },
        ],
      })
    ).toThrow(/can only default to/);
  });

  it.each([
    ["select", "eu"],
    ["number", 3],
    ["text", "hello"],
    ["boolean", false],
  ] as const)("accepts a %s field defaulting to %p", (kind, value) => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "field", label: "Field", kind, default: value, options: [] },
        ],
      })
    ).not.toThrow();
  });
});

describe("two fields claiming one place in the configuration", () => {
  const base = {
    type: "overlap",
    label: "Overlap",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it.each([
    [["auth", "auth.pass"]],
    [["auth.pass", "auth"]],
    [["auth.pass", "auth.pass"]],
  ])("refuses %p in either declaration order", names => {
    // Neither order works: one makes `auth` an object where a string is
    // expected, the other drops the nested schema while both controls still
    // render and compete for the same path.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: names.map(name => ({
          name,
          label: name,
          kind: "text" as const,
        })),
      })
    ).toThrow(/same place in the stored configuration/);
  });

  it("accepts siblings under one branch", () => {
    // The control: nesting is the supported case, and SMTP depends on it.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "auth.user", label: "User", kind: "text" },
          { name: "auth.pass", label: "Pass", kind: "password" },
        ],
      })
    ).not.toThrow();
  });
});
