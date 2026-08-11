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

import type { EmailProviderConfigField } from "../provider-definition";
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
            {
              name: "credential",
              label: "Credential",
              kind,
              secret: true,
              // A real option, so a secret SELECT is refused for being secret
              // rather than for having nothing to choose from -- otherwise the
              // test passes on a rule it is not about.
              options: [{ value: "one", label: "One" }],
              // And a default, for the same reason one kind further along: a
              // boolean without one is refused by the rule about switches
              // having two positions, which is not the rule under test.
              ...(kind === "boolean" ? { default: false } : {}),
            },
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
          {
            name: "credential",
            label: "Credential",
            kind,
            secret: true,
            // A real option, so a secret SELECT is refused for being secret
            // rather than for having nothing to choose from -- otherwise the
            // test passes on a rule it is not about.
            options: [{ value: "one", label: "One" }],
          },
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
          {
            name: "sandbox",
            label: "Sandbox",
            kind: "boolean",
            default: false,
          },
          { name: "retries", label: "Retries", kind: "number" },
          {
            name: "region",
            label: "Region",
            kind: "select",
            options: [{ value: "eu", label: "Europe" }],
          },
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
          // Defaulted, because a boolean without one is refused by a
          // different rule — and this case is about the SECRET flag, so it
          // has to reach that check rather than stopping short of it.
          {
            name: "flag",
            label: "Flag",
            kind: "boolean",
            default: false,
            secret: true,
          },
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
          {
            name: "field",
            label: "Field",
            kind,
            default: value,
            options: [{ value: "eu", label: "Europe" }],
          },
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
          {
            name: "field",
            label: "Field",
            kind,
            default: value,
            options: [{ value: "eu", label: "Europe" }],
          },
        ],
      })
    ).not.toThrow();
  });
});

describe("a select nobody can choose from", () => {
  const base = {
    type: "picker",
    label: "Picker",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it("refuses a select with no options", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "region", label: "Region", kind: "select", options: [] },
        ],
      })
    ).toThrow(/at least one choice/);
  });

  it("refuses an option whose value is empty", () => {
    // The admin's select reserves "" for "nothing selected" and throws on an
    // item carrying it, so this reaches an error boundary on render rather
    // than failing validation.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "region",
            label: "Region",
            kind: "select",
            options: [
              { value: "", label: "Any" },
              { value: "eu", label: "Europe" },
            ],
          },
        ],
      })
    ).toThrow(/cannot also be a choice/);
  });

  it("accepts an ordinary option list", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "region",
            label: "Region",
            kind: "select",
            options: [{ value: "eu", label: "Europe" }],
          },
        ],
      })
    ).not.toThrow();
  });
});

