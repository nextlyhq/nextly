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
}

export interface DesiredSingle {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  indexes?: IndexConfig[];
}

export interface DesiredComponent {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  indexes?: IndexConfig[];
}
