/**
 * Where core keeps secrets: one declared answer for every core table.
 *
 * Anything that writes a site's data somewhere else (an archive, a backup, an
 * export, a pull to another site) has to leave secrets behind, and before this
 * list the only place that said which values were secret was a plugin
 * setting's `is_secret` flag. Every other secret was known only to the module
 * that stores it. So this is the one place that answers the question for core,
 * and `guard.ts` is the one place that acts on the answer.
 *
 * Every core table has an answer, including "nothing here is secret": a table
 * with no answer is one nobody has looked at, and
 * `schemas/__tests__/core-tables-declare-secrets.test.ts` fails until someone
 * does. That test also checks each named column exists on every dialect, so a
 * renamed column cannot leave a stale name here that silently stops matching.
 *
 * What counts as a secret: a value that lets whoever holds it act as a
 * person, a key or the site (a token, a key, a code, a credential sealed
 * under the site's secret), and a value core cannot read that a plugin may
 * fill with one (a job's input). A lease or lock holder that only the server
 * ever sees is not one; a token handed to a browser to prove it holds a lock
 * is.
 *
 * Tables Nextly has retired (`sessions`, `accounts` on an upgraded install)
 * are not core tables and have no answer here, so the guard refuses their
 * rows rather than guessing.
 *
 * Names are the tables' and columns' names in the database (`token_hash`, not
 * `tokenHash`), because those are what a portable archive carries.
 *
 * @module domains/data/secrets/core-secrets
 */

import { SETUP_CLAIM_META_KEY } from "../../../auth/setup-token/setup-gate";
import { SETUP_TOKEN_META_KEY } from "../../../auth/setup-token/setup-token";
import { digestKeyMetaKey } from "../../../plugins/security/keyed-digest";
import { PRINCIPAL_DIGEST_KEY_META_KEY } from "../../audit/principal-digest";

/**
 * What kind of secret a column holds.
 *
 * - `secret`: never leaves the site, whoever asks.
 * - `sign-in`: a person's sign-in data (a password hash). Left out like a
 *   secret unless the writer asks for sign-in data, which only an encrypted
 *   archive made on request may do.
 */
export type SecretKind = "secret" | "sign-in";

/** One column that holds a secret, and why it counts as one. */
export interface SecretColumn {
  readonly name: string;
  readonly kind: SecretKind;
  readonly why: string;
}

/**
 * The answer one table gives.
 *
 * - `nothing`: no column holds a secret.
 * - `every-row`: the table exists to hold credentials (tokens, keys, codes),
 *   so no row of it leaves the site; a row stripped of its credential would be
 *   a credential-shaped record that no longer works.
 * - `columns`: only the named columns are secret; the rest of the row leaves.
 * - `some-rows`: whether a row is secret depends on one of its own columns,
 *   as a plugin setting's `is_secret` does. A secret row is left out whole.
 */
export type SecretAnswer =
  | { readonly holds: "nothing" }
  | { readonly holds: "every-row"; readonly why: string }
  | { readonly holds: "columns"; readonly columns: readonly SecretColumn[] }
  | {
      readonly holds: "some-rows";
      /** The column whose value decides. */
      readonly decidedBy: string;
      /** Whether a row with this value in `decidedBy` is secret. */
      readonly isSecret: (value: unknown) => boolean;
      readonly why: string;
    };

const NOTHING: SecretAnswer = { holds: "nothing" };

/**
 * A stored flag read as "secret" unless it plainly says otherwise.
 *
 * The three dialects hand a boolean back as `true`, `1` or `"1"` depending on
 * the driver and on whether the row came through Drizzle. Only the spellings of
 * false count as not secret, so a value nobody expected (a null, a new
 * spelling) keeps the row back rather than letting it through.
 */
function flaggedSecret(value: unknown): boolean {
  return !(
    value === false ||
    value === 0 ||
    value === "0" ||
    value === "false"
  );
}

/** The `nextly_meta` keys whose value is a credential or a key. */
export const SECRET_META_KEYS: ReadonlySet<string> = new Set([
  SETUP_TOKEN_META_KEY,
  SETUP_CLAIM_META_KEY,
  PRINCIPAL_DIGEST_KEY_META_KEY,
]);

/**
 * The starts of `nextly_meta` keys that hold one secret per owner: each
 * plugin's digest key. Taken from the function that names those keys, with
 * an empty owner, so the two cannot spell the prefix differently.
 */
export const SECRET_META_KEY_PREFIXES: readonly string[] = [
  digestKeyMetaKey(""),
];

/** Whether a `nextly_meta` row's key names a secret. */
function isSecretMetaKey(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return (
    SECRET_META_KEYS.has(value) ||
    SECRET_META_KEY_PREFIXES.some(prefix => value.startsWith(prefix))
  );
}

/**
 * The answer for every core table, keyed by its name in the database.
 *
 * The field-group registry is keyed by its default name; a guard built for a
 * database that names it otherwise maps that name onto this entry.
 */
