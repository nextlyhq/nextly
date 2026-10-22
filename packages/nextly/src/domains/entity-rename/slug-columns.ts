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
 * - `follow-json`: a JSON value names the slug inside it (a webhook filter's
 *   list of collections), and is rewritten to name the new one.
 *
 * Column names are SQL names, the ones the core schema declares.
 *
 * @module domains/entity-rename/slug-columns
 */

import { NextlyError } from "../../errors";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { entityPermissionSpelling } from "../auth/services/entity-permission-spelling";
import { releaseMemberKey } from "../releases/release-member-key";
import { versionPinKey } from "../versions/version-pins";
import { versionViewKey } from "../versions/version-views";
import { workingDraftKey } from "../versions/working-draft-key";

/** What can be renamed: a collection or a Single. */
export type RenamedEntityKind = "collection" | "single";

/** One row as the rename reads it, by SQL column name. */
export type SlugKeyedRow = Readonly<Record<string, unknown>>;

/**
 * Columns whose values are made from the slug: a digest of the row's identity,
 * or a permission's slug and name. Each moved row gets them written again from
 * its own columns and the new slug, by the function every writer of the table
 * uses.
 */
export interface SlugDerivedColumns {
  /** The column a row is addressed by when its new values are written. */
  rowId: string;
  /** The columns `derive` writes. */
  columns: readonly string[];
  /** The columns, besides the kind and the slug, they are made from. */
  sources: readonly string[];
  /**
   * Derive only rows where this column holds a value; the rest keep it NULL
   * and move with the others. Only a working draft carries a `draft_key`.
   */
  onlyWhereSet?: string;
  /** The derived columns of `row` under `slug`, by SQL column name. */
  derive(row: SlugKeyedRow, slug: string): Readonly<Record<string, string>>;
}

/** Where a row says which kind of entity it belongs to. */
export interface EntityKindColumn {
  column: string;
  /**
   * The values `column` holds for each kind. `null` is listed where the
   * table's own readers take a NULL kind to mean that kind.
   */
  values: Readonly<Record<RenamedEntityKind, readonly (string | null)[]>>;
}

/** Which rows of a table belong to one entity. */
interface EntityScopedColumn {
  table: string;
  slugColumn: string;
  /**
   * Absent where the table records no kind: collection and Single slugs are
   * unique across both kinds, so there the slug alone says whose a row is.
   */
  kind?: EntityKindColumn;
  /** Columns that must be NULL for a row to be the entity's own. */
  onlyWhereNull?: readonly string[];
}

/** Rows that move to the new slug. */
export interface FollowingSlugColumn extends EntityScopedColumn {
  onRename: "follow";
  derived?: SlugDerivedColumns;
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

/**
 * A JSON column that names entities by slug inside its value. Every row is
 * read and its value rewritten in code, because no portable condition reaches
 * inside JSON, so this is for small tables only. The scan of the core schema
 * cannot see inside JSON either: a declaration here is the only record that a
 * value names a slug.
 */
export interface JsonSlugColumn {
  table: string;
  jsonColumn: string;
  rowId: string;
  /** The kinds whose slugs the value can name. */
  renames: readonly RenamedEntityKind[];
  onRename: "follow-json";
  /** Whether `value` names `slug`. */
  names(value: unknown, slug: string): boolean;
  /** `value` naming `to` wherever it named `from`. */
  rewrite(value: unknown, from: string, to: string): unknown;
}

export type SlugColumn =
  | FollowingSlugColumn
  | EndingSlugColumn
  | KeptSlugColumn
  | JsonSlugColumn;

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

/**
 * The `collections` a webhook filter lists, for the one filter version that
 * has the list, or null when the value is not such a filter.
 */
function filterCollections(value: unknown): unknown[] | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("version" in value) || value.version !== 1) return null;
  if (!("collections" in value) || !Array.isArray(value.collections)) {
    return null;
  }
  return value.collections;
}