describe("declarations that would break the form outright", () => {
  const base = {
    type: "breaker",
    label: "Breaker",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it("refuses a kind no form can render", () => {
    // The admin switches over the five kinds exhaustively, which is a
    // COMPILE-time guarantee and none at all about a JavaScript plugin. An
    // unknown kind falls off the end of that switch, the field gets no schema,
    // and building the form recurses into undefined — so one bad field takes
    // down the whole provider form rather than being skipped.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "when", label: "When", kind: "date" as unknown as "text" },
        ],
      })
    ).toThrow(/no form can render/);
  });

  it("refuses a numeric path segment", () => {
    // `servers.0.host` registers as `{ servers: [{ host }] }` in the form and
    // is validated and sent as `{ servers: { "0": { host } } }`.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [{ name: "servers.0.host", label: "H", kind: "text" }],
      })
    ).toThrow(/is a number/);
  });

  it.each([0, -1])("refuses a maximum length of %i", maxLength => {
    // A field that can hold at most zero characters is not a field: required,
    // it rejects the empty string AND every non-empty one.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "k",
            label: "K",
            kind: "text",
            required: true,
            constraints: { maxLength },
          },
        ],
      })
    ).toThrow(/No value can satisfy that/);
  });

  it("accepts a length of one, and a segment that merely contains a digit", () => {
    // The controls that keep both rules at "impossible" and "numeric SEGMENT"
    // rather than "short" and "contains a digit".
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "pin",
            label: "PIN",
            kind: "text",
            constraints: { maxLength: 1 },
          },
          { name: "oauth2.token", label: "T", kind: "text" },
          { name: "server1.host", label: "H", kind: "text" },
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

describe("declarations a form could never satisfy", () => {
  const base = {
    type: "unsatisfiable",
    label: "Unsatisfiable",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it("refuses a select default that is not one of its options", () => {
    // It renders as nothing selected and then fails the schema generated from
    // the same option list, so the field arrives invalid and the provider
    // cannot be saved until someone changes a value they never chose.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "region",
            label: "Region",
            kind: "select",
            default: "us",
            options: [{ value: "eu", label: "Europe" }],
          },
        ],
      })
    ).toThrow(/not one of its options/);
  });

  it("accepts a select default that IS one of its options", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "region",
            label: "Region",
            kind: "select",
            default: "eu",
            options: [{ value: "eu", label: "Europe" }],
          },
        ],
      })
    ).not.toThrow();
  });

  it("refuses a numeric range no value satisfies", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "retries",
            label: "Retries",
            kind: "number",
            constraints: { min: 10, max: 5 },
          },
        ],
      })
    ).toThrow(/No value can satisfy both/);
  });

  it("accepts a range with one value in it", () => {
    // The control keeps the rule at "impossible", not "narrow": min === max is
    // a legitimate way to pin a value.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "retries",
            label: "Retries",
            kind: "number",
            constraints: { min: 5, max: 5 },
          },
        ],
      })
    ).not.toThrow();
  });

  it.each(["headers[x-api-key]", 'quoted"name', "single'quote"])(
    "refuses the field name %p, which a form library reparses",
    name => {
      // Measured, not assumed: react-hook-form's `set` writes
      // `{ headers: { "x-api-key": v } }` for the first of these, while the
      // generated schema and the payload helpers split on dots alone and
      // expect `{ "headers[x-api-key]": v }`. Two different places in the
      // configuration, and nothing reports the disagreement.
      expect(() =>
        defineEmailProvider({
          ...base,
          configFields: [{ name, label: "X", kind: "text" }],
        })
      ).toThrow(/brackets or quotes/);
    }
  );

  it("accepts a dotted name with hyphens and underscores", () => {
    // The control: the rule is about characters a form reads as STRUCTURE, not
    // about unusual names in general.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "headers.x-api-key", label: "X", kind: "text" },
          { name: "auth.access_token", label: "Y", kind: "text" },
        ],
      })
    ).not.toThrow();
  });
});

describe("a descriptor that would open the form already broken", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it("refuses a numeric default outside its own bounds", () => {
    // The form initialises from the default and validates against the same
    // constraints, so this opens invalid and cannot be submitted without
    // changing a value nobody chose.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "retries",
            label: "Retries",
            kind: "number",
            default: 10,
            constraints: { max: 5 },
          },
        ],
      })
    ).toThrow(/above its maximum of 5/);
  });

  it("refuses a text default longer than its own maxLength", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "tag",
            label: "Tag",
            kind: "text",
            default: "much too long",
            constraints: { maxLength: 4 },
          },
        ],
      })
    ).toThrow(/longer than its maximum length of 4/);
  });

  it("accepts a default that its bounds allow", () => {
    // The control. Without it the two above would pass on a rule that had
    // started rejecting every default.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "retries",
            label: "Retries",
            kind: "number",
            default: 3,
            constraints: { min: 1, max: 5 },
          },
        ],
      })
    ).not.toThrow();
  });

  it("refuses a boolean with no default", () => {
    // A switch has two positions. Without a declared default an absent stored
    // key renders as off and every save writes `false`, overwriting a provider
    // default nobody changed — and no clearing path can help, because a switch
    // cannot be emptied back to absence.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [{ name: "sandbox", label: "Sandbox", kind: "boolean" }],
      })
    ).toThrow(/A switch has two positions/);
  });

  it("accepts a boolean that declares one", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "sandbox",
            label: "Sandbox",
            kind: "boolean",
            default: false,
          },
        ],
      })
    ).not.toThrow();
  });
});

