import type { CollectionConfig } from "../collections/config/define-collection";
import type { FieldConfig } from "../collections/fields/types";
import type { ComponentConfig } from "../components/config/types";
import type { SingleConfig } from "../singles/config/types";

/**
 * @experimental A plugin-declared custom permission (D36). CRUD permissions are
 * auto-seeded per collection/single slug separately — declare only NON-CRUD
 * custom permissions here (e.g. `{ action: 'export', resource: 'submissions' }`).
 */
export interface PluginPermission {
  action: string;
  resource: string;
  label?: string;
  description?: string;
  group?: string;
}

/**
 * @experimental A permission identifier — the `${action}-${resource}` slug
 * (e.g. `'export-submissions'`). A plain `string` until typed-slug codegen
 * (P6, D47) narrows it.
 */
export type PermissionSlug = string;

/**
 * Declarative, introspectable plugin contributions (D1). The host can read these
 * WITHOUT running the plugin.
 *
 * @experimental Contract surface only in P0 — each key is *consumed* by a later
 * phase: collections/singles/components/extend → P2 (merge pipeline); permissions
 * → P3; events → P1. `routes` (P4) and `admin` (P5) keys are added in those phases.
 */
export interface PluginContributions {
  /** @experimental New plugin-owned collections. Merged by the schema pipeline (P2, D3/D12). */
  collections?: CollectionConfig[];
  /** @experimental New plugin-owned singles (P2). */
  singles?: SingleConfig[];
  /** @experimental Plugin-owned components (P2). */
  components?: ComponentConfig[];
  /** @experimental Add fields to existing entities by slug (P2, D12). */
  extend?: Array<{ target: string | string[]; fields: FieldConfig[] }>;
  /** @experimental Custom permissions; CRUD is auto-seeded separately (P3, D36). */
  permissions?: PluginPermission[];
  /** @experimental Custom event names this plugin may emit (P1, D9). */
  events?: Array<{ name: string }>;
}
