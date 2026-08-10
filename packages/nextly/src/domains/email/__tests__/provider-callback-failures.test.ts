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
