import { describe, expect, it } from "vitest";

import type { AccountsEmail } from "../flows/mail";

import { accountsEmailTemplates, emailVariables, templateSlug } from "./emails";

const base = { accountId: "a-1", to: "dana@example.com" };

/** One email of every kind, as the flows queue them. */
const SAMPLES: {
  [K in AccountsEmail["kind"]]: Extract<AccountsEmail, { kind: K }>;
} = {
  "verify-address": {
    ...base,
    kind: "verify-address",
    link: "L",
    code: "123456",
    notMeLink: "N",
  },
  "sign-up-taken": {
    ...base,
    kind: "sign-up-taken",
    deactivated: false,
    signInLink: "S",
    resetLink: "R",
  },
  "reset-password": { ...base, kind: "reset-password", link: "L" },
  "reset-required": { ...base, kind: "reset-required", link: "L" },
  "address-change-asked": {
    ...base,
    kind: "address-change-asked",
    newAddress: "new@example.com",
    cancelLink: "C",
  },
  "confirm-new-address": {
    ...base,
    kind: "confirm-new-address",
    link: "L",
    code: "123456",
  },
  "address-in-use": { ...base, kind: "address-in-use" },
  "address-changed": {
    ...base,
    kind: "address-changed",
    newAddress: "new@example.com",
  },
  "account-deleted": { ...base, kind: "account-deleted" },
  "password-changed": { ...base, kind: "password-changed" },
};

describe("the accounts email templates", () => {
  it("give every kind a template whose variables its email carries", () => {
    const templates = new Map(
      accountsEmailTemplates().map(template => [template.slug, template])
    );

    for (const email of Object.values(SAMPLES)) {
      const template = templates.get(templateSlug(email.kind));
      expect(template, email.kind).toBeDefined();
      const variables = emailVariables(email);
      for (const variable of template?.variables ?? []) {
        expect(
          variables[variable.name],
          `${email.kind}: ${variable.name}`
        ).toBeTruthy();
      }
    }
    expect(templates.size).toBe(Object.keys(SAMPLES).length);
  });

  it("say when each is sent", () => {
    const templates = accountsEmailTemplates();
    expect(templates).toHaveLength(Object.keys(SAMPLES).length);
    for (const template of templates) {
      expect(template.description?.trim(), template.slug).toBeTruthy();
    }
  });

  it("mark as carrying a secret every email with a link or code that acts for whoever holds it, and no other", () => {
    // A link that verifies, resets, confirms or cancels for whoever opens it,
    // or a code that does the same. The sign-in and reset links of
    // `sign-up-taken` lead to the ordinary pages, and carry nothing.
    const secret: AccountsEmail["kind"][] = [
      "verify-address",
      "reset-password",
      "reset-required",
      "address-change-asked",
      "confirm-new-address",
    ];
    const marked = accountsEmailTemplates()
      .filter(template => template.carriesSecret === true)
      .map(template => template.slug)
      .sort();
    expect(marked).toEqual(secret.map(templateSlug).sort());
  });

  it("never hands a template the recipient or the account's id", () => {
    expect(Object.keys(emailVariables(SAMPLES["reset-password"]))).toEqual([
      "link",
    ]);
  });
});
