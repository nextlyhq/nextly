/**
 * The provider form's value handling, exercised against descriptors rather than
 * against provider names.
 *
 * The cases that matter are the ones a descriptor-driven form makes silent: a
 * dotted field name that assembles flat, and a credential the user never
 * touched being overwritten with the mask that stood in for it.
 */

import { describe, expect, it } from "vitest";

import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import {
  buildProviderSchema,
  defaultFormValues,
  emptyConfiguration,
  formValuesToPayload,
  isMaskedSecret,
  MASKED_SECRET,
  providerToFormValues,
  type ProviderFormValues,
} from "./emailProviderSchema";

/** A provider with a nested path, a bounded number and a real credential. */
const smtpDescriptor: EmailProviderDescriptor = {
  type: "smtp",
  label: "SMTP",
  capabilities: { connectionTest: true },
  configFields: [
    { name: "host", label: "SMTP Host", kind: "text", required: true },
    {
      name: "port",
      label: "SMTP Port",
      kind: "number",
      required: true,
      default: 587,
      constraints: { min: 1, max: 65535 },
    },
    { name: "secure", label: "Secure", kind: "boolean", default: false },
    { name: "auth.user", label: "Username", kind: "text", required: true },
    {
      name: "auth.pass",
      label: "Password",
      kind: "password",
      required: true,
      secret: true,
    },
  ],
};

/** A provider nobody compiled in: one select, one non-secret token field. */
const contributedDescriptor: EmailProviderDescriptor = {
  type: "acme-mail",
  label: "Acme Mail",
  capabilities: {},
  configFields: [
    {
      name: "region",
      label: "Region",
      kind: "select",
      required: true,
      options: [
        { value: "eu", label: "Europe" },
        { value: "us", label: "United States" },
      ],
    },
    // Named like a credential and deliberately NOT marked secret: the flag
    // decides, not the name.
    { name: "token", label: "Public Token", kind: "text" },
  ],
};

function record(
  overrides: Partial<EmailProviderRecord> = {}
): EmailProviderRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Primary",
    type: "smtp",
    fromEmail: "noreply@example.com",
    fromName: null,
    configuration: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "postmaster", pass: MASKED_SECRET },
    },
    isDefault: true,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("configuration assembly", () => {
  it("nests a dotted field name instead of storing the path as a key", () => {
    const values = providerToFormValues(record(), smtpDescriptor);

    expect(values.configuration).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "postmaster", pass: MASKED_SECRET },
    });
    // Asserted over the literal key list: `toHaveProperty("auth.pass")`
    // resolves the dot as a path and would pass either way, certifying
    // nothing. The failure this guards against posts successfully and is
    // refused by the provider's own parser, against a path that reads as if it
    // were correct.
    expect(Object.keys(values.configuration)).toEqual([
      "host",
      "port",
      "secure",
      "auth",
    ]);
  });

  it("seeds a new provider from the descriptor's declared defaults", () => {
    expect(emptyConfiguration(smtpDescriptor)).toEqual({
      host: "",
      port: 587,
      secure: false,
      auth: { user: "", pass: "" },
    });
  });

  it("carries only the fields the descriptor declares", () => {
    const values = providerToFormValues(
      record({
        configuration: {
          host: "smtp.example.com",
          port: 25,
          leftover: "from an older version of this provider",
          auth: { user: "u", pass: MASKED_SECRET },
        },
      }),
      smtpDescriptor
    );

    expect(values.configuration).not.toHaveProperty("leftover");
  });

  it("renders a provider it was never compiled against", () => {
    const values = defaultFormValues(contributedDescriptor);

    expect(values.type).toBe("acme-mail");
    expect(values.configuration).toEqual({ region: "", token: "" });
  });
});

