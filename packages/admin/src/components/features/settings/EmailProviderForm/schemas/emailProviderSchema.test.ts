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

    const { configuration } = formValuesToPayload(values, descriptor);
    expect(configuration).not.toHaveProperty("tier");
    // The control that keeps the rule narrow: an empty TEXT field is a value a
    // provider may well accept, so it is still sent.
    expect(configuration).toHaveProperty("note", "");
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
