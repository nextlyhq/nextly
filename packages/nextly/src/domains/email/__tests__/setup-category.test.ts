/**
 * What a person setting up a provider is told to check, by each built-in
 * adapter's reading of its provider's answer, and that a send's own result
 * never carries it.
 */
import { describe, expect, it } from "vitest";

import {
  failureOf,
  httpFailure,
  networkFailure,
  smtpFailure,
  unclassifiedFailure,
  withEmailFailure,
} from "../failure";
import { resendSetupCategory } from "../services/providers/resend-provider";
import {
  sendLayerErrorCode,
  sendLayerSetupCategory,
} from "../services/providers/sendlayer-provider";
import { smtpSetupCategory } from "../services/providers/smtp-provider";
import {
  setupCategoryOf,
  setupFromStatus,
  withSetupCategory,
} from "../setup-category";

describe("Resend's setup categories", () => {
  it.each([
    [401, "missing_api_key", "credentials"],
    [403, "invalid_api_key", "credentials"],
    [401, "restricted_api_key", "credentials"],
    [422, "invalid_from_address", "sender"],
    [403, "validation_error", "sender"],
    [429, "rate_limit_exceeded", "rate-limited"],
    [429, "daily_quota_exceeded", "rate-limited"],
    [422, "validation_error", "other"],
    [500, undefined, "other"],
    [403, undefined, "credentials"],
  ] as const)("reads %s %s as %s", (status, name, setup) => {
    expect(resendSetupCategory(status, name)).toBe(setup);
  });
});

describe("SMTP's setup categories", () => {
  it.each([
    [{ code: "EAUTH", responseCode: 535 }, "credentials"],
    [{ responseCode: 535, command: "AUTH PLAIN" }, "credentials"],
    [{ responseCode: 553, command: "MAIL FROM" }, "sender"],
    [{ responseCode: 550, command: "RCPT TO" }, "recipient"],
    [{ code: "ECONNREFUSED" }, "connect"],
    [{ code: "ETIMEDOUT" }, "connect"],
    [{ responseCode: 535 }, "credentials"],
    [{ responseCode: 554, command: "DATA" }, "other"],
    [{}, "other"],
  ] as const)("reads %o as %s", (error, setup) => {
    expect(smtpSetupCategory(error)).toBe(setup);
  });
});

describe("SendLayer's setup categories", () => {
  it.each([
    [401, "credentials"],
    [403, "credentials"],
    [429, "rate-limited"],
    [422, "other"],
    [500, "other"],
  ] as const)("reads %s as %s", (status, setup) => {
    expect(sendLayerSetupCategory(status)).toBe(setup);
  });

  it.each([
    [32, "sender"],
    [14, "recipient"],
    [17, "rate-limited"],
  ] as const)("reads its own code %s as %s", (code, setup) => {
    expect(sendLayerSetupCategory(400, code)).toBe(setup);
  });

  it("falls back to the status for a code it doesn't name", () => {
    expect(sendLayerSetupCategory(401, 99)).toBe("credentials");
    expect(sendLayerSetupCategory(422, 99)).toBe("other");
  });

  it("reads the first code from SendLayer's answer", () => {
    expect(
      sendLayerErrorCode(
        JSON.stringify({ Errors: [{ Code: 32, Message: "Domain not active" }] })
      )
    ).toBe(32);
    expect(
      sendLayerErrorCode(JSON.stringify({ Errors: [{ Code: "14" }] }))
    ).toBe(14);
    expect(sendLayerErrorCode("Bad gateway")).toBeUndefined();
    expect(sendLayerErrorCode(JSON.stringify({ Errors: [] }))).toBeUndefined();
  });
});

describe("setupCategoryOf", () => {
  it("prefers what the adapter attached", () => {
    const error = withSetupCategory(
      withEmailFailure(new Error("refused"), httpFailure(403)),
      "sender"
    );
    expect(setupCategoryOf(error)).toBe("sender");
  });

  it("reads the status when the adapter attached nothing", () => {
    expect(
      setupCategoryOf(withEmailFailure(new Error("x"), httpFailure(401)))
    ).toBe("credentials");
    expect(
      setupCategoryOf(withEmailFailure(new Error("x"), smtpFailure(535)))
    ).toBe("credentials");
    expect(
      setupCategoryOf(withEmailFailure(new Error("x"), httpFailure(429)))
    ).toBe("rate-limited");
  });

  it("tells a provider that never answered from one nobody classified", () => {
    expect(
      setupCategoryOf(withEmailFailure(new Error("x"), networkFailure()))
    ).toBe("connect");
    expect(
      setupCategoryOf(withEmailFailure(new Error("x"), unclassifiedFailure()))
    ).toBe("other");
    expect(setupCategoryOf(new Error("plain"))).toBe("other");
    expect(setupCategoryOf("not an error")).toBe("other");
  });

  it("ignores an attached value that is not a category", () => {
    const error = Object.assign(
      withEmailFailure(new Error("x"), httpFailure(500)),
      { emailSetup: "everything" }
    );
    expect(setupCategoryOf(error)).toBe("other");
  });

  it("reads only the answers that mean one thing whatever the provider", () => {
    expect(setupFromStatus(undefined)).toBe("other");
    expect(setupFromStatus(403)).toBe("other");
  });
});

describe("a send's result", () => {
  it("is the same with or without a setup category beside it", () => {
    // The category is for the person at the setup, and only the check and the
    // test send read it. A send's failure is read through `failureOf`, which
    // must give exactly what it gave before the category existed.
    const plain = withEmailFailure(new Error("refused"), httpFailure(403));
    const categorised = withSetupCategory(
      withEmailFailure(new Error("refused"), httpFailure(403)),
      "sender"
    );
    expect(failureOf(categorised)).toEqual(failureOf(plain));
    expect(failureOf(categorised)).not.toHaveProperty("setup");
    expect(JSON.stringify(failureOf(categorised))).toBe(
      JSON.stringify(failureOf(plain))
    );
  });
});