describe("untouched credentials", () => {
  it("drops the mask from the payload so the stored secret is kept", () => {
    const stored = record();
    const values = providerToFormValues(stored, smtpDescriptor);
    const payload = formValuesToPayload(
      values,
      smtpDescriptor,
      stored.configuration
    );

    // Absent, not empty: the server merges what it receives over the stored
    // configuration, so an omitted credential keeps its value while an empty
    // string would replace it.
    expect(payload.configuration).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "postmaster" },
    });
  });

  it("sends a credential the user actually typed", () => {
    const stored = record();
    const values = providerToFormValues(stored, smtpDescriptor);
    const edited: ProviderFormValues = {
      ...values,
      configuration: {
        ...values.configuration,
        auth: { user: "postmaster", pass: "a-new-password" },
      },
    };

    expect(
      formValuesToPayload(edited, smtpDescriptor, stored.configuration)
        .configuration
    ).toMatchObject({
      auth: { user: "postmaster", pass: "a-new-password" },
    });
  });

  it("sends a credential the user typed OUT OF MASK CHARACTERS", () => {
    // Nothing about a value's characters makes it a mask. Deciding by pattern
    // discarded a password like this one: the create failed as though the
    // field were blank, and the update reported success while keeping the old
    // secret. Deciding by comparison against what the server actually sent
    // cannot make that mistake.
    const stored = record();
    const values = providerToFormValues(stored, smtpDescriptor);
    const edited: ProviderFormValues = {
      ...values,
      configuration: {
        ...values.configuration,
        auth: { user: "postmaster", pass: "••••••••••••" },
      },
    };

    expect(
      formValuesToPayload(edited, smtpDescriptor, stored.configuration)
        .configuration
    ).toMatchObject({ auth: { pass: "••••••••••••" } });
  });

  it("keeps a NON-secret field whose value looks like a mask", () => {
    // `token` is not declared secret, so its value is nobody's business but
    // the provider's -- including when it happens to be a row of asterisks.
    const values: ProviderFormValues = {
      ...defaultFormValues(contributedDescriptor),
      configuration: { region: "eu", token: "***" },
    };

    expect(
      formValuesToPayload(values, contributedDescriptor, {
        region: "eu",
        token: "old",
      }).configuration
    ).toEqual({ region: "eu", token: "***" });
  });

  it("sends everything when creating, since nothing is stored to compare", () => {
    const values: ProviderFormValues = {
      ...defaultFormValues(smtpDescriptor),
      configuration: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "u", pass: "••••••••" },
      },
    };

    expect(
      formValuesToPayload(values, smtpDescriptor).configuration
    ).toMatchObject({ auth: { pass: "••••••••" } });
  });

  it("treats older asterisk masks as untouched too", () => {
    expect(isMaskedSecret("********")).toBe(true);
    expect(isMaskedSecret(MASKED_SECRET)).toBe(true);
    // The negative control: a real value that merely contains a bullet must
    // still be sent, or a legitimate password would be silently discarded.
    expect(isMaskedSecret("pa•ssword")).toBe(false);
    expect(isMaskedSecret("")).toBe(false);
  });
});

