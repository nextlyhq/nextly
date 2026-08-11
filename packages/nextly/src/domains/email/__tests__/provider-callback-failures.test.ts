/**
 * A provider's own failure must not become a response.
 *
 * `createAdapter` and `testConnection` receive DECRYPTED configuration, and the
 * service reports a caught error's `message` to the caller — so an error that
 * interpolates configuration hands a credential to anyone who pressed Test.
 */

import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  REDACTED_SECRET,
  defineEmailProvider,
  describeProviderFailure,
  type RegisteredEmailProvider,
} from "../provider-definition";
import { getEmailProviderRegistry } from "../services/email-provider-registry";

const SECRET = "sk_live_a_real_looking_key";

function providerThatLeaks(stage: "createAdapter" | "testConnection") {
  return defineEmailProvider<{ apiKey: string }>({
    type: "leaky",
    label: "Leaky",
    configFields: [
      { name: "apiKey", label: "API Key", kind: "password", secret: true },
    ],
    parseConfig: input => input as { apiKey: string },
    createAdapter: config => {
      if (stage === "createAdapter") {
        throw new Error(`Cannot build transport for key ${config.apiKey}`);
      }
      return { send: () => Promise.resolve({ success: true }) };
    },
    testConnection: config =>
      Promise.reject(new Error(`Probe failed for key ${config.apiKey}`)),
  });
}

describe("a provider callback that throws", () => {
  it("does not put createAdapter's message in front of a caller", () => {
    const provider = providerThatLeaks("createAdapter");

    let thrown: unknown;
    try {
      provider.createAdapterFrom({ apiKey: SECRET });
    } catch (error) {
      thrown = error;
    }

    expect(NextlyError.is(thrown)).toBe(true);
    const publicMessage = NextlyError.is(thrown) ? thrown.publicMessage : "";
    expect(publicMessage).not.toContain(SECRET);
    // The diagnostic survives as the logged cause so normalising the response
    // has not destroyed the operator's reason — with the declared credential
    // taken out of it. `createAdapter` receives the DECRYPTED configuration,
    // and `describeProviderFailure` walks this chain into the process log, so
    // a cause holding the raw key would put it there.
    const cause = NextlyError.is(thrown) ? thrown.cause : undefined;
    const causeText = cause instanceof Error ? cause.message : "";
    expect(causeText).not.toContain(SECRET);
    expect(causeText).toContain("Cannot build transport for key");
  });

  it("does not put a REJECTED testConnection's message in front of a caller", async () => {
    const provider = providerThatLeaks("testConnection");

    await expect(
      provider.testConnectionFrom?.({ apiKey: SECRET })
    ).rejects.toSatisfy((error: unknown) => {
      expect(NextlyError.is(error)).toBe(true);
      const message = NextlyError.is(error) ? error.publicMessage : "";
      expect(message).not.toContain(SECRET);
      return true;
    });
  });

  it("lets a deliberately thrown NextlyError through unchanged", () => {
    // `publicMessage` is an authoring decision about what is safe to show,
    // unlike a bare Error's incidental message. Flattening it would discard
    // the field paths a provider took care to supply.
    const provider = defineEmailProvider({
      type: "deliberate",
      label: "Deliberate",
      configFields: [],
      parseConfig: input => input as Record<string, unknown>,
      createAdapter: () => {
        throw NextlyError.validation({
          errors: [
            {
              path: "configuration.region",
              code: "INVALID_PROVIDER_CONFIG",
              message: "Region is not enabled on this account.",
            },
          ],
        });
      },
    });

    try {
      provider.createAdapterFrom({});
      expect.unreachable("expected the provider to throw");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      expect(NextlyError.is(error) ? error.code : "").toBe("VALIDATION_ERROR");
    }
  });
});

describe("a probe that RETURNS a failure", () => {
  // The thrown path is normalised; returning must not be the way around it.
  // The probe receives decrypted configuration, so `detail` is written with a
  // credential in scope and is not safe to hand back to a caller.
  it("keeps the provider's detail out of the returned error", async () => {
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "chatty",
      label: "Chatty",
      capabilities: { connectionTest: true },
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: () => ({
        send: () => Promise.resolve({ success: true }),
      }),
      testConnection: config =>
        Promise.resolve({ ok: false, detail: `Invalid key ${config.apiKey}` }),
    });

    const result = await provider.testConnectionFrom?.({ apiKey: SECRET });

    // The wrapper itself still forwards the shape; the service is what decides
    // what reaches a caller, and its test covers that. What this pins is that
    // the detail is present here to be logged rather than lost.
    expect(result).toEqual({ ok: false, detail: `Invalid key ${SECRET}` });
  });
});