describe("a declaration the form could not carry out", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it("refuses a default on a credential", () => {
    // `toDescriptor` withholds it, correctly — the descriptor is served to any
    // caller who can read providers — and nothing applies descriptor defaults
    // on the server. It is inert in both directions while reading to its
    // author like a working fallback.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "password",
            secret: true,
            default: "from-the-environment",
          },
        ],
      })
    ).toThrow(/parseConfig/);
  });

  it("refuses blankAs empty on a number", () => {
    // A blank number normalises to absent long before the payload is built, so
    // the empty string it promises to send never exists.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "retries",
            label: "Retries",
            kind: "number",
            blankAs: "empty",
          },
        ],
      })
    ).toThrow(/blankAs/);
  });

  it("accepts blankAs empty on a text field", () => {
    // The control: the built-in SMTP credentials rely on this, so a rule that
    // rejected every `blankAs` would break the documented Mailpit setup.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "auth.user", label: "User", kind: "text", blankAs: "empty" },
        ],
      })
    ).not.toThrow();
  });
});

describe("a boolean field that is required", () => {
  it("registers without a default", () => {
    // The absence ambiguity is an OPTIONAL boolean's problem: it has three
    // states and a switch has two. A required one has no absence to represent
    // — the form initialises to `false`, the schema accepts it, and both
    // positions are a value the provider asked for.
    expect(() =>
      defineEmailProvider({
        type: "fixture",
        label: "Fixture",
        parseConfig: (input: unknown) => input as Record<string, unknown>,
        createAdapter: () => ({
          send: () => Promise.resolve({ success: true, messageId: "x" }),
        }),
        configFields: [
          { name: "agree", label: "Agree", kind: "boolean", required: true },
        ],
      })
    ).not.toThrow();
  });
});

describe("select options a plugin got wrong", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  /**
   * Written through a cast because these shapes are what a JAVASCRIPT plugin
   * or a hand-built object supplies — `configFields` is structural, so the
   * compiler is not what stands between them and the registry.
   */
  function withOptions(options: unknown) {
    return () =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "region",
            label: "Region",
            kind: "select",
            options,
          } as unknown as EmailProviderConfigField,
        ],
      });
  }

  it("refuses options that are not an array", () => {
    // Previously crashed registration with `options.some is not a function`,
    // which names neither the plugin nor the field.
    expect(withOptions({ eu: "Europe" })).toThrow(/not an array/);
  });

  it("refuses an option whose value is not a string", () => {
    // Accepted silently before: the control renders strings and the generated
    // schema validates strings, so the stored number matches no option and the
    // selection cannot be retained.
    expect(withOptions([{ value: 1, label: "One" }])).toThrow(/index 0/);
  });

  it("refuses an option with no label", () => {
    expect(withOptions([{ value: "eu" }])).toThrow(/index 0/);
  });

  it("accepts a well-formed option list", () => {
    // The control: the rule must not reject the shape every real provider uses.
    expect(withOptions([{ value: "eu", label: "Europe" }])).not.toThrow();
  });
});

describe("a flag whose type is wrong", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  it("refuses a stringy secret", () => {
    // The dangerous case, because it LOOKS right. Every rule tests
    // `secret === true`, so `"true"` reads as unset: the field is treated as
    // public and `maskConfiguration` serves the credential in the clear.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "password",
            secret: "true",
          } as unknown as EmailProviderConfigField,
        ],
      })
    ).toThrow(/non-boolean `secret`/);
  });

  it("refuses a stringy required", () => {
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "host",
            label: "Host",
            kind: "text",
            required: "yes",
          } as unknown as EmailProviderConfigField,
        ],
      })
    ).toThrow(/non-boolean `required`/);
  });

  it("accepts real booleans and omitted flags", () => {
    // The control: the rule must not reject the shape every real provider uses.
    expect(() =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "host", label: "Host", kind: "text", required: true },
          { name: "apiKey", label: "Key", kind: "password", secret: true },
          { name: "note", label: "Note", kind: "text" },
        ],
      })
    ).not.toThrow();
  });
});