describe("validation derived from the descriptor", () => {
  const base = {
    name: "Primary",
    type: "smtp",
    fromEmail: "noreply@example.com",
    fromName: "",
    isDefault: false,
    isActive: true,
  };

  it("accepts a complete configuration", () => {
    const result = buildProviderSchema(smtpDescriptor).safeParse({
      ...base,
      configuration: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "postmaster", pass: "secret" },
      },
    });

    expect(result.success).toBe(true);
  });

  it("reports a required nested field at its own path", () => {
    const result = buildProviderSchema(smtpDescriptor).safeParse({
      ...base,
      configuration: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "", pass: "secret" },
      },
    });

    expect(result.success).toBe(false);
    // The path is what maps the message onto the rendered field. A correct
    // message at the wrong path is an error the user cannot find.
    expect(result.error?.issues.map(issue => issue.path.join("."))).toContain(
      "configuration.auth.user"
    );
  });

  it("accepts the mask as a required credential, since it means unchanged", () => {
    const result = buildProviderSchema(smtpDescriptor).safeParse({
      ...base,
      configuration: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "postmaster", pass: MASKED_SECRET },
      },
    });

    expect(result.success).toBe(true);
  });

  it("applies the descriptor's numeric bounds", () => {
    const schema = buildProviderSchema(smtpDescriptor);
    const configuration = {
      host: "smtp.example.com",
      secure: false,
      auth: { user: "postmaster", pass: "secret" },
    };

    expect(
      schema.safeParse({
        ...base,
        configuration: { ...configuration, port: 0 },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        configuration: { ...configuration, port: 65536 },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        configuration: { ...configuration, port: 465 },
      }).success
    ).toBe(true);
  });

  it("reports an emptied number as missing rather than as zero", () => {
    const result = buildProviderSchema(smtpDescriptor).safeParse({
      ...base,
      configuration: {
        host: "smtp.example.com",
        port: "",
        secure: false,
        auth: { user: "postmaster", pass: "secret" },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(issue => issue.message)).toContain(
      "SMTP Port is required"
    );
  });

  it("refuses a select value outside the declared options", () => {
    const schema = buildProviderSchema(contributedDescriptor);
    const values = { ...base, type: "acme-mail" };

    expect(
      schema.safeParse({
        ...values,
        configuration: { region: "antarctica", token: "" },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...values,
        configuration: { region: "eu", token: "" },
      }).success
    ).toBe(true);
  });

  it("leaves an unregistered provider's configuration unvalidated", () => {
    // The record survives its plugin being removed; the form shows it
    // read-only, so there is nothing to validate and nothing to report.
    const result = buildProviderSchema(undefined).safeParse({
      ...base,
      type: "gone-away",
      configuration: { anything: "at all" },
    });

    expect(result.success).toBe(true);
  });
});

describe("a field named like a credential", () => {
  it("is sent in full when the descriptor does not mark it secret", () => {
    const values: ProviderFormValues = {
      ...defaultFormValues(contributedDescriptor),
      configuration: { region: "eu", token: "public-token-value" },
    };

    // The case that proves metadata beat the key-name heuristic: `token` is
    // not a secret here, so it must survive the strip that removes masks.
    expect(
      formValuesToPayload(values, contributedDescriptor, {
        region: "eu",
        token: "previous",
      }).configuration
    ).toEqual({
      region: "eu",
      token: "public-token-value",
    });
  });
});

describe("a descriptor that is hostile or merely careless", () => {
  const withField = (
    field: EmailProviderDescriptor["configFields"][number]
  ): EmailProviderDescriptor => ({
    type: "evil",
    label: "Evil",
    capabilities: {},
    configFields: [field],
  });

  it.each(["__proto__.polluted", "constructor.prototype.polluted"])(
    "does not write through %s onto Object.prototype",
    name => {
      const descriptor = withField({ name, label: "X", kind: "text" });

      emptyConfiguration(descriptor);
      buildProviderSchema(descriptor);
      providerToFormValues(
        record({ type: "evil", configuration: {} }),
        descriptor
      );

      // Read off a FRESH plain object: a polluted prototype shows up on every
      // object in the admin, which is why merely opening the form is enough.
      const probe: Record<string, unknown> = {};
      expect(probe.polluted).toBeUndefined();
    }
  );

  it("skips a field whose path has an empty segment", () => {
    const descriptor = withField({ name: "a..b", label: "X", kind: "text" });
    expect(emptyConfiguration(descriptor)).toEqual({});
  });
});

