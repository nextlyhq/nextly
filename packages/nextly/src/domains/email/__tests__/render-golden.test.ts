/**
 * What every template renders to, pinned.
 *
 * The outputs in `__golden__/render-golden.json` were produced by the
 * `{{variable}}` engine this package shipped before Liquid. A change to the
 * engine must leave every one of them byte for byte as it is: an existing site
 * sends these emails today, and none of them may change.
 *
 * Covered: every core built-in template and the default layout (read from
 * their source), the accounts plugin's ten templates (frozen below, since this
 * package cannot import the plugin), and one template that exercises the
 * subject, preheader and plain-text paths. Each is rendered with four sets of
 * data: typical values, hostile values, nothing at all, and values that are
 * not strings.
 */
import { describe, expect, it } from "vitest";

import type { EmailTemplateInsert } from "../../../schemas/email-templates/types";
import {
  renderTemplate,
  type TemplateFields,
} from "../services/render-template";
import {
  BUILT_IN_TEMPLATES,
  defaultLayoutTemplate,
} from "../services/templates";

/** The accounts plugin's templates as its source held them when this was pinned. */
const ACCOUNTS_TEMPLATES: Array<
  Pick<EmailTemplateInsert, "slug" | "subject" | "htmlContent">
> = [
  {
    slug: "accounts-verify-address",
    subject: "Confirm your email address",
    htmlContent: `<p>Confirm your email address: <a href="{{link}}">confirm</a>, or type the code <strong>{{code}}</strong>.</p><p>Didn't sign up? <a href="{{notMeLink}}">Remove this account</a>.</p>`,
  },
  {
    slug: "accounts-sign-up-taken",
    subject: "Someone tried to sign up with your address",
    htmlContent: `<p>Someone tried to make an account with this address, which already has one.</p><p>If it was you, <a href="{{signInLink}}">sign in</a> or <a href="{{resetLink}}">reset your password</a>. If your account was closed, contact us.</p>`,
  },
  {
    slug: "accounts-reset-password",
    subject: "Reset your password",
    htmlContent: `<p>Someone asked to reset the password for this address. <a href="{{link}}">Choose a new password</a>.</p><p>If it wasn't you, you can ignore this email.</p>`,
  },
  {
    slug: "accounts-reset-required",
    subject: "Reset your password to sign in again",
    htmlContent: `<p>There have been too many wrong passwords for your account, so it now needs a reset to sign in from a new browser. <a href="{{link}}">Choose a new password</a>.</p>`,
  },
  {
    slug: "accounts-address-change-asked",
    subject: "A change of your email address was asked for",
    htmlContent: `<p>Someone signed in to your account asked to change its address to {{newAddress}}.</p><p>If it wasn't you, <a href="{{cancelLink}}">cancel the change</a>.</p>`,
  },
  {
    slug: "accounts-confirm-new-address",
    subject: "Confirm your new email address",
    htmlContent: `<p>Confirm this as your account's new address: <a href="{{link}}">confirm</a>, or type the code <strong>{{code}}</strong> while signed in.</p>`,
  },
  {
    slug: "accounts-address-in-use",
    subject: "Someone tried to use your email address",
    htmlContent: `<p>Someone tried to move another account to this address, which already has an account. Nothing has changed.</p>`,
  },
  {
    slug: "accounts-address-changed",
    subject: "Your account's email address changed",
    htmlContent: `<p>Your account's address is now {{newAddress}}. If you didn't do this, contact us.</p>`,
  },
  {
    slug: "accounts-account-deleted",
    subject: "Your account was deleted",
    htmlContent: `<p>Your account has been deleted.</p>`,
  },
  {
    slug: "accounts-password-changed",
    subject: "Your password changed",
    htmlContent: `<p>Your account's password changed. If you didn't do this, reset it now.</p>`,
  },
];

/** Exercises the subject, preheader and plain text, which the others leave empty. */
const ENVELOPE_TEMPLATE: Pick<
  EmailTemplateInsert,
  "slug" | "subject" | "htmlContent" | "plainTextContent" | "preheader"
> = {
  slug: "golden-envelope",
  subject: "Hello {{userName}} — {{ order.number }} & {{missing}}",
  preheader: "Your order {{order.number}} from {{appName}} ({{userName}})",
  htmlContent: `<p>Hi {{userName}}, order {{ order.number }} for {{order.total}}.</p>\n<p>{{ user.profile.city }} / {{flag}} / {{items}}</p>`,
  plainTextContent:
    "Hi {{userName}},\nOrder {{order.number}} — {{order.total}}.\n{{items}} {{flag}} {{missing}}",
};

const BASE = { appName: "Golden Shop", year: "2026" };