describe("descriptor text that is not text", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  /**
   * Written through a cast for the same reason the option-shape fixtures are:
   * these values arrive from a JavaScript plugin or a hand-built object, so
   * the compiler is not what stands between them and the admin.
   */
  function withField(field: Record<string, unknown>) {
    return () =>
      defineEmailProvider({
        ...base,
        configFields: [field as unknown as EmailProviderConfigField],
      });
  }

  it("refuses a non-string help message", () => {
    // The admin renders `help` as a child (`description={field.help}`), where
    // an object throws and takes the whole settings page with it.
    expect(
      withField({ name: "apiKey", label: "API Key", kind: "text", help: {} })
    ).toThrow(/non-string `help`/);
  });

  it("refuses a non-string label", () => {
    // `field.label.toLowerCase()` builds the select's validation message, so a
    // non-string label fails while the form is being validated rather than at
    // the boundary that published it.
    expect(withField({ name: "apiKey", label: 42, kind: "text" })).toThrow(
      /non-string `label`/
    );
  });

  it("refuses a non-string placeholder", () => {
    expect(
      withField({
        name: "apiKey",
        label: "API Key",
        kind: "text",
        placeholder: ["a"],
      })
    ).toThrow(/non-string `placeholder`/);
  });

  it("refuses a non-string field name", () => {
    // Every other rule interpolates the name to say WHICH field it means, and
    // the walkability rule splits it. Identity is checked before all of them.
    expect(withField({ name: 7, label: "Seven", kind: "text" })).toThrow(
      /non-string `name`/
    );
  });

  it("refuses a blank label", () => {
    // Renders an unlabelled control whose own validation messages then read
    // " is required".
    expect(withField({ name: "apiKey", label: "   ", kind: "text" })).toThrow(
      /empty `label`/
    );
  });

  it("refuses non-string text on the provider itself", () => {
    // `senderGuidance` is rendered as a child exactly as `help` is, so the
    // rule covers the provider's own strings and not only its fields'.
    expect(() =>
      defineEmailProvider({
        ...base,
        senderGuidance: { note: "verify a domain" },
        configFields: [],
      } as unknown as Parameters<typeof defineEmailProvider>[0])
    ).toThrow(/non-string `senderGuidance`/);
  });

  it("accepts the text every real provider writes", () => {
    // The control: strings, and omitted optional ones, must still pass.
    expect(() =>
      defineEmailProvider({
        ...base,
        description: "A fixture",
        senderGuidance: "Verify your domain first.",
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "password",
            secret: true,
            help: "Found in the dashboard.",
            placeholder: "re_...",
          },
          { name: "note", label: "Note", kind: "text" },
        ],
      })
    ).not.toThrow();
  });
});

describe("descriptor text rules hold at the registry boundary too", () => {
  let registry: ReturnType<typeof getEmailProviderRegistry>;

  beforeEach(() => {
    registry = getEmailProviderRegistry();
    registry.reset();
  });

  afterEach(() => {
    registry.reset();
  });

  it("refuses a non-string help message on a hand-built provider", () => {
    expect(() =>
      registry.register({
        type: "hand-built",
        label: "Hand Built",
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "text",
            help: {},
          } as unknown as EmailProviderConfigField,
        ],
        validateConfig: () => {},
        createAdapterFrom: () => ({
          send: () => Promise.resolve({ success: true, messageId: "x" }),
        }),
        hasConnectionTest: false,
      })
    ).toThrow(/non-string `help`/);
  });

  it("refuses a non-string label on the provider itself", () => {
    expect(() =>
      registry.register({
        type: "hand-built",
        label: 42,
        configFields: [],
        validateConfig: () => {},
        createAdapterFrom: () => ({
          send: () => Promise.resolve({ success: true, messageId: "x" }),
        }),
        hasConnectionTest: false,
      } as unknown as RegisteredEmailProvider)
    ).toThrow(/non-string `label`/);
  });
});