export const CORE_SECRET_ANSWERS: Readonly<Record<string, SecretAnswer>> = {
  users: {
    holds: "columns",
    columns: [
      {
        name: "password_hash",
        kind: "sign-in",
        why: "a person's password hash, which only an encrypted archive asked for sign-in data may carry",
      },
    ],
  },
  password_reset_tokens: {
    holds: "every-row",
    why: "each row is a live password-reset token",
  },
  user_invite_tokens: {
    holds: "every-row",
    why: "each row is a live invitation token",
  },
  email_verification_tokens: {
    holds: "every-row",
    why: "each row is a live email-verification token",
  },
  refresh_tokens: {
    holds: "every-row",
    why: "each row is a signed-in session's refresh token",
  },
  roles: NOTHING,
  permissions: NOTHING,
  role_permissions: NOTHING,
  user_roles: NOTHING,
  role_inherits: NOTHING,
  api_keys: {
    holds: "every-row",
    why: "each row is an API key, which works wherever its hash is stored",
  },
  audit_log: NOTHING,
  activity_log: NOTHING,
  media: NOTHING,
  media_folders: NOTHING,
  nextly_meta: {
    holds: "some-rows",
    decidedBy: "key",
    isSecret: isSecretMetaKey,
    why: "the setup token, the setup claim, the audit digest key and each plugin's digest key are kept here beside plain flags",
  },
  nextly_field_group_lock: NOTHING,
  nextly_schema_lock: NOTHING,
  nextly_document_lock: {
    holds: "columns",
    columns: [
      {
        name: "claim_token",
        kind: "secret",
        why: "the token that lets its holder act as the editor holding the lock",
      },
    ],
  },
  nextly_rbac_epoch: NOTHING,
  nextly_deleted_principals: NOTHING,
  nextly_plugin_settings: {
    holds: "some-rows",
    decidedBy: "is_secret",
    isSecret: flaggedSecret,
    why: "a plugin marks the settings it declared secret, and their values are sealed under the site's secret",
  },
  nextly_one_time_secrets: {
    holds: "every-row",
    why: "each row is a one-time link or code a plugin issued",
  },
  // Its claim token is a lease only the server holds, like the job and
  // delivery leases beside it: nothing outside the server is handed it.
  nextly_received_webhooks: NOTHING,
  nextly_plugin_events: NOTHING,
  nextly_plugin_event_deliveries: NOTHING,
  nextly_limit_store: NOTHING,
  nextly_cache_tag_expiries: NOTHING,
  nextly_spent_challenges: NOTHING,
  nextly_schema_owners: NOTHING,
  nextly_widget_layout: NOTHING,
  dynamic_collections: NOTHING,
  dynamic_singles: NOTHING,
  dynamic_components: NOTHING,
  site_settings: NOTHING,
  user_field_definitions: NOTHING,
  email_providers: {
    holds: "columns",
    columns: [
      {
        name: "configuration",
        kind: "secret",
        why: "the provider's settings, its password or API key among them, sealed as one value",
      },
    ],
  },
  email_templates: NOTHING,
  email_deliveries: NOTHING,
  email_brand: NOTHING,
  nextly_external_identities: NOTHING,
  email_send_claims: NOTHING,
  email_queue: {
    holds: "columns",
    columns: [
      {
        name: "message",
        kind: "secret",
        why: "a queued email, sealed, which may carry a sign-in or reset link",
      },
    ],
  },
  email_queue_recipients: NOTHING,
  nextly_schema_events: NOTHING,
  nextly_i18n_archive: NOTHING,
  nextly_versions: NOTHING,
  nextly_version_views: NOTHING,
  nextly_review_states: NOTHING,
  nextly_workflow_settings: NOTHING,
  nextly_translation_provenance: NOTHING,
  nextly_translation_sources: NOTHING,
  nextly_schedule_windows: NOTHING,
  nextly_content_events: NOTHING,
  nextly_content_event_parts: NOTHING,
  nextly_preview_links: NOTHING,
  nextly_languages: NOTHING,
  nextly_releases: NOTHING,
  nextly_release_members: NOTHING,
  nextly_version_pins: NOTHING,
  nextly_jobs: {
    holds: "columns",
    columns: [
      {
        name: "input",
        kind: "secret",
        why: "what a job was given, which core cannot read and a plugin may fill with a live link or code",
      },
    ],
  },
  nextly_events: NOTHING,
  nextly_webhooks: {
    holds: "columns",
    columns: [
      {
        name: "secret_hash",
        kind: "secret",
        why: "the endpoint's signing secrets, encrypted, which sign every delivery",
      },
      {
        name: "secret_prefix",
        kind: "secret",
        why: "the first characters of the signing secret",
      },
      {
        name: "headers",
        kind: "secret",
        why: "headers sent with every delivery, where a receiver's own credential is usually put",
      },
    ],
  },
  nextly_webhook_deliveries: NOTHING,
  nextly_notices: NOTHING,
  nextly_dashboard_pins: NOTHING,
  nextly_dashboard_preferences: NOTHING,
  nextly_media_usage: NOTHING,
};
