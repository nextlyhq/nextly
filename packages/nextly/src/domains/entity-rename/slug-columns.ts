/**
 * Every column in Nextly's core tables that holds a slug, and what renaming a
 * collection or Single does to the rows it keys.
 *
 * History, markers, events and release members are keyed by the slug of the
 * entity they belong to, not by its registry id: code-first entities are
 * identified by slug in config, so a registry id is not a stable identity
 * across databases. A rename therefore has to move those rows itself, or they
 * stay behind under the old slug, out of reach of the renamed entity and
 * waiting for the next entity created under that slug to inherit them.
 *
 * This list is how a table declares that it is keyed by slug. The rename reads
 * it and nothing else, so a table added here is moved by every rename, and a
 * table missing from it is caught by the test that reads every slug-holding
 * column out of the core schema and asks this list about each one.
 *
 * What a rename does to a declared column is one of three things:
 *
 * - `follow`: the rows move to the new slug in the rename's transaction, and a
 *   key column digested from the slug is computed again for each row.
 * - `end`: the rows are deleted in the rename's transaction. For leases and
 *   links addressed to the old name, which cannot be honoured under the new
 *   one: keeping them would hand them to a later entity under the old slug.
 * - `keep`: the column holds a slug that is not an entity's, or a record that
 *   must read as it was written. The reason is part of the declaration.
 *
 * Column names are SQL names, the ones the core schema declares.
 *
 * @module domains/entity-rename/slug-columns
 */

import { NextlyError } from "../../errors";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { releaseMemberKey } from "../releases/release-member-key";
import { versionPinKey } from "../versions/version-pins";
import { versionViewKey } from "../versions/version-views";
import { workingDraftKey } from "../versions/working-draft-key";

/** What can be renamed: a collection or a Single. */
export type RenamedEntityKind = "collection" | "single";

/** One row as the rename reads it, by SQL column name. */
export type SlugKeyedRow = Readonly<Record<string, unknown>>;

/**
 * A column holding a digest of the row's identity, the slug among its inputs.
 * Rows whose key is NULL keep it NULL; the others get the digest of their own
 * columns with the new slug.
 */
export interface SlugKeyColumn {
  /** The digest column. */
  column: string;
  /** The column a row is addressed by when its new key is written. */
  rowId: string;
  /** The columns, besides the kind and the slug, the digest is made from. */
  sources: readonly string[];
  /** The digest of `row` under `slug`, from the function every writer uses. */
  derive(row: SlugKeyedRow, slug: string): string;
}

/** Where the entity's kind and slug are, and which stored kinds name it. */
interface EntityScopedColumn {
  table: string;
  kindColumn: string;
  slugColumn: string;
  /**
   * The values `kindColumn` holds for each kind of entity. `null` is listed
   * where the table's own readers take a NULL kind to mean that kind.
   */
  kinds: Readonly<Record<RenamedEntityKind, readonly (string | null)[]>>;
}

/** Rows that move to the new slug. */
export interface FollowingSlugColumn extends EntityScopedColumn {
  onRename: "follow";
  key?: SlugKeyColumn;
}

/** Rows that a rename deletes. */
export interface EndingSlugColumn extends EntityScopedColumn {
  onRename: "end";
  reason: string;
}

/** A slug a rename leaves where it is. */
export interface KeptSlugColumn {
  table: string;
  slugColumn: string;
  onRename: "keep";
  reason: string;
}

export type SlugColumn =
  | FollowingSlugColumn
  | EndingSlugColumn
  | KeptSlugColumn;

/** A column a rename moves or deletes rows by. */
export type RenamedSlugColumn = FollowingSlugColumn | EndingSlugColumn;

/** A text column's value, refusing the rename on a row that has none. */
function textOf(row: SlugKeyedRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw NextlyError.internal({
      logContext: {
        reason: "slug-keyed-row-missing-text",
        column,
        valueType: typeof value,
      },
    });
  }
  return value;
}

/** A nullable text column's value. */
function textOrNullOf(row: SlugKeyedRow, column: string): string | null {
  return row[column] === null || row[column] === undefined
    ? null
    : textOf(row, column);
}

/** A history row's scope kind, as the key functions take it. */
function scopeKindOf(row: SlugKeyedRow, column: string): VersionScopeKind {
  const value = textOf(row, column);
  if (value === "collection" || value === "single" || value === "page") {
    return value;
  }
  throw NextlyError.internal({
    logContext: { reason: "slug-keyed-row-unknown-kind", column, value },
  });
}

/** How every history table spells the two kinds a rename moves. */
const SCOPE_KINDS = {
  collection: ["collection"],
  single: ["single"],
} as const;

/**
 * Every slug-holding column of the core schema. The order is the order a
 * rename writes in, which matters for nothing but readability: one transaction
 * holds them all.
 */