describe("a character limit on a control that never applies one", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  function withField(field: EmailProviderConfigField) {
    return () => defineEmailProvider({ ...base, configFields: [field] });
  }

  it("refuses maxLength on a select", () => {
    // The generated form applies `maxLength` to text and password fields
    // alone, so this one is published to every client and enforced by none.
    expect(
      withField({
        name: "region",
        label: "Region",
        kind: "select",
        options: [{ value: "eu", label: "Europe" }],
        constraints: { maxLength: 2 },
      })
    ).toThrow(/only applied to a text or password field/);
  });

  it("refuses maxLength on a number", () => {
    expect(
      withField({
        name: "port",
        label: "Port",
        kind: "number",
        constraints: { maxLength: 5 },
      })
    ).toThrow(/only applied to a text or password field/);
  });

  it("refuses maxLength on a boolean", () => {
    expect(
      withField({
        name: "secure",
        label: "Secure",
        kind: "boolean",
        default: false,
        constraints: { maxLength: 1 },
      })
    ).toThrow(/only applied to a text or password field/);
  });

  it("reports the kind before the length when both are wrong", () => {
    // A zero-length select is refused by two rules. The one that names the
    // control sends the author to the key to remove; the other sends them to
    // argue with the number.
    expect(
      withField({
        name: "region",
        label: "Region",
        kind: "select",
        options: [{ value: "eu", label: "Europe" }],
        constraints: { maxLength: 0 },
      })
    ).toThrow(/only applied to a text or password field/);
  });

  it("accepts maxLength where it is honoured", () => {
    // The control: the rule must not reject the case the constraint exists for.
    expect(
      withField({
        name: "apiKey",
        label: "API Key",
        kind: "password",
        secret: true,
        constraints: { maxLength: 64 },
      })
    ).not.toThrow();
    expect(
      withField({
        name: "host",
        label: "Host",
        kind: "text",
        constraints: { maxLength: 255 },
      })
    ).not.toThrow();
  });

  it("leaves the other constraints alone on a number", () => {
    expect(
      withField({
        name: "port",
        label: "Port",
        kind: "number",
        constraints: { min: 1, max: 65535 },
      })
    ).not.toThrow();
  });
});

describe("a descriptor that would open the create form invalid", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  function withField(field: EmailProviderConfigField) {
    return () => defineEmailProvider({ ...base, configFields: [field] });
  }

  it("refuses a blank default on a required field", () => {
    // The blank has the right type and violates no maximum, so every bound
    // check passes it — while the generated schema reports an empty required
    // field as missing and refuses to submit.
    expect(
      withField({
        name: "host",
        label: "Host",
        kind: "text",
        required: true,
        default: "",
      })
    ).toThrow(/blank default/);
  });

  it("refuses a whitespace-only default on a required field", () => {
    expect(
      withField({
        name: "host",
        label: "Host",
        kind: "text",
        required: true,
        default: "   ",
      })
    ).toThrow(/blank default/);
  });

  it("accepts a blank default on an optional field", () => {
    // The control. An optional field may legitimately start empty.
    expect(
      withField({ name: "note", label: "Note", kind: "text", default: "" })
    ).not.toThrow();
  });

  it("accepts zero as a required number's default", () => {
    // The second control: zero is a real value, not a blank, and a rule
    // written on falsiness rather than on emptiness would reject it.
    expect(
      withField({
        name: "retries",
        label: "Retries",
        kind: "number",
        required: true,
        default: 0,
      })
    ).not.toThrow();
  });
});

describe("a numeric bound on a control that never applies one", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  function withField(field: EmailProviderConfigField) {
    return () => defineEmailProvider({ ...base, configFields: [field] });
  }

  it("refuses min on a text field", () => {
    // The form applies `min`/`max` in its number branch alone, so this is
    // published to every descriptor reader and enforced by nothing — and if
    // the provider's own parser enforces it, the operator learns only after
    // submitting.
    expect(
      withField({
        name: "host",
        label: "Host",
        kind: "text",
        constraints: { min: 3 },
      })
    ).toThrow(/only applied to a number field/);
  });

  it("refuses max on a select field", () => {
    expect(
      withField({
        name: "region",
        label: "Region",
        kind: "select",
        options: [{ value: "eu", label: "Europe" }],
        constraints: { max: 3 },
      })
    ).toThrow(/only applied to a number field/);
  });

  it("refuses min on a boolean field", () => {
    expect(
      withField({
        name: "secure",
        label: "Secure",
        kind: "boolean",
        default: false,
        constraints: { min: 0 },
      })
    ).toThrow(/only applied to a number field/);
  });

  it("still accepts bounds where the form applies them", () => {
    // The control, both ways round: a number keeps min/max, and text keeps
    // maxLength.
    expect(
      withField({
        name: "port",
        label: "Port",
        kind: "number",
        constraints: { min: 1, max: 65535 },
      })
    ).not.toThrow();
    expect(
      withField({
        name: "host",
        label: "Host",
        kind: "text",
        constraints: { maxLength: 255 },
      })
    ).not.toThrow();
  });
});

