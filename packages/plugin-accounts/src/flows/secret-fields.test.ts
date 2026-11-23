import { describe, expect, it } from "vitest";

import { resolveAccountsSettings } from "../settings";

import type { AccountsEmail } from "./mail";
import {
  fieldsFromSecrets,
  secretFields,
  withoutSecrets,
} from "./secret-fields";

const settings = resolveAccountsSettings({
  origin: "https://shop.example.com",
});

describe("an email's one-time secrets", () => {
  it("are queued by their refs alone, beside every field that carries none", () => {
    const email: AccountsEmail = {
      kind: "verify-address",
      accountId: "a-1",
      to: "dana@example.com",
      ...secretFields(settings, "verify-address", {
        link: { token: "the-link-token", ref: "r-link" },
        code: { code: "12345678", ref: "r-code" },
        notMeLink: { token: "the-not-me-token", ref: "r-not-me" },
      }),
    };

    expect(email).toMatchObject({
      link: "https://shop.example.com/account/verify?token=the-link-token",
      code: "12345678",
    });
    const queued = withoutSecrets(email);
    expect(queued).toEqual({
      kind: "verify-address",
      accountId: "a-1",
      to: "dana@example.com",
      refs: { link: "r-link", code: "r-code", notMeLink: "r-not-me" },
    });
    // Put back from the secrets, the email is the one the flow built.
    expect(
      fieldsFromSecrets(settings, "verify-address", {
        link: "the-link-token",
        code: "12345678",
        notMeLink: "the-not-me-token",
      })
    ).toEqual({
      link: email.link,
      code: email.code,
      notMeLink: email.notMeLink,
    });
  });

  it("refuse to queue an email that carries a secret with no ref for it", () => {
    const email = {
      kind: "reset-password",
      accountId: "a-1",
      to: "dana@example.com",
      link: "https://shop.example.com/account/reset?token=t",
      refs: {},
    } as unknown as AccountsEmail;

    expect(() => withoutSecrets(email)).toThrow("no ref for link");
  });

  it("queue an email that carries no secret whole", () => {
    const email: AccountsEmail = {
      kind: "address-changed",
      accountId: "a-1",
      to: "dana@example.com",
      newAddress: "new@example.com",
    };

    expect(withoutSecrets(email)).toEqual(email);
  });
});