describe("the adapter returned by createAdapterFrom", () => {
  // Isolates the wrapper itself. The service has its own fallback for a bare
  // Error, so a service-level test passes with or without this and proves
  // nothing about it — while every other caller of `send` depends on it.
  it("normalises a rejection from the provider's own send", async () => {
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "rejecting",
      label: "Rejecting",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: config => ({
        send: () => Promise.reject(new Error(`Invalid key ${config.apiKey}`)),
      }),
    });

    const adapter = provider.createAdapterFrom({ apiKey: SECRET });

    await expect(
      adapter.send({
        to: "someone@example.com",
        from: "noreply@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(NextlyError.is(error)).toBe(true);
      const message = NextlyError.is(error) ? error.publicMessage : "";
      expect(message).not.toContain(SECRET);
      // The diagnostic is kept as the cause so the log has a reason, with the
      // declared credential taken out of it. `describeProviderFailure` walks
      // this chain into `email.failed`, so a cause holding the raw key would
      // put it in the process log.
      const cause = NextlyError.is(error) ? error.cause : undefined;
      const causeText = cause instanceof Error ? cause.message : "";
      expect(causeText).not.toContain(SECRET);
      expect(causeText).toContain("Invalid key");
      return true;
    });
  });

  it("leaves a successful send untouched", async () => {
    // The control: the wrapper must not change the shape of a normal send.
    const provider = defineEmailProvider({
      type: "working",
      label: "Working",
      configFields: [],
      parseConfig: input => input as Record<string, unknown>,
      createAdapter: () => ({
        send: () => Promise.resolve({ success: true, messageId: "<abc@x>" }),
      }),
    });

    await expect(
      provider.createAdapterFrom({}).send({
        to: "someone@example.com",
        from: "noreply@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
      })
    ).resolves.toEqual({ success: true, messageId: "<abc@x>" });
  });
});

describe("describing a provider failure for a log", () => {
  it("separates the shown sentence from the reason", () => {
    const cause = new Error("535 5.7.8 Authentication credentials invalid");
    const wrapped = new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "The provider failed. Check the server logs for the reason.",
      cause,
    });

    // Without this split, a log reading only `message` records the sentence
    // that points AT the log — the operator is told to read what they are
    // reading, and the SMTP status line is nowhere.
    expect(describeProviderFailure(wrapped)).toEqual({
      message: "The provider failed. Check the server logs for the reason.",
      cause: "535 5.7.8 Authentication credentials invalid",
    });
  });

  it("walks a wrapped chain rather than reading one level", () => {
    const root = new Error("ECONNREFUSED");
    const middle = new Error("transport could not connect", { cause: root });
    const outer = new Error("send failed", { cause: middle });

    expect(describeProviderFailure(outer).cause).toBe(
      "transport could not connect: ECONNREFUSED"
    );
  });

  it("terminates on a cyclic chain", () => {
    // A cycle would otherwise hang the log call that exists to describe a
    // failure, turning a diagnostic into an outage.
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.defineProperty(first, "cause", { value: second });

    expect(describeProviderFailure(first).cause?.split(": ")).toHaveLength(5);
  });

  it("reports no cause when there is none", () => {
    // The control: a plain error must not grow an empty `cause` key that a
    // log would then print as undefined.
    expect(describeProviderFailure(new Error("plain"))).toEqual({
      message: "plain",
    });
  });
});

