import type { CollectionConfig } from "../collections/config/define-collection";
import type { FieldConfig } from "../collections/fields/types";
import type { ComponentConfig } from "../components/config/types";
import type { GeneratedTypes } from "../direct-api/types/shared";
import type { SingleConfig } from "../singles/config/types";

import type { PluginAdminContributions } from "./admin-contributions";
import type { PluginAuthContributions } from "./auth-contributions";
import type { PluginRoute } from "./routes/route-types";

/**
 * @public A plugin-declared custom permission (D36). CRUD permissions are
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
 * @public A permission identifier — the `${action}-${resource}` slug
 * (e.g. `'export-submissions'`).
 *
 * When generated types exist (run `nextly generate:types`), this narrows to the
 * union of seeded permission slugs (CRUD per collection/single + custom plugin/
 * app permissions, D36/D47). Without generated types — or when no permissions
 * are present — it falls back to `string` (same convention as `CollectionSlug`).
 */
export type PermissionSlug = GeneratedTypes extends { permissions: infer P }
  ? keyof P & string
  : string;

/**
 * Declarative, introspectable plugin contributions (D1). The host can read these
 * WITHOUT running the plugin.
 *
 * @public Each key is *consumed* by a phase: collections/singles/components/
 * extend → P2 (merge pipeline); permissions → P3; events → P1; routes → P4;
 * admin → P5 (menu/pages/settings/views; widgets reserved for M8).
 */
export interface PluginContributions {
  /** @public New plugin-owned collections. Merged by the schema pipeline (P2, D3/D12). */
  collections?: CollectionConfig[];
  /** @public New plugin-owned singles (P2). */
  singles?: SingleConfig[];
  /** @public Plugin-owned components (P2). */
  components?: ComponentConfig[];
  /** @public Add fields to existing entities by slug (P2, D12). */
  extend?: Array<{ target: string | string[]; fields: FieldConfig[] }>;
  /** @public Custom permissions; CRUD is auto-seeded separately (P3, D36). */
  permissions?: PluginPermission[];
  /** @experimental Custom event names this plugin may emit (P1, D9). No first-party plugin declares custom events yet. */
  events?: Array<{ name: string }>;
  /** @public HTTP routes, namespaced under /api/plugins/<name> (P4, D25). */
  routes?: PluginRoute[];
  /**
   * @public Admin UI contributions (P5, D19–D23): menu (D20), pages +
   * settings (D21), per-collection view overrides (D23). `widgets` (D22) is
   * RESERVED — deferred to M8 (D58); not rendered in P5 and stays `@experimental`.
   */
  admin?: PluginAdminContributions;
  /**
   * @experimental Auth extensibility (D71/D57): auth-flow hooks, challenge
   * definitions, and auth-page UI. Strategies are app-opt-in (defineConfig
   * `auth.strategies`), not here.
   */
  auth?: PluginAuthContributions;
}
