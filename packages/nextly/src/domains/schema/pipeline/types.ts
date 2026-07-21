// The locked input contract for applyDesiredSchema().
// A snapshot of what the database should look like after the apply.
//
// Three top-level keys mirror the user mental model: collections,
// singles, components. Each value is keyed by slug for O(1) lookups.
//
// Field-shape only — display metadata (label, admin, access, hooks)
// lives on the same FieldConfig type but is ignored by the schema
// pipeline. See plans/specs/F2-apply-desired-schema-design.md §5.

import type {
  FieldConfig,
  IndexConfig,
} from "../../../collections/config/define-collection";

export interface DesiredSchema {
  collections: Record<string, DesiredCollection>;
  singles: Record<string, DesiredSingle>;
  components: Record<string, DesiredComponent>;
}

export interface DesiredCollection {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  indexes?: IndexConfig[];
  /**
   * Whether the collection has Draft/Published status enabled.
   * When true, the diff input includes a `status` system column so the
   * pipeline knows to add it on first enable and drop it on disable.
   */
  status?: boolean;
  /**
   * Whether the collection is localized (i18n). When true, translatable fields
   * are omitted from the main table's desired snapshot because they live in the
   * companion `_locales` table. Without this the push/HMR/preview diff re-adds
   * the localized columns to the main table.
   */
  localized?: boolean;
  /**
   * Whether this entity is owned by code-first config or a plugin (locked in
   * the registry). A UI/builder save must never emit DDL against a locked
   * table — those tables are owned by `nextly.config.ts` and its migrations,
   * so drift is reconciled by db:sync, not by the Schema Builder.
   */
  locked?: boolean;
}

export interface DesiredSingle {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  indexes?: IndexConfig[];
  /** Same semantics as DesiredCollection.status. */
  status?: boolean;
  /** Same semantics as DesiredCollection.localized — translatable fields live in
   *  the companion `single_<slug>_locales` table and are omitted from main. */
  localized?: boolean;
  /**
   * Whether this entity is owned by code-first config or a plugin (locked in
   * the registry). A UI/builder save must never emit DDL against a locked
   * table — those tables are owned by `nextly.config.ts` and its migrations,
   * so drift is reconciled by db:sync, not by the Schema Builder.
   */
  locked?: boolean;
}

export interface DesiredComponent {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  indexes?: IndexConfig[];
  /** Same semantics as DesiredCollection.localized — translatable fields live in
   *  the companion `comp_<slug>_locales` table and are omitted from main. */
  localized?: boolean;
  /**
   * Whether this entity is owned by code-first config or a plugin (locked in
   * the registry). A UI/builder save must never emit DDL against a locked
   * table — those tables are owned by `nextly.config.ts` and its migrations,
   * so drift is reconciled by db:sync, not by the Schema Builder.
   */
  locked?: boolean;
}