describe("a configFields that is not a list of fields", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  /** The shapes a JavaScript plugin can hand a structural type. */
  function withFields(configFields: unknown) {
    return () =>
      defineEmailProvider({
        ...base,
        configFields: configFields as EmailProviderConfigField[],
      });
  }

  it("refuses null", () => {
    // Previously `fields is not iterable`, thrown at boot, naming neither the
    // provider nor what was wrong with it.
    expect(withFields(null)).toThrow(/has to be an array/);
  });

  it("refuses a non-array object", () => {
    expect(withFields({ host: {} })).toThrow(/has to be an array/);
  });

  it("refuses an entry that is not an object", () => {
    // Previously `Cannot read properties of null (reading 'name')`.
    expect(withFields([null])).toThrow(/index 0/);
    expect(
      withFields([{ name: "a", label: "A", kind: "text" }, "host"])
    ).toThrow(/index 1/);
  });

  it("accepts an empty list and an ordinary one", () => {
    // The control. A provider with no configuration at all is legitimate, and
    // an empty array must not be confused with a missing one.
    expect(withFields([])).not.toThrow();
    expect(
      withFields([{ name: "host", label: "Host", kind: "text" }])
    ).not.toThrow();
  });
});

describe("a blankAs the descriptor spelled wrong", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  function withBlankAs(blankAs: unknown) {
    return () =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "note",
            label: "Note",
            kind: "text",
            blankAs,
          } as unknown as EmailProviderConfigField,
        ],
      });
  }

  it("refuses a typo rather than reading it as the default", () => {
    // Only `"empty"` was tested for, so `"emty"` was silently treated as
    // `"omit"` — and for a field whose parser demands the key exist, every
    // blank create is then stripped and rejected by the server instead of the
    // descriptor being named at boot.
    expect(withBlankAs("emty")).toThrow(/must be "omit" or "empty"/);
  });

  it("refuses a value of the wrong type", () => {
    expect(withBlankAs(true)).toThrow(/must be "omit" or "empty"/);
  });

  it("accepts both spellings, and its absence", () => {
    // The control: the two real values and the ordinary omitted case.
    expect(withBlankAs("omit")).not.toThrow();
    expect(withBlankAs("empty")).not.toThrow();
    expect(withBlankAs(undefined)).not.toThrow();
  });
});

describe("a capability whose value is not a boolean", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
    configFields: [],
  };

  function withCapabilities(capabilities: unknown) {
    return () =>
      defineEmailProvider({
        ...base,
        capabilities,
      } as unknown as Parameters<typeof defineEmailProvider>[0]);
  }

  it('refuses the string "false", which every reader takes for true', () => {
    // The dangerous case, because it looks like the author's intent. The admin
    // would tell an operator a verified sender is required by a provider whose
    // author wrote the opposite.
    expect(withCapabilities({ requiresVerifiedSender: "false" })).toThrow(
      /non-boolean value/
    );
  });

  it("refuses a capabilities object that is not an object", () => {
    expect(withCapabilities("all")).toThrow(/not an object/);
  });

  it("accepts real booleans, and no capabilities at all", () => {
    // The control: the shape every real provider writes must still register.
    expect(
      withCapabilities({ attachments: true, requiresVerifiedSender: false })
    ).not.toThrow();
    expect(withCapabilities(undefined)).not.toThrow();
  });
});