describe("a message id built out of a credential", () => {
  const API_KEY = "sk-live-do-not-store-this";

  function leakyProvider(messageId: (key: string) => string) {
    return defineEmailProvider<{ apiKey: string }>({
      type: "leaky",
      label: "Leaky",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: config => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: messageId(config.apiKey),
          }),
      }),
    });
  }

  it("does not reach the caller", () => {
    // A rejection is normalised and a success was not, so this is the
    // disclosure that survives a restart: `messageId` is stored verbatim in
    // the delivery log. The repository's own contribution fixture returns
    // `fake-${config.apiKey}`, so this is the shape a provider author
    // actually writes.
    const adapter = leakyProvider(key => `fake-${key}`).createAdapterFrom({
      apiKey: API_KEY,
    });

    return expect(
      adapter.send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: undefined });
  });

  it("leaves an ordinary message id alone", async () => {
    // The control. Without it the assertion above would pass on a wrapper that
    // had simply stopped returning message ids, which would cost every
    // provider its correlation with its own dashboard.
    const adapter = leakyProvider(
      () => "<abc123@mail.example.com>"
    ).createAdapterFrom({ apiKey: API_KEY });

    await expect(
      adapter.send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({
      success: true,
      messageId: "<abc123@mail.example.com>",
    });
  });
});

describe("a credential the parser normalised on the way in", () => {
  /**
   * The adapter closes over the PARSED configuration while containment reads
   * the stored one, so the two disagree the moment a parser changes the value
   * — and `z.string().trim()` is the ordinary way to declare a credential
   * field.
   */
  function normalisingProvider(normalise: (raw: string) => string) {
    return defineEmailProvider<{ apiKey: string }>({
      type: "normaliser",
      label: "Normaliser",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => ({
        apiKey: normalise((input as { apiKey: string }).apiKey),
      }),
      createAdapter: config => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: `id-${config.apiKey}`,
          }),
      }),
    });
  }

  it("is caught when the parser trimmed it", async () => {
    const adapter = normalisingProvider(raw => raw.trim()).createAdapterFrom({
      apiKey: "  sk-live-trimmed-away  ",
    });

    await expect(
      adapter.send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: undefined });
  });

  it("is caught when the parser changed its case", async () => {
    const adapter = normalisingProvider(raw =>
      raw.toLowerCase()
    ).createAdapterFrom({ apiKey: "SK-LIVE-SHOUTED-KEY" });

    await expect(
      adapter.send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: undefined });
  });

  it("drops the id when trimming leaves too little to compare", async () => {
    // The stored value is long enough to compare and the credential the
    // adapter holds is not, so the id cannot be checked either way.
    const adapter = normalisingProvider(raw => raw.trim()).createAdapterFrom({
      apiKey: "        ab        ",
    });

    await expect(
      adapter.send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: undefined });
  });

  it("still leaves an ordinary id alone", async () => {
    // The control. Comparing more forms of the credential must not start
    // deleting ids that carry none of them.
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "normaliser",
      label: "Normaliser",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => ({
        apiKey: (input as { apiKey: string }).apiKey.trim(),
      }),
      createAdapter: () => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: "<abc123@mail.example.com>",
          }),
      }),
    });

    await expect(
      provider
        .createAdapterFrom({ apiKey: "  sk-live-untouched-id  " })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({
      success: true,
      messageId: "<abc123@mail.example.com>",
    });
  });
});

describe("a credential inside the provider's own error text", () => {
  const API_KEY = "sk-live-must-never-be-logged";

  function throwingProvider(message: string) {
    return defineEmailProvider<{ apiKey: string }>({
      type: "leaky",
      label: "Leaky",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: () => ({
        send: () => {
          throw new Error(message);
        },
      }),
    });
  }

  /** What the failure log would print, which is the chain plus the message. */
  async function loggedCause(provider: RegisteredEmailProvider) {
    const adapter = provider.createAdapterFrom({ apiKey: API_KEY });
    try {
      await adapter.send({
        to: "a@b.com",
        from: "c@d.com",
        subject: "x",
        html: "y",
      });
      throw new Error("the adapter was expected to fail");
    } catch (error) {
      return describeProviderFailure(error);
    }
  }

  it("does not reach the failure log", async () => {
    // The public message was already contained; the `cause` chain was not, and
    // `email.failed` spreads `describeProviderFailure` straight into the line.
    // A process log is shipped to aggregators and read by more people than the
    // configuration is.
    const described = await loggedCause(throwingProvider(API_KEY));

    expect(JSON.stringify(described)).not.toContain(API_KEY);
  });

  it("keeps the part of the diagnostic that is not the credential", async () => {
    // The control that stops this becoming a blanket redaction. An SMTP status
    // line is the one fact worth having when a send fails, and losing it to
    // remove a credential that may not be present is a bad trade.
    const described = await loggedCause(
      throwingProvider(`535 5.7.8 Authentication failed for ${API_KEY}`)
    );

    expect(JSON.stringify(described)).not.toContain(API_KEY);
    expect(described.cause).toContain("535 5.7.8 Authentication failed");
  });

  it("withholds the diagnostic when the credentials cannot be checked for", async () => {
    // A provider whose declared credential is too short to compare cannot have
    // its text checked either, so none of it is kept -- the same answer the
    // message id gets in that situation.
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "leaky",
      label: "Leaky",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: () => ({
        send: () => {
          throw new Error("ab is the key");
        },
      }),
    });

    const adapter = provider.createAdapterFrom({ apiKey: "ab" });
    try {
      await adapter.send({
        to: "a@b.com",
        from: "c@d.com",
        subject: "x",
        html: "y",
      });
      throw new Error("the adapter was expected to fail");
    } catch (error) {
      expect(JSON.stringify(describeProviderFailure(error))).not.toContain(
        "ab is the key"
      );
    }
  });
});