describe("an optional select nobody chose a value for", () => {
  const descriptor: EmailProviderDescriptor = {
    type: "acme-mail",
    label: "Acme Mail",
    capabilities: {},
    configFields: [
      {
        name: "tier",
        label: "Tier",
        kind: "select",
        options: [{ value: "standard", label: "Standard" }],
      },
      { name: "note", label: "Note", kind: "text" },
    ],
  };

  it("is omitted, because an empty string is not one of its options", () => {
    // `z.enum(options).optional()` is a perfectly reasonable parser and rejects
    // `""`, so sending it would make the provider unsaveable until the field
    // was set — for a field that is optional.
    const values: ProviderFormValues = {
      ...defaultFormValues(descriptor),
      configuration: { tier: "", note: "" },
    };

    const { configuration, unsetConfiguration } = formValuesToPayload(
      values,
      descriptor
    );
    expect(configuration).not.toHaveProperty("tier");
    // Nothing was stored, so there is nothing to ask the server to remove.
    expect(unsetConfiguration).toBeUndefined();
    // An empty optional TEXT field is omitted too, and this assertion used to
    // say the opposite. When the rule covered only selects, sending `""` for a
    // blank text field was the conservative choice; generalising it showed the
    // conservative choice was the wrong one. A parser written as
    // `z.string().min(1).optional()` accepts absence and rejects `""`, so
    // sending the empty string refuses a create over a field the user was
    // never required to fill in. There is also no way for a user to express
    // "explicitly empty" as distinct from "left blank", so there is nothing to
    // preserve by sending one.
    expect(configuration).not.toHaveProperty("note");
  });

  it("asks for removal when a stored value is cleared", () => {
    // Omitting it would be read as "leave this alone" by the server's merge,
    // which made an optional selection permanent the moment it was saved. The
    // removal is named beside the values instead, because every marker that
    // could be placed among them is a value some provider stores.
    const values: ProviderFormValues = {
      ...defaultFormValues(descriptor),
      configuration: { tier: "", note: "" },
    };

    const { configuration, unsetConfiguration } = formValuesToPayload(
      values,
      descriptor,
      { tier: "standard", note: "" }
    );

    // Both stored fields were cleared, so both are named. A stored empty
    // string is something to remove just as much as a stored selection is.
    expect(unsetConfiguration).toEqual(["tier", "note"]);
    // The control: they are not ALSO left in the values, where an empty string
    // would be validated by the provider's own parser.
    expect(Object.keys(configuration)).not.toContain("tier");
    expect(Object.keys(configuration)).not.toContain("note");
  });

  it("asks for removal when a stored NUMBER is cleared", () => {
    // A cleared number normalises to absent before it is ever a string, so it
    // serialises away to nothing and the merge reads the omission as "leave
    // it" — the number reappears and the save reports success.
    const numberDescriptor: EmailProviderDescriptor = {
      type: "acme-mail",
      label: "Acme Mail",
      capabilities: {},
      configFields: [{ name: "retries", label: "Retries", kind: "number" }],
    };
    const values: ProviderFormValues = {
      ...defaultFormValues(numberDescriptor),
      configuration: { retries: undefined },
    };

    expect(
      formValuesToPayload(values, numberDescriptor, { retries: 3 })
        .unsetConfiguration
    ).toEqual(["retries"]);
  });

  it("asks for removal when a stored optional SECRET is cleared", () => {
    // An optional credential whose parser is `z.string().min(1).optional()`
    // accepts absence and rejects "", so sending the empty string refuses the
    // update rather than removing the key.
    const secretDescriptor: EmailProviderDescriptor = {
      type: "acme-mail",
      label: "Acme Mail",
      capabilities: {},
      configFields: [
        {
          name: "fallbackKey",
          label: "Fallback Key",
          kind: "password",
          secret: true,
        },
      ],
    };
    const values: ProviderFormValues = {
      ...defaultFormValues(secretDescriptor),
      configuration: { fallbackKey: "" },
    };

    expect(
      formValuesToPayload(values, secretDescriptor, {
        fallbackKey: MASKED_SECRET,
      }).unsetConfiguration
    ).toEqual(["fallbackKey"]);
  });

  it("is sent once it has a value", () => {
    const values: ProviderFormValues = {
      ...defaultFormValues(descriptor),
      configuration: { tier: "standard", note: "" },
    };

    expect(formValuesToPayload(values, descriptor).configuration).toMatchObject(
      { tier: "standard" }
    );
  });
});