/** The filter with `from` renamed to `to` in its list, listed once. */
function withCollectionRenamed(
  value: unknown,
  from: string,
  to: string
): unknown {
  const listed = filterCollections(value);
  if (listed === null || typeof value !== "object" || value === null) {
    return value;
  }
  const renamed = listed.map(entry => (entry === from ? to : entry));
  return {
    ...value,
    collections: renamed.filter((entry, at) => renamed.indexOf(entry) === at),
  };
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
    slugColumn: "scope_slug",
    kind: { column: "scope_kind", values: SCOPE_KINDS },
    onRename: "follow",
    derived: {
      rowId: "id",
      columns: ["draft_key"],
      onlyWhereSet: "draft_key",
      sources: ["entry_id", "locale"],
      derive: (row, slug) => ({
        draft_key: workingDraftKey(
          {
            scopeKind: scopeKindOf(row, "scope_kind"),
            scopeSlug: slug,
            entryId: textOf(row, "entry_id"),
          },
          textOrNullOf(row, "locale")
        ),
      }),
    },
  },
  {
    // The versions a feature holds against retention, one row per slot.
    table: "nextly_version_pins",
    slugColumn: "scope_slug",
    kind: { column: "scope_kind", values: SCOPE_KINDS },
    onRename: "follow",
    derived: {
      rowId: "id",
      columns: ["pin_key"],
      sources: ["entry_id", "holder", "slot"],
      derive: (row, slug) => ({
        pin_key: versionPinKey(
          {
            scopeKind: scopeKindOf(row, "scope_kind"),
            scopeSlug: slug,
            entryId: textOf(row, "entry_id"),
          },
          textOf(row, "holder"),
          textOf(row, "slot")
        ),
      }),
    },
  },
  {
    // Each person's "last looked at" marker, per document and part.
    table: "nextly_version_views",
    slugColumn: "scope_slug",
    kind: { column: "scope_kind", values: SCOPE_KINDS },
    onRename: "follow",
    derived: {
      rowId: "id",
      columns: ["view_key"],
      sources: ["user_id", "entry_id", "part"],
      derive: (row, slug) => ({
        view_key: versionViewKey({
          userId: textOf(row, "user_id"),
          ref: {
            scopeKind: scopeKindOf(row, "scope_kind"),
            scopeSlug: slug,
            entryId: textOf(row, "entry_id"),
          },
          part: textOrNullOf(row, "part"),
        }),
      }),
    },
  },
  {
    // The record of content events. Each event's parts are keyed by the
    // event's id, so they move with it.
    table: "nextly_content_events",
    slugColumn: "subject_slug",
    kind: { column: "subject_kind", values: SCOPE_KINDS },
    onRename: "follow",
  },
  {
    // The documents a release holds.
    table: "nextly_release_members",
    slugColumn: "scope_slug",
    kind: { column: "scope_kind", values: SCOPE_KINDS },
    onRename: "follow",
    derived: {
      rowId: "id",
      columns: ["member_key"],
      sources: ["release_id", "entry_id", "locale"],
      derive: (row, slug) => ({
        member_key: releaseMemberKey(textOf(row, "release_id"), {
          scopeKind: scopeKindOf(row, "scope_kind"),
          scopeSlug: slug,
          entryId: textOf(row, "entry_id"),
          locale: textOrNullOf(row, "locale"),
        }),
      }),
    },
  },
  {
    // The schema changes recorded against the entity.
    table: "nextly_schema_events",
    slugColumn: "scope_slug",
    kind: { column: "scope_kind", values: SCOPE_KINDS },
    onRename: "follow",
  },
  {
    // The dashboard's activity feed. Its readers take a NULL kind, which rows
    // written before the kind was recorded carry, to be a collection's.
    table: "activity_log",
    slugColumn: "collection",
    kind: {
      column: "subject_kind",
      values: { collection: ["collection", null], single: ["single"] },
    },
    onRename: "follow",
  },
  {
    // Translations kept when localization was turned off, to restore if it is
    // turned on again. Rows archived before the kind was recorded say
    // `unknown` or `unresolved` and are left where they are: their owner cannot
    // be told from the slug alone, which a field group may share.
    table: "nextly_i18n_archive",
    slugColumn: "collection",
    kind: { column: "entity_kind", values: SCOPE_KINDS },
    onRename: "follow",
  },
  {
    table: "nextly_document_lock",
    slugColumn: "slug",
    kind: { column: "scope_kind", values: SCOPE_KINDS },
    onRename: "end",
    reason:
      "A lock is a short lease on a document open under the old slug. The editor holding it can no longer save there, and the row's id is made from the slug.",
  },
  {
    table: "nextly_preview_links",
    slugColumn: "document_slug",
    kind: {
      column: "document_kind",
      values: { collection: ["entry"], single: ["single"] },
    },
    onRename: "end",
    reason:
      "A preview link's signed token names the old slug and is only honoured while its row names the same document. Moved, the row would be listed as live under the new slug while its token could never open; kept, it would open whatever is next created under the old slug.",
  },
  {
    // The permissions the framework creates for the entity, `read-<slug>` and
    // its siblings. Grants reference a permission by id, so every role keeps
    // exactly what it held, now for the new slug, and no other role's access
    // changes. A plugin's own permissions (`owner` set) are declared by the
    // plugin under the slug its code names, and stay with that declaration.
    table: "permissions",
    slugColumn: "resource",
    onlyWhereNull: ["owner"],
    onRename: "follow",
    derived: {
      rowId: "id",
      columns: ["slug", "name", "description"],
      sources: ["action"],
      derive: (row, slug) => {
        const spelled = entityPermissionSpelling(textOf(row, "action"), slug);
        return {
          slug: spelled.slug,
          name: spelled.name,
          description: spelled.description,
        };
      },
    },
  },
  {
    table: "user_permission_cache",
    slugColumn: "resource",
    onRename: "end",
    reason:
      'Kept answers to "may this person act on <slug>". Ones about the old slug answer for nothing once it is gone, and would answer for whatever is created there next.',
  },
  {
    // Endpoints whose filter lists the collection. A Single never feeds the
    // `collections` filter, so only a collection's rename touches it.
    table: "nextly_webhooks",
    jsonColumn: "filter",
    rowId: "id",
    renames: ["collection"],
    onRename: "follow-json",
    names: (value, slug) => filterCollections(value)?.includes(slug) ?? false,
    rewrite: (value, from, to) => withCollectionRenamed(value, from, to),
  },
  {
    table: "nextly_events",
    slugColumn: "resource_kind",
    onRename: "keep",
    reason: "The kind of resource an event is about, not a slug.",
  },
  {
    table: "nextly_events",
    slugColumn: "resource_id",
    onRename: "keep",
    reason: "The id of the resource an event is about, not a slug.",
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

/** The declared columns a rename moves or deletes rows by, in order. */
export function renamedSlugColumns(): RenamedSlugColumn[] {
  return SLUG_COLUMNS.filter(
    (column): column is RenamedSlugColumn =>
      column.onRename === "follow" || column.onRename === "end"
  );
}

/** The declared JSON columns a rename rewrites, in order. */
export function jsonSlugColumns(): JsonSlugColumn[] {
  return SLUG_COLUMNS.filter(
    (column): column is JsonSlugColumn => column.onRename === "follow-json"
  );
}
