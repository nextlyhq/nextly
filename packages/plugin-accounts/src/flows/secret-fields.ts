import type { AccountsSettings } from "../settings";

import { pageLink } from "./links";
import type { AccountsEmail, SecretRefs } from "./mail";

/** The emails that carry a one-time secret: each names its secrets' refs. */
type WithSecrets = Extract<AccountsEmail, { refs: unknown }>;

/** The kind of an email that carries a one-time secret. */
export type SecretKind = WithSecrets["kind"];

/** The fields of an email of `K` that a secret fills. */
type SecretField<K extends SecretKind> = keyof Extract<
  WithSecrets,
  { kind: K }
>["refs"] &
  string;

type Page = keyof AccountsSettings["pages"];

/**
 * Where each secret an email carries goes: a link to one of the site's
 * pages, carrying the token, or the code as it is typed. The one place a
 * secret's field is tied to its page, read both when a flow builds the
 * email and when the queued email is sent, so the link sent is the link
 * the flow built. Typed by the emails' refs, so a secret field added to an
 * email without a place here fails to compile.
 */
const SECRET_PLACES: {
  [K in SecretKind]: Readonly<Record<SecretField<K>, Page | "code">>;
} = {
  "verify-address": { link: "verify", code: "code", notMeLink: "notMe" },
  "reset-password": { link: "reset" },
  "reset-required": { link: "reset" },
  "address-change-asked": { cancelLink: "cancelAddressChange" },
  "confirm-new-address": { link: "confirmAddress", code: "code" },
  invitation: { link: "acceptInvitation" },
};

/** A secret as core minted it: the token or code, and the ref it is derived again by. */
export type MintedSecret =
  | { readonly token: string; readonly ref: string }
  | { readonly code: string; readonly ref: string };

/** The fields of an email of `K` its secrets fill, and their refs. */
export type SecretFieldsOf<K extends SecretKind> = {
  [F in SecretField<K>]: string;
} & { refs: SecretRefs<SecretField<K>> };

/** An email as its job's input holds it: plain values, and its refs by field. */
export type QueuedEmailInput = Readonly<
  Record<string, string | boolean | null | SecretRefs<string>>
>;

/** Whether an email of this kind carries a one-time secret. */
export function carriesSecrets(kind: string): kind is SecretKind {
  return Object.hasOwn(SECRET_PLACES, kind);
}

/**
 * An email's secret fields from what a flow minted for it: each link on
 * its page with its token, each code as typed, and the refs the queued
 * email is sent by.
 */
export function secretFields<K extends SecretKind>(
  settings: Pick<AccountsSettings, "origin" | "pages">,
  kind: K,
  minted: Readonly<Record<SecretField<K>, MintedSecret>>
): SecretFieldsOf<K> {
  const secrets: Record<string, string> = {};
  const refs: Record<string, string> = {};
  for (const [field, secret] of Object.entries<MintedSecret>(minted)) {
    secrets[field] = "token" in secret ? secret.token : secret.code;
    refs[field] = secret.ref;
  }

  return {
    ...fieldsFromSecrets(settings, kind, secrets),
    refs,
  } as SecretFieldsOf<K>;
}

/**
 * The fields an email's secrets fill, from the secrets by field: what a
 * flow puts in the email it builds, and what a send puts back in the email
 * it was queued as.
 *
 * @throws TypeError when a secret the kind carries is not given
 */
export function fieldsFromSecrets(
  settings: Pick<AccountsSettings, "origin" | "pages">,
  kind: SecretKind,
  secrets: Readonly<Record<string, string>>
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [field, place] of Object.entries<Page | "code">(
    SECRET_PLACES[kind]
  )) {
    const secret = secrets[field];
    if (secret === undefined)
      throw new TypeError(`The ${kind} email's ${field} is missing.`);
    fields[field] =
      place === "code" ? secret : pageLink(settings, place, secret);
  }

  return fields;
}

/**
 * An email as it is queued: every field but the ones its secrets fill,
 * which are queued by their refs alone. So the job's row never holds a
 * secret, whatever becomes of the job.
 *
 * @throws TypeError when an email that carries secrets lacks a ref for one
 */
export function withoutSecrets(email: AccountsEmail): QueuedEmailInput {
  const entries: Array<[string, QueuedEmailInput[string]]> =
    Object.entries(email);
  if (!carriesSecrets(email.kind)) return Object.fromEntries(entries);
  const places: Readonly<Record<string, string>> = SECRET_PLACES[email.kind];
  const refs: SecretRefs<string> | undefined =
    "refs" in email ? email.refs : undefined;
  for (const field of Object.keys(places)) {
    if (typeof refs?.[field] !== "string")
      throw new TypeError(`The ${email.kind} email has no ref for ${field}.`);
  }

  return Object.fromEntries(
    entries.filter(([field]) => !Object.hasOwn(places, field))
  );
}
