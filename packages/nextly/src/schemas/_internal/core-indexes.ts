/**
 * The indexes of the extendable core tables, described once for all three
 * dialects.
 *
 * Each dialect's table module passes its table's description through the
 * function that turns one into that dialect's Drizzle index builders
 * (`core-indexes-postgres`, `core-indexes-mysql`, `core-indexes-sqlite`), so an
 * index is declared in one place and a dialect cannot come to carry a different
 * set by an edit made to one file. Those functions are apart, and this imports
 * nothing, so that a dialect's tables load that dialect alone.
 *
 * @module schemas/_internal/core-indexes
 */
/** One index: its name and the column KEYS it covers, in order. */
export interface CoreIndex<K extends string> {
  readonly name: string;
  readonly columns: readonly [K, ...K[]];
  readonly unique?: true;
}

export const USERS_INDEXES = [
  { name: "users_email_unique", columns: ["email"], unique: true },
  { name: "users_created_at_idx", columns: ["createdAt"] },
] as const satisfies readonly CoreIndex<string>[];

// Performance indexes for common queries.
export const MEDIA_INDEXES = [
  // Filter by uploader.
  { name: "media_uploaded_by_idx", columns: ["uploadedBy"] },
  // Filter by file type (image/*, video/*, ...).
  { name: "media_mime_type_idx", columns: ["mimeType"] },
  // Sort by upload date.
  { name: "media_uploaded_at_idx", columns: ["uploadedAt"] },
  // Filter by folder.
  { name: "media_folder_id_idx", columns: ["folderId"] },
] as const satisfies readonly CoreIndex<string>[];

export const NEXTLY_JOBS_INDEXES = [
  // The due-job query reads exactly these two columns together.
  { name: "nextly_jobs_due_idx", columns: ["state", "runAt"] },
  // Ordering index for the recent-jobs read, which sorts the whole table by
  // `updatedAt` before its small limit applies. Without it that is a full
  // scan and sort on every monitoring request, and it degrades with queue
  // volume rather than staying bounded — the due index above cannot serve it,
  // because its leading column is `state`.
  //
  // A DECLARATION IS NOT AN UPGRADE PATH. A fresh install gets this index
  // when the table is pushed; an existing one does not, because
  // `drizzleTableToTableSpec` records only names and columns, so index-only
  // drift produces no operations and `reconcileCore` returns early before the
  // push that would create it. SQLite is repaired by the hand-written core
  // DDL in `database/sqlite-core-tables.ts`, which re-runs idempotently;
  // PostgreSQL and MySQL need a general core index-repair step in
  // `nextly upgrade`, which is filed rather than built here — see
  // `schemas/nextly-i18n-archive/ddl.ts` for the same problem solved for one
  // table.
  { name: "nextly_jobs_recent_idx", columns: ["updatedAt"] },
  { name: "nextly_jobs_dedupe_idx", columns: ["dedupeKey"], unique: true },
] as const satisfies readonly CoreIndex<string>[];

export const AUDIT_LOG_INDEXES = [
  { name: "audit_log_kind_idx", columns: ["kind"] },
  { name: "audit_log_actor_user_id_idx", columns: ["actorUserId"] },
  { name: "audit_log_target_user_id_idx", columns: ["targetUserId"] },
  { name: "audit_log_created_at_idx", columns: ["createdAt"] },
  // The two scans a person's deletion makes: rows they acted on, and rows
  // naming them as the subject.
  {
    name: "audit_log_actor_principal_idx",
    columns: ["actorPrincipalKind", "actorPrincipalId"],
  },
  {
    name: "audit_log_target_principal_idx",
    columns: ["targetPrincipalKind", "targetPrincipalId"],
  },
] as const satisfies readonly CoreIndex<string>[];

export const ACTIVITY_LOG_INDEXES = [
  { name: "idx_activity_log_created_at", columns: ["createdAt"] },
  { name: "idx_activity_log_collection", columns: ["collection", "createdAt"] },
  { name: "idx_activity_log_user_id", columns: ["userId", "createdAt"] },
] as const satisfies readonly CoreIndex<string>[];

export const NOTICES_INDEXES = [
  // Once per occurrence: the digest of person, kind, subject and occurrence.
  { name: "nextly_notices_dedupe_uidx", columns: ["dedupeKey"], unique: true },
  // A person's unread list and count, in the order it pages: newest first,
  // ties by id.
  {
    name: "nextly_notices_user_idx",
    columns: ["userId", "readAt", "createdAt", "id"],
  },
  // A person's whole list, in the order it pages: newest first, ties by id.
  {
    name: "nextly_notices_inbox_idx",
    columns: ["userId", "createdAt", "id"],
  },
  // Which notices are about a subject, so a deleted subject reads as gone.
  {
    name: "nextly_notices_subject_idx",
    columns: ["subjectType", "subjectId"],
  },
  // Retention removes the oldest first.
  { name: "nextly_notices_created_idx", columns: ["createdAt"] },
] as const satisfies readonly CoreIndex<string>[];