const DATASETS: Record<string, Record<string, unknown>> = {
  typical: {
    ...BASE,
    userName: "Priya Raman",
    userEmail: "priya@example.com",
    resetLink: "https://example.com/reset?token=abc&next=/admin",
    verifyLink: "https://example.com/verify?token=def",
    expiresIn: "1 hour",
    link: "https://example.com/l?a=1&b=2",
    code: "481 902",
    notMeLink: "https://example.com/not-me",
    signInLink: "https://example.com/sign-in",
    newAddress: "new@example.com",
    cancelLink: "https://example.com/cancel",
    order: { number: "1042", total: "$225.00" },
    user: { profile: { city: "Lahore" } },
    items: "two",
    flag: "yes",
  },
  hostile: {
    ...BASE,
    appName: "Shop <b>&</b> 'Co' \"Ltd\"",
    userName: `<script>alert("x")</script>`,
    userEmail: `a"onmouseover="alert(1)@example.com`,
    resetLink: `javascript:alert('x')`,
    verifyLink: `"><img src=x onerror=alert(1)>`,
    expiresIn: "&amp; already &lt;escaped&gt;",
    link: `" style="x`,
    code: "{{userName}}",
    notMeLink: "{% if true %}tag{% endif %}",
    signInLink: "line\r\nbreak",
    newAddress: "'quoted'",
    cancelLink: "</a><a href=//evil>",
    order: { number: "<1042>", total: "&euro; 5" },
    user: { profile: { city: "{{ appName }}" } },
    items: "{{ order.number | upcase }}",
    flag: "\u0000nul",
  },
  missing: {},
  nonStrings: {
    ...BASE,
    userName: 42,
    userEmail: true,
    expiresIn: 0,
    link: null,
    code: ["a", "b"],
    order: { number: 1042, total: 225.5 },
    user: { profile: { city: { nested: true } } },
    items: [1, 2, 3],
    flag: false,
    newAddress: { street: "1 Main St" },
  },
};

const fields = (t: {
  subject: string;
  htmlContent: string;
  plainTextContent?: string | null;
  preheader?: string | null;
  useLayout?: boolean;
  kind?: TemplateFields["kind"];
}): TemplateFields => ({
  subject: t.subject,
  htmlContent: t.htmlContent,
  plainTextContent: t.plainTextContent ?? null,
  preheader: t.preheader ?? null,
  useLayout: t.useLayout ?? true,
  kind: t.kind ?? "template",
});

const TEMPLATES: Array<[string, TemplateFields]> = [
  ...BUILT_IN_TEMPLATES.map(
    t => [t.slug, fields(t)] as [string, TemplateFields]
  ),
  ...ACCOUNTS_TEMPLATES.map(
    t => [t.slug, fields(t)] as [string, TemplateFields]
  ),
  [ENVELOPE_TEMPLATE.slug, fields(ENVELOPE_TEMPLATE)],
];

describe("every template renders exactly as before", () => {
  it("matches the pinned output of the engine it replaced", async () => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [slug, template] of TEMPLATES) {
      out[slug] = {};
      for (const [name, data] of Object.entries(DATASETS)) {
        out[slug][name] = renderTemplate(
          template,
          template.useLayout ? defaultLayoutTemplate : null,
          data,
          { appName: "Nextly" }
        );
      }
    }
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
      "./__golden__/render-golden.json"
    );
  });

  it("covers every built-in and every accounts template", () => {
    // The instrument control: a template added to either list without being
    // rendered here would be a template whose output nobody pinned.
    expect(TEMPLATES.map(([slug]) => slug)).toEqual(
      expect.arrayContaining([
        "default-layout",
        "welcome",
        "password-reset",
        "email-verification",
        ...ACCOUNTS_TEMPLATES.map(t => t.slug),
      ])
    );
    expect(ACCOUNTS_TEMPLATES).toHaveLength(10);
  });

  it("pins the accounts plugin's templates as its source holds them now", async () => {
    // A template the plugin adds or rewords fails here until it is pinned,
    // so its output under Liquid can't change without a golden entry. Read
    // from the sibling package's source by a computed path, which the
    // package's own type check doesn't follow across its root.
    const source = new URL(
      "../../../../../plugin-accounts/src/wiring/emails.ts",
      import.meta.url
    ).href;
    const { accountsEmailTemplates } = (await import(
      /* @vite-ignore */ source
    )) as {
      accountsEmailTemplates(): Array<{
        slug: string;
        subject: string;
        htmlContent: string;
      }>;
    };
    expect(
      accountsEmailTemplates().map(({ slug, subject, htmlContent }) => ({
        slug,
        subject,
        htmlContent,
      }))
    ).toEqual(ACCOUNTS_TEMPLATES);
  });
});