describe("a credential a hand-built provider re-cased before using it", () => {
  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  it("is redacted from the failure text whatever its casing", async () => {
    // `RegisteredEmailProvider` is structural, so this provider never passes
    // through the authoring helper and the parsed-configuration needles do not
    // exist for it -- containment has only the STORED spelling to work from.
    // An exact-match redaction therefore misses the value the adapter used,
    // and `describeProviderFailure` carries it into `email.failed`.
    const registry = getEmailProviderRegistry();
    registry.register({
      type: "hand-caser",
      label: "Hand Caser",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      validateConfig: () => {},
      createAdapterFrom: (input: unknown) => {
        const used = (input as { apiKey: string }).apiKey.toLowerCase();
        return {
          send: () => {
            throw new Error(`rejected ${used}`);
          },
        };
      },
      hasConnectionTest: false,
    });

    const provider = registry.get("hand-caser");
    if (!provider) throw new Error("the provider did not register");

    try {
      await provider
        .createAdapterFrom({ apiKey: "SK-LIVE-SHOUTED-KEY" })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });
      throw new Error("the adapter was expected to fail");
    } catch (error) {
      const described = JSON.stringify(describeProviderFailure(error));
      expect(described).not.toContain("sk-live-shouted-key");
      // The control against a blanket redaction: the reason survives.
      expect(described).toContain("rejected");
    }
  });
});

describe("a credential the parser DERIVED from the stored one", () => {
  const STORED_KEY = "sk-live-stored-form-of-the-key";

  /** What `z.string().transform(v => btoa(v))` produces: a reversible secret. */
  function encodingProvider() {
    return defineEmailProvider<{ apiKey: string }>({
      type: "encoder",
      label: "Encoder",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => ({
        apiKey: Buffer.from((input as { apiKey: string }).apiKey).toString(
          "base64"
        ),
      }),
      createAdapter: config => ({
        // The adapter holds the ENCODED key and builds its id out of it.
        send: () =>
          Promise.resolve({
            success: true,
            messageId: `id-${config.apiKey}`,
          }),
      }),
    });
  }

  it("does not reach the caller inside a message id", async () => {
    // The stored form and the effective form share no substring, so a
    // containment reading only the stored configuration compares the wrong
    // value -- and Base64 is reversible, so what escapes IS the credential.
    const adapter = encodingProvider().createAdapterFrom({
      apiKey: STORED_KEY,
    });

    const result = await adapter.send({
      to: "a@b.com",
      from: "c@d.com",
      subject: "x",
      html: "y",
    });

    expect(result.messageId).toBeUndefined();
  });

  it("does not reach the failure log either", async () => {
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "encoder",
      label: "Encoder",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => ({
        apiKey: Buffer.from((input as { apiKey: string }).apiKey).toString(
          "base64"
        ),
      }),
      createAdapter: config => ({
        send: () => {
          throw new Error(`rejected key ${config.apiKey}`);
        },
      }),
    });

    const encoded = Buffer.from(STORED_KEY).toString("base64");
    try {
      await provider
        .createAdapterFrom({ apiKey: STORED_KEY })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });
      throw new Error("the adapter was expected to fail");
    } catch (error) {
      const described = JSON.stringify(describeProviderFailure(error));
      expect(described).not.toContain(encoded);
      expect(described).toContain("rejected key");
    }
  });

  it("still returns an ordinary id from a parser that adds keys", async () => {
    // A parser filling in defaults produces a configuration carrying keys the
    // descriptor never declared. Those undeclared keys must not make the
    // provider's credentials uncheckable, because every provider with a
    // default has them — treating them so would withhold an ordinary message
    // id from all of them.
    const provider = defineEmailProvider<{ apiKey: string; region: string }>({
      type: "defaulting-shape",
      label: "Defaulting",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => ({
        apiKey: (input as { apiKey: string }).apiKey,
        region: "eu-west-1",
      }),
      createAdapter: () => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: "<abc123@mail.example.com>",
          }),
      }),
    });

    await expect(
      provider
        .createAdapterFrom({ apiKey: STORED_KEY })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({
      success: true,
      messageId: "<abc123@mail.example.com>",
    });
  });
});

