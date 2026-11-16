/**
 * Every schema operation an existing install meets when it upgrades from the
 * baseline's release (`baseline/meta.json`) to this checkout, each with the
 * reason it is safe. `upgrade-plan.integration.test.ts` fails when the upgrade
 * plans an operation that is not here, or no longer plans one that is.
 *
 * An entry is added in the change that makes the upgrade plan it, by someone
 * who has judged what it does to a site's data, and removed when the baseline
 * is next recorded from a release that already ships it. The operations are
 * written as `operationsBetween` in `catalog.ts` writes them, and the gate's
 * failure prints each new one ready to paste. Where the dialects spell an
 * operation differently, each spelling is an entry of its own.
 */
import type { AllowedOperation } from "./catalog";

/** Why the role index is safe: an index on an existing column, no row changes. */
const ROLE_INDEX =
  "The index on user_roles.role_id that the last-super-admin check reads by. It adds an index over an existing column and changes no row.";

/** Why the version history's new column is safe. */
const FIELD_SOURCES =
  "A REST restore records, on the version it writes, which version each restored field came from. The column is new and nullable, so existing versions read as recording no sources.";

/**
 * The form builder's own collections, which it declares and which upgrade with
 * it. Each is the plugin's declaration changing, as an app's config change
 * would, not Nextly deriving something new from an unchanged declaration.
 */
const FORM_BUILDER_SENDS =
  "The form builder now queues each notification of a submission as a row, and records each resend. New tables of the plugin's own; nothing existing moves.";
const FORM_BUILDER_UPLOADS =
  "The form builder now records the files a submission uploaded, so deleting the submission deletes them. A new table of the plugin's own.";
const FORM_BUILDER_PAGE =
  "A submission now keeps the page it was sent from. New and nullable: existing submissions read as sent from no recorded page.";
const FORM_BUILDER_ASKED =
  "A submission now keeps the questions it was asked, as the form stood when it was answered. New and nullable: existing submissions hold none, and keep every answer they had.";
const FORM_BUILDER_TITLE =
  "The submission's title became a declared, optional field. Dropping NOT NULL keeps every existing value and refuses nothing a site wrote before.";

export const ALLOWED_OPERATIONS: readonly AllowedOperation[] = [
  {
    operation: "create index user_roles.user_roles_role_id_idx: (role_id)",
    dialects: ["sqlite"],
    reason: ROLE_INDEX,
  },
  {
    operation:
      "create index user_roles.user_roles_role_id_idx: USING btree (role_id)",
    dialects: ["postgresql"],
    reason: ROLE_INDEX,
  },
  {
    operation:
      "create index user_roles.user_roles_role_id_idx: btree (role_id)",
    dialects: ["mysql"],
    reason: ROLE_INDEX,
  },
  {
    operation: "add column nextly_versions.field_sources: text null",
    dialects: ["sqlite"],
    reason: FIELD_SOURCES,
  },
  {
    operation: "add column nextly_versions.field_sources: jsonb null",
    dialects: ["postgresql"],
    reason: FIELD_SOURCES,
  },
  {
    operation: "add column nextly_versions.field_sources: json null",
    dialects: ["mysql"],
    reason: FIELD_SOURCES,
  },
  {
    operation: "create table dc_form_submission_sends",
    reason: FORM_BUILDER_SENDS,
  },
  {
    operation: "create table dc_form_submission_resends",
    reason: FORM_BUILDER_SENDS,
  },
  {
    operation: "create table dc_form_uploads",
    reason: FORM_BUILDER_UPLOADS,
  },
  {
    operation: "add column dc_form_submissions.page: text null",
    dialects: ["sqlite", "postgresql"],
    reason: FORM_BUILDER_PAGE,
  },
  {
    operation:
      "add column dc_form_submissions.page: text null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_BUILDER_PAGE,
  },
  {
    operation: "add column dc_form_submissions.asked: text null",
    dialects: ["sqlite"],
    reason: FORM_BUILDER_ASKED,
  },
  {
    operation: "add column dc_form_submissions.asked: jsonb null",
    dialects: ["postgresql"],
    reason: FORM_BUILDER_ASKED,
  },
  {
    operation: "add column dc_form_submissions.asked: json null",
    dialects: ["mysql"],
    reason: FORM_BUILDER_ASKED,
  },
  {
    operation:
      "change column dc_form_submissions.title: text not null -> text null",
    dialects: ["sqlite", "postgresql"],
    reason: FORM_BUILDER_TITLE,
  },
  {
    operation:
      "change column dc_form_submissions.title: varchar(255) not null collate utf8mb4_0900_ai_ci -> varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_BUILDER_TITLE,
  },
];