describe("a credential shorter than the mask that stands in for it", () => {
  const pinDescriptor: EmailProviderDescriptor = {
    type: "pin-mail",
    label: "Pin Mail",
    capabilities: {},
    configFields: [
      {
        name: "pin",
        label: "PIN",
        kind: "password",
        required: true,
        secret: true,
        constraints: { maxLength: 4 },
      },
    ],
  };

  const base = {
    name: "Primary",
    type: "pin-mail",
    fromEmail: "noreply@example.com",
    fromName: "",
    isDefault: false,
    isActive: true,
  };

  it("can be left alone while editing something else", () => {
    // The mask is eight characters and the credential allows four, so applying
    // the credential's own rule to the mask made the provider impossible to
    // rename or deactivate without replacing a secret nobody wanted to change.
    const result = buildProviderSchema(pinDescriptor).safeParse({
      ...base,
      configuration: { pin: MASKED_SECRET },
    });

    expect(result.success).toBe(true);
  });

  it("still enforces its real length once actually typed", () => {
    // The control: exempting the mask must not exempt the credential.
    const result = buildProviderSchema(pinDescriptor).safeParse({
      ...base,
      configuration: { pin: "12345" },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(issue => issue.message).join(" ")
    ).toContain("at most 4 characters");
  });
});

describe("an optional credential nobody touched", () => {
  const descriptor: EmailProviderDescriptor = {
    type: "acme-mail",
    label: "Acme Mail",
    capabilities: {},
    configFields: [
      { name: "host", label: "Host", kind: "text", required: true },
      {
        name: "auth.pass",
        label: "Password",
        kind: "password",
        secret: true,
      },
    ],
  };

  it("is neither sent nor unset", () => {
    // The form carries the server's mask for an untouched credential. Echoing
    // it back is what "leave this alone" means, and dropping it from the
    // payload is how that is spelled on the wire — but dropping it must not
    // then read as an emptied field, or an ordinary rename deletes the
    // password.
    const values: ProviderFormValues = {
      ...defaultFormValues(descriptor),
      configuration: { host: "smtp.acme.test", auth: { pass: MASKED_SECRET } },
    };

    const payload = formValuesToPayload(values, descriptor, {
      host: "smtp.acme.test",
      auth: { pass: MASKED_SECRET },
    });

    expect(payload.unsetConfiguration).toBeUndefined();
    // The control: a credential the user DID clear still asks for removal, so
    // this is not a test that passes because clearing stopped working.
    const cleared = formValuesToPayload(
      {
        ...values,
        configuration: { host: "smtp.acme.test", auth: { pass: "" } },
      },
      descriptor,
      { host: "smtp.acme.test", auth: { pass: MASKED_SECRET } }
    );
    expect(cleared.unsetConfiguration).toEqual(["auth.pass"]);
  });
});

describe("a blank field the provider wants sent as an empty string", () => {
  // The built-in SMTP shape: `auth` is required and its two keys are plain
  // strings, empty only for a loopback sink. Omitting them fails the parser
  // with "expected string, received undefined" — for the one setup those
  // fields were declared optional to allow.
  const descriptor: EmailProviderDescriptor = {
    type: "smtp",
    label: "SMTP",
    capabilities: {},
    configFields: [
      { name: "host", label: "Host", kind: "text", required: true },
      { name: "auth.user", label: "User", kind: "text", blankAs: "empty" },
      {
        name: "auth.pass",
        label: "Password",
        kind: "password",
        secret: true,
        blankAs: "empty",
      },
    ],
  };

  it("keeps the empty strings and the branch that holds them", () => {
    const values: ProviderFormValues = {
      ...defaultFormValues(descriptor),
      configuration: { host: "localhost", auth: { user: "", pass: "" } },
    };

    const payload = formValuesToPayload(values, descriptor);

    expect(payload.configuration).toEqual({
      host: "localhost",
      auth: { user: "", pass: "" },
    });
    expect(payload.unsetConfiguration).toBeUndefined();
  });

  it("still omits a blank field that did not ask for this", () => {
    // The control. Without it the assertion above would pass on a payload
    // that had simply stopped omitting anything, which is the bug the
    // omission behaviour exists to fix.
    const plain: EmailProviderDescriptor = {
      ...descriptor,
      configFields: [
        { name: "host", label: "Host", kind: "text", required: true },
        { name: "note", label: "Note", kind: "text" },
      ],
    };
    const values: ProviderFormValues = {
      ...defaultFormValues(plain),
      configuration: { host: "localhost", note: "" },
    };

    expect(formValuesToPayload(values, plain).configuration).toEqual({
      host: "localhost",
    });
  });
});

describe("opening an existing provider whose optional field was never set", () => {
  const descriptor: EmailProviderDescriptor = {
    type: "acme-mail",
    label: "Acme Mail",
    capabilities: {},
    configFields: [
      { name: "host", label: "Host", kind: "text", required: true },
      { name: "region", label: "Region", kind: "text", default: "eu-west-1" },
      { name: "sandbox", label: "Sandbox", kind: "boolean", default: false },
    ],
  };

  it("shows the field blank rather than the create-time default", () => {
    // A default is what to PRE-FILL when adding a provider. On an edit it puts
    // a value nobody chose into a form opened to rename something, and the
    // save persists it — replacing an absence the provider's own parser may
    // have been handling with its own fallback.
    const values = providerToFormValues(
      {
        id: "1",
        name: "Acme",
        type: "acme-mail",
        fromEmail: "a@b.com",
        fromName: null,
        configuration: { host: "smtp.acme.test" },
        isDefault: false,
        isActive: true,
        createdAt: "",
        updatedAt: "",
      },
      descriptor
    );

    expect(values.configuration).toMatchObject({ region: "" });
    // A switch has no blank, so it still takes the declared default — which
    // registration requires for every optional boolean precisely so this is
    // not a guess.
    expect(values.configuration).toMatchObject({ sandbox: false });
  });

  it("still pre-fills the default when ADDING a provider", () => {
    // The control: keeping defaults out of the edit path must not remove them
    // from the path they exist for.
    expect(defaultFormValues(descriptor).configuration).toMatchObject({
      region: "eu-west-1",
    });
  });
});

describe("a stored value whose type the provider's parser coerced", () => {
  const descriptor: EmailProviderDescriptor = {
    type: "acme-mail",
    label: "Acme Mail",
    capabilities: {},
    configFields: [
      { name: "host", label: "Host", kind: "text", required: true },
      { name: "retries", label: "Retries", kind: "number" },
    ],
  };

  function open(configuration: Record<string, unknown>) {
    return providerToFormValues(
      {
        id: "1",
        name: "Acme",
        type: "acme-mail",
        fromEmail: "a@b.com",
        fromName: null,
        configuration,
        isDefault: false,
        isActive: true,
        createdAt: "",
        updatedAt: "",
      },
      descriptor
    ).configuration;
  }

  it("reaches the number control as a number", () => {
    // A parser written as `z.coerce.number()` accepts `"3"` from a REST or
    // Direct API caller, and the service stores the object it was given. The
    // number input renders only a runtime number, so the stored setting would
    // otherwise show as a blank field the operator never emptied.
    expect(open({ host: "h", retries: "3" })).toMatchObject({ retries: 3 });
  });

  it("leaves an unparsable value alone", () => {
    // The control, twice over: a value that is not a number is shown as it is
    // stored rather than silently becoming empty, and a string field is never
    // touched by this at all.
    expect(open({ host: "h", retries: "many" })).toMatchObject({
      retries: "many",
      host: "h",
    });
  });
});