describe("a credential the parser supplied rather than the store", () => {
  function defaultingProvider(fallback: string) {
    return defineEmailProvider<{ apiKey: string }>({
      type: "defaulting",
      label: "Defaulting",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      // What `z.string().default(process.env.PROVIDER_KEY)` does: an absent
      // key is filled in, and the adapter holds a credential the stored
      // configuration never contained.
      parseConfig: input => ({
        apiKey: (input as { apiKey?: string }).apiKey ?? fallback,
      }),
      createAdapter: config => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: `id-${config.apiKey}`,
          }),
      }),
    });
  }

  it("drops the id when the declared credential was not stored", async () => {
    // Nothing here can say what the parser filled in, so no id from this
    // provider can be trusted -- the same conclusion the short-credential and
    // undeclared-leaf rules reach.
    const adapter = defaultingProvider(
      "sk-live-from-the-environment"
    ).createAdapterFrom({});

    await expect(
      adapter.send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: undefined });
  });

  it("keeps ids when the credential is stored as an empty string", async () => {
    // The control that matters most. A default does not fire for `""`, so the
    // adapter holds the empty string and there is no secret to leak -- and the
    // built-in SMTP loopback sink stores exactly this. Treating absent and
    // empty alike would cost that provider every message id it returns.
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "defaulting",
      label: "Defaulting",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: () => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: "<abc123@mail.example.com>",
          }),
      }),
    });

    await expect(
      provider
        .createAdapterFrom({ apiKey: "" })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({
      success: true,
      messageId: "<abc123@mail.example.com>",
    });
  });
});

describe("a provider that never passed through the authoring helper", () => {
  const KEY = "sk-live-must-never-be-stored";

  /**
   * `RegisteredEmailProvider` is a structural type, and `contributes.emailProviders`
   * accepts it — so a JavaScript plugin or a hand-built object reaches the
   * registry with its own `createAdapterFrom` and none of the containment
   * `defineEmailProvider` applies.
   */
  const handBuilt: RegisteredEmailProvider = {
    type: "hand-built",
    label: "Hand built",
    configFields: [
      { name: "apiKey", label: "API Key", kind: "password", secret: true },
    ],
    validateConfig: () => {},
    createAdapterFrom: (input: unknown) => {
      const config = input as { apiKey: string };
      return {
        send: () =>
          Promise.resolve({ success: true, messageId: `id-${config.apiKey}` }),
      };
    },
    hasConnectionTest: false,
  };

  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  it("has its message id contained by the registry", async () => {
    const registry = getEmailProviderRegistry();
    registry.register(handBuilt);

    const result = await registry
      .create("hand-built", { apiKey: KEY })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });

    expect(result.messageId).toBeUndefined();
  });

  it("has its thrown credential contained by the registry", async () => {
    const registry = getEmailProviderRegistry();
    registry.register({
      ...handBuilt,
      type: "hand-built-thrower",
      createAdapterFrom: (input: unknown) => {
        const config = input as { apiKey: string };
        return {
          send: () =>
            Promise.reject(new Error(`rejected key ${config.apiKey}`)),
        };
      },
    });

    const error = await registry
      .create("hand-built-thrower", { apiKey: KEY })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      );

    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).publicMessage).not.toContain(KEY);
  });

  it("leaves an ordinary hand-built message id alone", async () => {
    // The control. Without it the two above would pass on a registry that had
    // stopped returning message ids or started swallowing every send.
    const registry = getEmailProviderRegistry();
    registry.register({
      ...handBuilt,
      type: "hand-built-clean",
      createAdapterFrom: () => ({
        send: () =>
          Promise.resolve({ success: true, messageId: "<ok@mail.test>" }),
      }),
    });

    await expect(
      registry
        .create("hand-built-clean", { apiKey: KEY })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: "<ok@mail.test>" });
  });
});

