/**
 * The names of the core tables the framework manages, as a list of names
 * alone.
 *
 * A module of its own, apart from `core-schema.ts`, because the readers that
 * only ask whether a table is a core one (the drop guard, an extension's
 * publish, the migrate commands) need the names and none of the tables'
 * definitions, which `core-schema.ts` loads for every dialect. Each name comes
 * from its table's own name module, and `core-schema.ts` re-exports the list.
 */

import { CACHE_TAG_EXPIRIES_TABLE } from "./cache-tag-expiries/table-name";
import { CLI_CREDENTIALS_TABLE } from "./cli-credentials/table-name";
import { DELETED_PRINCIPALS_TABLE } from "./deleted-principals/table-name";
import { EMAIL_QUEUE_TABLE } from "./email-queue/table-name";
import { EMAIL_QUEUE_RECIPIENTS_TABLE } from "./email-queue-recipients/table-name";
import { EMAIL_SEND_CLAIMS_TABLE } from "./email-send-claims/table-name";
import { EXTERNAL_IDENTITIES_TABLE } from "./external-identities/table-name";
import { LIMIT_STORE_TABLE } from "./limit-store/table-name";
import { ONE_TIME_SECRETS_TABLE } from "./one-time-secrets/table-name";
import {
  PLUGIN_EVENTS_TABLE,
  PLUGIN_EVENT_DELIVERIES_TABLE,
} from "./plugin-events/table-name";
import { PLUGIN_SETTINGS_TABLE } from "./plugin-settings/table-name";
import { RBAC_EPOCH_TABLE } from "./rbac-epoch/table-name";
import { RECEIVED_WEBHOOKS_TABLE } from "./received-webhooks/table-name";
import { SCHEMA_OWNERS_TABLE } from "./schema-owners/table-name";
import { SPENT_CHALLENGES_TABLE } from "./spent-challenges/table-name";
import { STORAGE_FORMAT } from "./storage-format";

/** Snake-case names of every core table the framework manages. */
export const CORE_TABLE_NAMES: readonly string[] = [
  "users",
  "password_reset_tokens",
  "user_invite_tokens",
  "email_verification_tokens",
  "refresh_tokens",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "role_inherits",
  "api_keys",
  "audit_log",
  "activity_log",
  "media",
  "media_folders",
  "nextly_meta",
  // Read by live introspection. Absent here, the table is created and then invisible to every
  // snapshot, so the drift check proposes adding it again on every run.
  "nextly_field_group_lock",
  "nextly_schema_lock",
  "nextly_document_lock",
  RBAC_EPOCH_TABLE,
  DELETED_PRINCIPALS_TABLE,
  PLUGIN_SETTINGS_TABLE,
  ONE_TIME_SECRETS_TABLE,
  RECEIVED_WEBHOOKS_TABLE,
  PLUGIN_EVENTS_TABLE,
  PLUGIN_EVENT_DELIVERIES_TABLE,
  LIMIT_STORE_TABLE,
  CLI_CREDENTIALS_TABLE,
  CACHE_TAG_EXPIRIES_TABLE,
  SPENT_CHALLENGES_TABLE,
  SCHEMA_OWNERS_TABLE,
  "nextly_widget_layout",
  "dynamic_collections",
  "dynamic_singles",
  STORAGE_FORMAT.registryTable,
  "site_settings",
  "user_field_definitions",
  "email_providers",
  "email_templates",
  "email_deliveries",
  "email_brand",
  EXTERNAL_IDENTITIES_TABLE,
  EMAIL_SEND_CLAIMS_TABLE,
  EMAIL_QUEUE_TABLE,
  EMAIL_QUEUE_RECIPIENTS_TABLE,
  "nextly_schema_events",
  "nextly_i18n_archive",
  "nextly_versions",
  "nextly_version_views",
  "nextly_review_states",
  "nextly_workflow_settings",
  "nextly_translation_provenance",
  "nextly_translation_sources",
  "nextly_schedule_windows",
  "nextly_content_events",
  "nextly_content_event_parts",
  "nextly_preview_links",
  "nextly_languages",
  "nextly_releases",
  "nextly_release_members",
  "nextly_version_pins",
  "nextly_jobs",
  "nextly_events",
  "nextly_webhooks",
  "nextly_webhook_deliveries",
  "nextly_notices",
  "nextly_dashboard_pins",
  "nextly_dashboard_preferences",
  "nextly_media_usage",
] as const;
