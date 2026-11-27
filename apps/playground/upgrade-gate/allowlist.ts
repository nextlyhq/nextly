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

/**
 * The form builder's record fields stop being translated (#5104): a
 * submission's spam reason, notes, IP address, user agent, page, editor and
 * title, and the text fields of its sends, resend requests and uploads. Each
 * gets its column on the entity's own table back, filled with the default
 * language's value before any setting it carries is applied; any other
 * language's value is copied to the localization archive; then its column in
 * the translations table is dropped, under the consent in `UPGRADE_CONSENT`.
 * `upgrade-plan.integration.test.ts` checks every seeded value is still kept.
 */
const FORM_RECORD_SHARED =
  "A form builder record field stops being translated: its default-language value moves to the entity's own table and other languages go to the localization archive before its translations column is dropped, with consent. No value is lost.";

/** Why a submission's form column becomes nullable. */
const FORM_ID_NULLABLE =
  "A submission's form column becomes nullable (#5104), so an installation holding a submission without one can upgrade; the form builder refuses a submission without its form when it is written. Dropping NOT NULL keeps every value.";

/**
 * The columns the upgrade removes, each once its values are kept elsewhere:
 * the form builder's record fields (a submission's spam reason, notes, IP
 * address, user agent, page, editor and title; the text fields of its sends,
 * resend requests and uploads) stop being translated, so each field's
 * default-language value moves back to its entity's own table, any other
 * language's value goes to the localization archive, and its column in the
 * translations table is dropped. The gate passes exactly these as
 * `--accept-data-loss`, so a deletion beyond them is refused, and
 * `upgrade-plan.integration.test.ts` checks every value is still kept after.
 * The same on every dialect.
 */
export const UPGRADE_CONSENT: readonly string[] = [
  "dc_form_submissions_locales.spam_reason",
  "dc_form_submissions_locales.notes",
  "dc_form_submissions_locales.ip_address",
  "dc_form_submissions_locales.user_agent",
  "dc_form_submissions_locales.page",
  "dc_form_submissions_locales.edited_by",
  "dc_form_submissions_locales.title",
  "dc_form_submission_sends_locales.send_key",
  "dc_form_submission_sends_locales.notification_name",
  "dc_form_submission_sends_locales.state",
  "dc_form_submission_sends_locales.retired_by",
  "dc_form_submission_sends_locales.requested_by",
  "dc_form_submission_sends_locales.resend",
  "dc_form_uploads_locales.field",
  "dc_form_submission_resends_locales.notification",
  "dc_form_submission_resends_locales.requested_by",
];

/** Why the table keeping the source text of translations is created. */
const TRANSLATION_SOURCES_KEPT =
  "The source text each translation is made from is kept from the first translation saved after the upgrade. The table is new, so nothing an installation held lives in it.";

/** Why a media record's fingerprint column is added. */
const MEDIA_FINGERPRINT_ADDED =
  "A media record gains the SHA-256 of its stored file. The column is new and nullable, so every existing record keeps every value it had and reads as having no fingerprint until the background job fills it.";

/** Why the index on a media record's fingerprint is created. */
const MEDIA_FINGERPRINT_INDEXED =
  "Finds the records of one stored file by its fingerprint. Not unique, since two records may share one file, so it refuses no existing row; an index changes no stored value.";

export const ALLOWED_OPERATIONS: readonly AllowedOperation[] = [
  {
    operation: "add column media.sha256: text null",
    dialects: ["sqlite"],
    reason: MEDIA_FINGERPRINT_ADDED,
  },
  {
    operation: "add column media.sha256: character varying(64) null",
    dialects: ["postgresql"],
    reason: MEDIA_FINGERPRINT_ADDED,
  },
  {
    operation:
      "add column media.sha256: varchar(64) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: MEDIA_FINGERPRINT_ADDED,
  },
  {
    operation: "create index media.media_sha256_idx: (sha256)",
    dialects: ["sqlite"],
    reason: MEDIA_FINGERPRINT_INDEXED,
  },
  {
    operation: "create index media.media_sha256_idx: USING btree (sha256)",
    dialects: ["postgresql"],
    reason: MEDIA_FINGERPRINT_INDEXED,
  },
  {
    operation: "create index media.media_sha256_idx: btree (sha256)",
    dialects: ["mysql"],
    reason: MEDIA_FINGERPRINT_INDEXED,
  },
  {
    operation: "create table nextly_translation_sources",
    reason: TRANSLATION_SOURCES_KEPT,
  },
  {
    operation:
      "add column dc_form_submission_resends.notification: text not null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submission_resends.requested_by: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.notification_name: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submission_sends.requested_by: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submission_sends.resend: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submission_sends.retired_by: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submission_sends.send_key: text not null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submission_sends.state: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.edited_by: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.ip_address: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.notes: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.page: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.spam_reason: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.title: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_submissions.user_agent: text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "add column dc_form_uploads.field: text not null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "change column dc_form_submissions.form: text not null -> text null",
    dialects: ["postgresql", "sqlite"],
    reason: FORM_ID_NULLABLE,
  },
  {
    operation: "drop column dc_form_submission_resends_locales.notification",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_resends_locales.requested_by",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_sends_locales.notification_name",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_sends_locales.requested_by",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_sends_locales.resend",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_sends_locales.retired_by",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_sends_locales.send_key",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submission_sends_locales.state",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.edited_by",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.ip_address",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.notes",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.page",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.spam_reason",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.title",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_submissions_locales.user_agent",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation: "drop column dc_form_uploads_locales.field",
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_resends.notification: varchar(255) not null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_resends.requested_by: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.notification_name: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.requested_by: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.resend: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.retired_by: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.send_key: varchar(255) not null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submission_sends.state: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.edited_by: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.ip_address: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.notes: text null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.page: text null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.spam_reason: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.title: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_submissions.user_agent: varchar(255) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "add column dc_form_uploads.field: varchar(255) not null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_RECORD_SHARED,
  },
  {
    operation:
      "change column dc_form_submissions.form: varchar(36) not null collate utf8mb4_0900_ai_ci -> varchar(36) null collate utf8mb4_0900_ai_ci",
    dialects: ["mysql"],
    reason: FORM_ID_NULLABLE,
  },
];