describe("a credential too short to compare", () => {
  it("costs the provider its message ids", async () => {
    // A three-character secret matches almost any identifier, so using it as a
    // needle would delete every id this provider returns. Ignoring it instead
    // would let the credential appear inside one, so the id is dropped
    // whenever such a secret is declared.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ pin: string }>({
        type: "short-secret",
        label: "Short secret",
        configFields: [
          { name: "pin", label: "PIN", kind: "password", secret: true },
        ],
        parseConfig: input => input as { pin: string },
        createAdapter: config => ({
          send: () =>
            Promise.resolve({ success: true, messageId: `msg-${config.pin}` }),
        }),
      })
    );

    const result = await registry
      .create("short-secret", { pin: "742" })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });

    expect(result.messageId).toBeUndefined();
  });

  it("does not punish a provider whose short field is not secret", async () => {
    // The control. The rule keys on `secret: true`, not on shortness — a brief
    // non-secret value must not cost the provider its ids.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ tag: string }>({
        type: "short-public",
        label: "Short public",
        configFields: [{ name: "tag", label: "Tag", kind: "text" }],
        parseConfig: input => input as { tag: string },
        createAdapter: () => ({
          send: () =>
            Promise.resolve({ success: true, messageId: "<ok@mail.test>" }),
        }),
      })
    );

    await expect(
      registry
        .create("short-public", { tag: "eu" })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: "<ok@mail.test>" });
  });

  afterEach(() => {
    getEmailProviderRegistry().reset();
  });
});

describe("a credential that is not a string", () => {
  // The registry is a process-wide singleton and `register` refuses a
  // duplicate type, so a registration left behind reaches every later suite in
  // this worker and makes the next registration of the same type fail.
  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  it("is contained too", async () => {
    // A credential is declared on a text field -- that is the only kind that
    // can hold the mask it is read back as -- and the VALUE stored under it is
    // still whatever a coercing parser, a legacy row or a JavaScript caller
    // put there. Reading only string values hands back an empty secret list
    // for exactly the provider about to interpolate a number.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ pin: number }>({
        type: "numeric-secret",
        label: "Numeric secret",
        configFields: [
          { name: "pin", label: "PIN", kind: "text", secret: true },
        ],
        parseConfig: input => input as { pin: number },
        createAdapter: config => ({
          send: () =>
            Promise.resolve({ success: true, messageId: `msg-${config.pin}` }),
        }),
      })
    );

    const result = await registry
      .create("numeric-secret", { pin: 483927 })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });

    expect(result.messageId).toBeUndefined();
  });

  it("leaves a message id that merely contains digits alone", async () => {
    // The control. A four-digit-or-longer secret is a substring risk, so the
    // rule has to be checked against a provider whose id shares no value with
    // its configuration — otherwise "contained" could mean "always dropped".
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ pin: number }>({
        type: "numeric-secret-clean",
        label: "Numeric secret clean",
        configFields: [
          { name: "pin", label: "PIN", kind: "text", secret: true },
        ],
        parseConfig: input => input as { pin: number },
        createAdapter: () => ({
          send: () =>
            Promise.resolve({
              success: true,
              messageId: "<20260811@mail.test>",
            }),
        }),
      })
    );

    await expect(
      registry
        .create("numeric-secret-clean", { pin: 483927 })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: "<20260811@mail.test>" });
  });
});

describe("a provider that declares no field metadata", () => {
  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  it("has its message ids dropped, because nothing can say what is secret", async () => {
    // `configFields: []` is supported — a provider may store configuration
    // without describing it. An empty list is an absence of information, not a
    // statement that nothing is secret, and the service masks every leaf for
    // exactly that reason. Containment fails closed the same way.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ apiKey: string }>({
        type: "no-metadata",
        label: "No metadata",
        configFields: [],
        parseConfig: input => input as { apiKey: string },
        createAdapter: config => ({
          send: () =>
            Promise.resolve({
              success: true,
              messageId: `id-${config.apiKey}`,
            }),
        }),
      })
    );

    const result = await registry
      .create("no-metadata", { apiKey: "sk-live-secret-value" })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });

    expect(result.messageId).toBeUndefined();
  });

  it("keeps them when there is no configuration to protect", async () => {
    // The control. No fields AND no stored configuration means there is no
    // credential in scope, so the id is not withheld — the rule keys on having
    // something to protect and no way to identify it, not on the empty list.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider({
        type: "no-metadata-no-config",
        label: "No metadata, no config",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: () =>
            Promise.resolve({ success: true, messageId: "<ok@mail.test>" }),
        }),
      })
    );

    await expect(
      registry
        .create("no-metadata-no-config", {})
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: "<ok@mail.test>" });
  });
});