export const DASHBOARD_PINS_INDEXES = [
  // One pin per reader per target. A Single's `entryId` is "" rather than
  // NULL, so this holds on every dialect: NULLs are distinct in a unique index,
  // and a partial index is not dialect-neutral.
  {
    name: "nextly_dashboard_pins_target_uidx",
    columns: ["userId", "targetType", "targetSlug", "entryId"],
    unique: true,
  },
  // A reader's pins, in the order they are listed: newest first.
  {
    name: "nextly_dashboard_pins_user_idx",
    columns: ["userId", "pinnedAt"],
  },
  // The pins that point at a target, so deleting an entry or a Single can
  // remove every reader's pin of it.
  {
    name: "nextly_dashboard_pins_entry_idx",
    columns: ["targetType", "targetSlug", "entryId"],
  },
] as const satisfies readonly CoreIndex<string>[];

export const MEDIA_USAGE_INDEXES = [
  // One row per item per field per language of a document. It also serves
  // replacing a document's rows, which reads them by its leading columns.
  {
    name: "nextly_media_usage_uidx",
    columns: [
      "subjectKind",
      "subjectSlug",
      "documentId",
      "fieldPath",
      "locale",
      "mediaId",
    ],
    unique: true,
  },
  // Where one item is used, and whether it is used at all: the Unused view
  // and its count ask this of every item.
  { name: "nextly_media_usage_media_idx", columns: ["mediaId"] },
] as const satisfies readonly CoreIndex<string>[];

export const TRANSLATION_PROVENANCE_INDEXES = [
  // One row per field of a language of a document, live or drafted. It also
  // serves reading or replacing a document's rows by its leading columns.
  {
    name: "nextly_translation_provenance_uidx",
    columns: [
      "scopeKind",
      "scopeSlug",
      "entryId",
      "locale",
      "partState",
      "fieldPath",
    ],
    unique: true,
  },
  // The source language's row for one field of a document, which judges
  // whether every other language's value made from it is out of date.
  {
    name: "nextly_translation_provenance_field_idx",
    columns: ["scopeKind", "scopeSlug", "entryId", "fieldPath", "partState"],
  },
] as const satisfies readonly CoreIndex<string>[];

export const TRANSLATION_SOURCES_INDEXES = [
  // One row per version of one field's source text, found by the columns a
  // translation's provenance names its source by. It also serves reading or
  // removing a document's rows by its leading columns.
  {
    name: "nextly_translation_sources_uidx",
    columns: [
      "scopeKind",
      "scopeSlug",
      "entryId",
      "sourceLocale",
      "fieldPath",
      "fingerprint",
    ],
    unique: true,
  },
] as const satisfies readonly CoreIndex<string>[];

export const DASHBOARD_PREFERENCES_INDEXES = [
  // One value per reader per key.
  {
    name: "nextly_dashboard_preferences_key_uidx",
    columns: ["userId", "key"],
    unique: true,
  },
] as const satisfies readonly CoreIndex<string>[];

export const EXTERNAL_IDENTITIES_INDEXES = [
  // One identity per provider key, issuer and subject, enforced by the
  // digest of the three rather than by the three themselves
  // (`externalIdentityKeyDigest`): a digest has nothing a collation could
  // fold — MySQL compares TEXT case-insensitively and even its `_bin`
  // collations pad trailing spaces away — and one 64-character index fits
  // every InnoDB page size, where an index over the columns would not. The
  // digest is plain SHA-256, so it survives any secret rotation; with
  // "no issuer" spelled "" once, one subject from two issuers of one key is
  // two rows, and a second row for an issuerless key and subject is refused
  // on every dialect alike.
  {
    name: "nextly_external_identities_key_uidx",
    columns: ["keyDigest"],
    unique: true,
  },
  // One user's identities: listed by their owner, and removed with the
  // account.
  { name: "nextly_external_identities_user_idx", columns: ["userId"] },
] as const satisfies readonly CoreIndex<string>[];

export const NEXTLY_RELEASES_INDEXES = [
  // The due-release query reads exactly these two columns together.
  { name: "nextly_releases_due_idx", columns: ["state", "scheduledAt"] },
  // The calendar and the list's day filter read a range of instants whatever
  // the state: a release is placed by `scheduledAt`, or by `publishedAt` once
  // published. The due index leads with `state`, so a range on either instant
  // needs an index that leads with it.
  { name: "nextly_releases_scheduled_idx", columns: ["scheduledAt"] },
  { name: "nextly_releases_published_idx", columns: ["publishedAt"] },
] as const satisfies readonly CoreIndex<string>[];

export const TRASH_INDEXES = [
  // A trashed item found by its collection and its own id, as a restore by
  // id and a list of one collection's trash read it.
  { name: "nextly_trash_item_idx", columns: ["scopeSlug", "itemId"] },
  // The items past their purge date, which the daily clean-up removes.
  { name: "nextly_trash_purge_idx", columns: ["purgeAt"] },
  // The list, newest first.
  { name: "nextly_trash_trashed_at_idx", columns: ["trashedAt"] },
  // Whether a deletion's history is still held by an entry in the trash,
  // which the history's retention asks before removing it.
  { name: "nextly_trash_deleted_event_idx", columns: ["deletedEventId"] },
] as const satisfies readonly CoreIndex<string>[];
