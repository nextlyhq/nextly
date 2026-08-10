/**
 * A provider's own failure must not become a response.
 *
 * `createAdapter` and `testConnection` receive DECRYPTED configuration, and the
 * service reports a caught error's `message` to the caller — so an error that
 * interpolates configuration hands a credential to anyone who pressed Test.
 */

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { defineEmailProvider } from "../provider-definition";

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
    // The positive control: the original survives as the logged cause, so
    // normalising the response has not destroyed the operator's diagnostic.
    const cause = NextlyError.is(thrown) ? thrown.cause : undefined;
    expect(cause instanceof Error ? cause.message : "").toContain(SECRET);
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
      // The original is kept as the cause, so nothing is lost for the log.
      const cause = NextlyError.is(error) ? error.cause : undefined;
      expect(cause instanceof Error ? cause.message : "").toContain(SECRET);
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