describe("a credential declared on a switch", () => {
  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  it("costs the provider its message ids", async () => {
    // A boolean VALUE under a declared credential -- what a coercing parser or
    // a legacy row leaves behind. Its two renderings, "true" and "false",
    // appear inside ordinary identifiers often enough that comparing against
    // them would delete legitimate ids while catching the credential only by
    // accident, so it is unmatchable instead.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ privateFlag: boolean }>({
        type: "bool-secret",
        label: "Boolean secret",
        configFields: [
          { name: "privateFlag", label: "Flag", kind: "text", secret: true },
        ],
        parseConfig: input => input as { privateFlag: boolean },
        createAdapter: config => ({
          send: () =>
            Promise.resolve({
              success: true,
              messageId: `id-${config.privateFlag}`,
            }),
        }),
      })
    );

    const result = await registry
      .create("bool-secret", { privateFlag: true })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });

    expect(result.messageId).toBeUndefined();
  });

  it("leaves a NON-secret boolean alone", async () => {
    // The control: the rule keys on `secret: true`, not on the field's kind.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<{ sandbox: boolean }>({
        type: "bool-public",
        label: "Boolean public",
        configFields: [
          {
            name: "sandbox",
            label: "Sandbox",
            kind: "boolean",
            default: false,
          },
        ],
        parseConfig: input => input as { sandbox: boolean },
        createAdapter: () => ({
          send: () =>
            Promise.resolve({ success: true, messageId: "<ok@mail.test>" }),
        }),
      })
    );

    await expect(
      registry
        .create("bool-public", { sandbox: true })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: "<ok@mail.test>" });
  });
});

describe("a credential the descriptor does not mention", () => {
  afterEach(() => {
    getEmailProviderRegistry().reset();
  });

  it("makes the provider's message ids untrustworthy", async () => {
    // A key left behind by a provider upgrade is undeclared, and
    // `maskConfiguration` already withholds it on that reasoning. Containment
    // has to agree, or the value is hidden from every read and then handed
    // back inside an id.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<Record<string, unknown>>({
        type: "legacy-leftover",
        label: "Legacy leftover",
        configFields: [
          { name: "apiKey", label: "API Key", kind: "password", secret: true },
        ],
        parseConfig: input => input as Record<string, unknown>,
        createAdapter: config => ({
          send: () =>
            Promise.resolve({
              success: true,
              messageId: `id-${String(config.legacyKey)}`,
            }),
        }),
      })
    );

    const result = await registry
      .create("legacy-leftover", {
        apiKey: "sk-current-value",
        legacyKey: "sk-retained-from-an-upgrade",
      })
      .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });

    expect(result.messageId).toBeUndefined();
  });

  it("leaves a fully declared configuration alone", async () => {
    // The control: the rule keys on an UNDECLARED leaf, not on nesting or on
    // there being more than one field.
    const registry = getEmailProviderRegistry();
    registry.register(
      defineEmailProvider<Record<string, unknown>>({
        type: "fully-declared",
        label: "Fully declared",
        configFields: [
          { name: "apiKey", label: "API Key", kind: "password", secret: true },
          { name: "auth.user", label: "User", kind: "text" },
        ],
        parseConfig: input => input as Record<string, unknown>,
        createAdapter: () => ({
          send: () =>
            Promise.resolve({ success: true, messageId: "<ok@mail.test>" }),
        }),
      })
    );

    await expect(
      registry
        .create("fully-declared", {
          apiKey: "sk-current-value",
          auth: { user: "postmaster" },
        })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" })
    ).resolves.toEqual({ success: true, messageId: "<ok@mail.test>" });
  });
});