export const SLUG_COLUMNS: readonly SlugColumn[] = [
  {
    // Versions, autosaves and working drafts. Only a working draft carries a
    // `draft_key`; durable and autosave rows keep theirs NULL.
    table: "nextly_versions",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
    kinds: SCOPE_KINDS,
    onRename: "follow",
    key: {
      column: "draft_key",
      rowId: "id",
      sources: ["entry_id", "locale"],
      derive: (row, slug) =>
        workingDraftKey(
          {
            scopeKind: scopeKindOf(row, "scope_kind"),
            scopeSlug: slug,
            entryId: textOf(row, "entry_id"),
          },
          textOrNullOf(row, "locale")
        ),
    },
  },
  {
    // The versions a feature holds against retention, one row per slot.
    table: "nextly_version_pins",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
    kinds: SCOPE_KINDS,
    onRename: "follow",
    key: {
      column: "pin_key",
      rowId: "id",
      sources: ["entry_id", "holder", "slot"],
      derive: (row, slug) =>
        versionPinKey(
          {
            scopeKind: scopeKindOf(row, "scope_kind"),
            scopeSlug: slug,
            entryId: textOf(row, "entry_id"),
          },
          textOf(row, "holder"),
          textOf(row, "slot")
        ),
    },
  },
  {
    // Each person's "last looked at" marker, per document and part.
    table: "nextly_version_views",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
    kinds: SCOPE_KINDS,
    onRename: "follow",
    key: {
      column: "view_key",
      rowId: "id",
      sources: ["user_id", "entry_id", "part"],
      derive: (row, slug) =>
        versionViewKey({
          userId: textOf(row, "user_id"),
          ref: {
            scopeKind: scopeKindOf(row, "scope_kind"),
            scopeSlug: slug,
            entryId: textOf(row, "entry_id"),
          },
          part: textOrNullOf(row, "part"),
        }),
    },
  },
  {
    // The record of content events. Each event's parts are keyed by the
    // event's id, so they move with it.
    table: "nextly_content_events",
    kindColumn: "subject_kind",
    slugColumn: "subject_slug",
    kinds: SCOPE_KINDS,
    onRename: "follow",
  },
  {
    // The documents a release holds.
    table: "nextly_release_members",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
    kinds: SCOPE_KINDS,
    onRename: "follow",
    key: {
      column: "member_key",
      rowId: "id",
      sources: ["release_id", "entry_id", "locale"],
      derive: (row, slug) =>
        releaseMemberKey(textOf(row, "release_id"), {
          scopeKind: scopeKindOf(row, "scope_kind"),
          scopeSlug: slug,
          entryId: textOf(row, "entry_id"),
          locale: textOrNullOf(row, "locale"),
        }),
    },
  },
  {
    // The schema changes recorded against the entity.
    table: "nextly_schema_events",
    kindColumn: "scope_kind",
    slugColumn: "scope_slug",
    kinds: SCOPE_KINDS,
    onRename: "follow",
  },
  {
    // The dashboard's activity feed. Its readers take a NULL kind, which rows
    // written before the kind was recorded carry, to be a collection's.
    table: "activity_log",
    kindColumn: "subject_kind",
    slugColumn: "collection",
    kinds: { collection: ["collection", null], single: ["single"] },
    onRename: "follow",
  },
  {
    // Translations kept when localization was turned off, to restore if it is
    // turned on again. Rows archived before the kind was recorded say
    // `unknown` or `unresolved` and are left where they are: their owner cannot
    // be told from the slug alone, which a field group may share.
    table: "nextly_i18n_archive",
    kindColumn: "entity_kind",
    slugColumn: "collection",
    kinds: SCOPE_KINDS,
    onRename: "follow",
  },
  {
    table: "nextly_document_lock",
    kindColumn: "scope_kind",
    slugColumn: "slug",
    kinds: SCOPE_KINDS,
    onRename: "end",
    reason:
      "A lock is a short lease on a document open under the old slug. The editor holding it can no longer save there, and the row's id is made from the slug.",
  },
  {
    table: "nextly_preview_links",
    kindColumn: "document_kind",
    slugColumn: "document_slug",
    kinds: { collection: ["entry"], single: ["single"] },
    onRename: "end",
    reason:
      "A preview link's signed token names the old slug and is only honoured while its row names the same document. Moved, the row would be listed as live under the new slug while its token could never open; kept, it would open whatever is next created under the old slug.",
  },
  {
    table: "nextly_events",
    slugColumn: "resource_collection",
    onRename: "keep",
    reason:
      "An event in the outbox is a message as it was sent: its payload names the slug it was sent under, and receivers have already been given that slug.",
  },
  {
    table: "dynamic_collections",
    slugColumn: "slug",
    onRename: "keep",
    reason: "The collection registry: the rename itself writes this column.",
  },
  {
    table: "dynamic_singles",
    slugColumn: "slug",
    onRename: "keep",
    reason: "The Single registry: the rename itself writes this column.",
  },
  {
    table: STORAGE_FORMAT.registryTable,
    slugColumn: "slug",
    onRename: "keep",
    reason: "A field group's own slug, which no collection or Single shares.",
  },
  {
    table: "roles",
    slugColumn: "slug",
    onRename: "keep",
    reason: "A role's own slug.",
  },
  {
    table: "permissions",
    slugColumn: "slug",
    onRename: "keep",
    reason: "A permission's own slug, such as `read-posts`.",
  },
  {
    table: "email_templates",
    slugColumn: "slug",
    onRename: "keep",
    reason: "An email template's own slug.",
  },
  {
    table: "email_deliveries",
    slugColumn: "template_slug",
    onRename: "keep",
    reason: "The email template a delivery was sent from.",
  },
  {
    table: "nextly_jobs",
    slugColumn: "slug",
    onRename: "keep",
    reason: "A job's own slug.",
  },
];

/** The declared columns a rename acts on, in the order it writes them. */
export function renamedSlugColumns(): RenamedSlugColumn[] {
  return SLUG_COLUMNS.filter(
    (column): column is RenamedSlugColumn => column.onRename !== "keep"
  );
}