describe("what a descriptor publishes about a field", () => {
  it("carries only the properties a descriptor declares", () => {
    // `EmailProviderConfigField` is structural on a structural definition, so
    // a hand-built provider can hang anything off a field. Registration
    // ignores an undeclared property — which is exactly why nothing else would
    // notice it being served to every client holding read or create.
    const provider: RegisteredEmailProvider = {
      type: "hand-built",
      label: "Hand Built",
      configFields: [
        {
          name: "apiKey",
          label: "API Key",
          kind: "password",
          secret: true,
          // What a provider carrying its own operational state looks like.
          value: "sk-live-the-actual-credential",
          credentials: { user: "postmaster", pass: "hunter2" },
        } as unknown as EmailProviderConfigField,
      ],
      validateConfig: () => {},
      createAdapterFrom: () => ({
        send: () => Promise.resolve({ success: true, messageId: "x" }),
      }),
      hasConnectionTest: false,
    };

    const published = JSON.stringify(toDescriptor(provider));

    expect(published).not.toContain("sk-live-the-actual-credential");
    expect(published).not.toContain("hunter2");
    expect(published).not.toContain("credentials");
  });

  it("still describes the field completely", () => {
    // The control. Withholding is only correct if what remains is enough to
    // render and validate the field — a descriptor that drops `constraints` or
    // `options` breaks the form it exists to describe.
    const provider: RegisteredEmailProvider = {
      type: "hand-built",
      label: "Hand Built",
      configFields: [
        {
          name: "region",
          label: "Region",
          kind: "select",
          required: true,
          help: "Where to send from.",
          placeholder: "Pick one",
          options: [{ value: "eu", label: "Europe" }],
          constraints: { maxLength: 8 },
          blankAs: "empty",
        },
      ],
      validateConfig: () => {},
      createAdapterFrom: () => ({
        send: () => Promise.resolve({ success: true, messageId: "x" }),
      }),
      hasConnectionTest: false,
    };

    expect(toDescriptor(provider).configFields[0]).toEqual({
      name: "region",
      label: "Region",
      kind: "select",
      required: true,
      help: "Where to send from.",
      placeholder: "Pick one",
      options: [{ value: "eu", label: "Europe" }],
      constraints: { maxLength: 8 },
      blankAs: "empty",
    });
  });
});

describe("a select option nobody can read", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  function withOptions(options: Array<{ value: string; label: string }>) {
    return () =>
      defineEmailProvider({
        ...base,
        configFields: [
          { name: "region", label: "Region", kind: "select", options },
        ],
      });
  }

  it("refuses a blank label", () => {
    // The label is the only thing an operator sees in the menu, so a blank one
    // is a choice nobody can tell from its neighbours — and once picked, the
    // control shows nothing.
    expect(withOptions([{ value: "eu", label: "   " }])).toThrow(/blank label/);
  });

  it("accepts an ordinary label", () => {
    expect(withOptions([{ value: "eu", label: "Europe" }])).not.toThrow();
  });
});

describe("a constraints container that is not one", () => {
  const base = {
    type: "fixture",
    label: "Fixture",
    parseConfig: (input: unknown) => input as Record<string, unknown>,
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  };

  function withConstraints(constraints: unknown) {
    return () =>
      defineEmailProvider({
        ...base,
        configFields: [
          {
            name: "host",
            label: "Host",
            kind: "text",
            constraints,
          } as unknown as EmailProviderConfigField,
        ],
      });
  }

  it("refuses null, which every bound rule reads as absent", () => {
    // Optional chaining makes `null` invisible to `field.constraints?.min`, so
    // it passes every validator and fails at the descriptor build instead —
    // where a raw TypeError takes the catalog endpoint down and with it the
    // form for EVERY provider, not only this one.
    expect(withConstraints(null)).toThrow(/not an object/);
  });

  it("refuses a non-object", () => {
    expect(withConstraints("min:1")).toThrow(/not an object/);
  });

  it("accepts real bounds, and their absence", () => {
    expect(withConstraints({ maxLength: 10 })).not.toThrow();
    expect(withConstraints(undefined)).not.toThrow();
  });
});
