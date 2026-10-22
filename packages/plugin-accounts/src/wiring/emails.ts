import type { PluginEmailTemplate } from "@nextlyhq/plugin-sdk";

import type { AccountsEmail } from "../flows/mail";

type Kind = AccountsEmail["kind"];

/** An email's template, as the plugin first ships it; a site edits its copy in the admin. */
interface Template {
  name: string;
  /** When the email is sent, in a sentence the admin shows beside it. */
  description: string;
  subject: string;
  /** The body, with `{{variable}}` for each of the email's fields. */
  html: string;
  /**
   * Whether the email carries a link or code that acts for whoever holds it,
   * so no template copy (cc or bcc) may ever be added to it.
   */
  carriesSecret?: true;
}

/**
 * Every email the flows send, one template each. Keyed by the email's kind,
 * so a kind added to the flows without a template fails to compile.
 */
const TEMPLATES: Record<Kind, Template> = {
  "verify-address": {
    name: "Verify an address",
    description:
      "Sent when someone signs up, with the link and code that verify their address and a link to remove the account.",
    carriesSecret: true,
    subject: "Confirm your email address",
    html: `<p>Confirm your email address: <a href="{{link}}">confirm</a>, or type the code <strong>{{code}}</strong>.</p><p>Didn't sign up? <a href="{{notMeLink}}">Remove this account</a>.</p>`,
  },
  "sign-up-taken": {
    name: "Sign-up with an address that has an account",
    description:
      "Sent when someone tries to sign up with an address that already has an account.",
    subject: "Someone tried to sign up with your address",
    html: `<p>Someone tried to make an account with this address, which already has one.</p><p>If it was you, <a href="{{signInLink}}">sign in</a> or <a href="{{resetLink}}">reset your password</a>. If your account was closed, contact us.</p>`,
  },
  "reset-password": {
    name: "Reset a password",
    description:
      "Sent when someone asks to reset the password of an account, with the link that sets a new one.",
    carriesSecret: true,
    subject: "Reset your password",
    html: `<p>Someone asked to reset the password for this address. <a href="{{link}}">Choose a new password</a>.</p><p>If it wasn't you, you can ignore this email.</p>`,
  },
  "reset-required": {
    name: "A reset is needed",
    description:
      "Sent when too many wrong passwords mean the account needs a reset, with the link that sets a new one.",
    carriesSecret: true,
    subject: "Reset your password to sign in again",
    html: `<p>There have been too many wrong passwords for your account, so it now needs a reset to sign in from a new browser. <a href="{{link}}">Choose a new password</a>.</p>`,
  },
  "address-change-asked": {
    name: "An address change was asked for",
    description:
      "Sent to an account's address when a change to another address is asked for, with the link that cancels it.",
    carriesSecret: true,
    subject: "A change of your email address was asked for",
    html: `<p>Someone signed in to your account asked to change its address to {{newAddress}}.</p><p>If it wasn't you, <a href="{{cancelLink}}">cancel the change</a>.</p>`,
  },
  "confirm-new-address": {
    name: "Confirm a new address",
    description:
      "Sent to a new address an account asked to move to, with the link and code that confirm it.",
    carriesSecret: true,
    subject: "Confirm your new email address",
    html: `<p>Confirm this as your account's new address: <a href="{{link}}">confirm</a>, or type the code <strong>{{code}}</strong> while signed in.</p>`,
  },
  "address-in-use": {
    name: "An address change named an address in use",
    description:
      "Sent to an address that has an account when another account tries to move to it.",
    subject: "Someone tried to use your email address",
    html: `<p>Someone tried to move another account to this address, which already has an account. Nothing has changed.</p>`,
  },
  "address-changed": {
    name: "An address changed",
    description:
      "Sent to an account's old address once the change to a new one is made.",
    subject: "Your account's email address changed",
    html: `<p>Your account's address is now {{newAddress}}. If you didn't do this, contact us.</p>`,
  },
  "account-deleted": {
    name: "An account was deleted",
    description: "Sent when the holder deletes their account.",
    subject: "Your account was deleted",
    html: `<p>Your account has been deleted.</p>`,
  },
  "password-changed": {
    name: "A password changed",
    description: "Sent when an account's password changes.",
    subject: "Your password changed",
    html: `<p>Your account's password changed. If you didn't do this, reset it now.</p>`,
  },
};

/** The slug an email kind's template is registered under. */
export function templateSlug(kind: Kind): string {
  return `accounts-${kind}`;
}

/** The templates the plugin contributes, one per email kind. */
export function accountsEmailTemplates(): PluginEmailTemplate[] {
  return (Object.entries(TEMPLATES) as Array<[Kind, Template]>).map(
    ([kind, template]) => ({
      slug: templateSlug(kind),
      name: template.name,
      description: template.description,
      ...(template.carriesSecret ? { carriesSecret: true } : {}),
      subject: template.subject,
      htmlContent: template.html,
      variables: variablesIn(template.html).map(name => ({
        name,
        required: true,
      })),
    })
  );
}

/** An email's fields as its template's variables: everything but its kind, its account and its recipient. */
export function emailVariables(email: AccountsEmail): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(email)) {
    if (name === "kind" || name === "accountId" || name === "to") continue;
    variables[name] = String(value);
  }

  return variables;
}

function variablesIn(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1] ?? "")
    ),
  ];
}