describe("a diagnostic whose case folding changes its length", () => {
  const KEY = "SK-LIVE-SECRET-VALUE";

  function throwing(message: string) {
    return defineEmailProvider<{ apiKey: string }>({
      type: "folding",
      label: "Folding",
      configFields: [
        { name: "apiKey", label: "API Key", kind: "password", secret: true },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: () => ({
        send: () => {
          throw new Error(message);
        },
      }),
    });
  }

  async function described(message: string) {
    try {
      await throwing(message)
        .createAdapterFrom({ apiKey: KEY })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });
      throw new Error("the adapter was expected to fail");
    } catch (error) {
      return JSON.stringify(describeProviderFailure(error));
    }
  }

  it("redacts the credential however far the fold shifts", async () => {
    // `İ` lowercases to TWO code units, so an index taken from a lowercased
    // copy does not address the original string. The four counts bracket the
    // consequence: none is the ordinary case, a few shift the redaction part
    // way into the credential and leave its head behind, and more than the
    // credential is long shift it clear of the value entirely — which is what
    // would put a whole secret in the line `email.failed` writes.
    for (const count of [0, 5, 25, 60]) {
      const described_ = await described(
        `${"İ".repeat(count)} rejected ${KEY}`
      );
      expect(described_, `with ${count} folding characters`).not.toContain(KEY);
    }
  });

  it("keeps the diagnostic around the credential", async () => {
    // The control: this must stay a redaction rather than becoming a blanket
    // withholding, or the log loses the reason it exists for.
    const described_ = await described(`535 rejected ${KEY} for user`);

    expect(described_).toContain("535 rejected");
    expect(described_).toContain("for user");
    expect(described_).not.toContain(KEY);
  });

  it("does not scale with the number of occurrences", async () => {
    // A provider quoting a large remote error body back repeats the credential
    // many times, on a path a caller can provoke. Redaction therefore does no
    // whole-diagnostic work per match: the cost tracks the length of the text
    // rather than the number of occurrences in it.
    const many = Array.from({ length: 4000 }, () => KEY).join(" padding ");

    const described_ = await described(many);

    // Every occurrence, not merely the first: an implementation that scanned
    // the whole diagnostic once per match would also be correct here, so the
    // count is what separates the two rather than the presence of a redaction.
    expect(described_).not.toContain(KEY);
    expect(described_.split(REDACTED_SECRET).length - 1).toBe(4000);
    // Asserted as output rather than as elapsed time. A wall-clock bound tight
    // enough to catch per-match whole-diagnostic work is also tight enough for
    // a loaded runner to trip, and the suite's own timeout already refuses an
    // implementation slow enough to matter at this size.
  });
});

describe("two declared credentials where one is a prefix of the other", () => {
  const SHORT = "sk_live";
  const LONG = "sk_live_REAL_SECRET_VALUE";

  function overlapping(message: string) {
    return defineEmailProvider<{ a: string; b: string }>({
      type: "overlapping",
      label: "Overlapping",
      configFields: [
        { name: "a", label: "A", kind: "password", secret: true },
        { name: "b", label: "B", kind: "password", secret: true },
      ],
      parseConfig: input => input as { a: string; b: string },
      createAdapter: () => ({
        send: () => {
          throw new Error(message);
        },
      }),
    });
  }

  async function described(message: string) {
    try {
      await overlapping(message)
        .createAdapterFrom({ a: SHORT, b: LONG })
        .send({ to: "a@b.com", from: "c@d.com", subject: "x", html: "y" });
      throw new Error("the adapter was expected to fail");
    } catch (error) {
      return JSON.stringify(describeProviderFailure(error));
    }
  }

  it("leaves no tail of the longer one behind", async () => {
    // Redacting the shorter credential first consumes the head of the longer
    // one, and what is left no longer matches anything — so the remainder of a
    // live secret reaches the log as `[secret]_REAL_SECRET_VALUE`.
    const text = await described(`rejected ${LONG}`);

    expect(text).not.toContain("_REAL_SECRET_VALUE");
    expect(text).not.toContain(LONG);
  });

  it("still redacts the shorter one on its own", async () => {
    // The control: ordering by length must not stop a short credential being
    // found when it is the one that appears.
    const text = await described(`rejected ${SHORT} alone`);

    expect(text).not.toContain(SHORT);
    expect(text).toContain("alone");
  });
});
