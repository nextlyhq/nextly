import type { CollectionConfig } from "../collections/config/define-collection";
import type { FieldConfig } from "../collections/fields/types";
import type { ComponentConfig } from "../components/config/types";
import type { GeneratedTypes } from "../direct-api/types/shared";
import type { EmailProviderAdapter } from "../domains/email/types";
import type { SingleConfig } from "../singles/config/types";

import type { PluginAdminContributions } from "./admin-contributions";
import type { PluginAuthContributions } from "./auth-contributions";
import type { PluginContext } from "./plugin-context";
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
 * @experimental A plugin-declared role bundle (D67) — a named set of permissions
 * an admin can grant as a unit. Seeded on boot (idempotent by slug), tagged
 * `isSystem: false`, and **never auto-assigned** to users (D36 — define, don't
 * grant). Reference permissions by their `${action}-${resource}` slug.
 */
export interface PluginRole {
  /** Unique role slug (e.g. `'content-reviewer'`). `'super-admin'` is reserved. */
  slug: string;
  /** Human-readable name (e.g. `'Content Reviewer'`). */
  name: string;
  description?: string;
  /** Permission slugs this role bundles, e.g. `['read-posts', 'approve-posts']`. */
  permissionSlugs: string[];
  /** Authority level (higher = more senior); default 0. */
  level?: number;
}

/**
 * @experimental A reserved scheduled-task declaration (D61). **Not executed yet**
 * — see `contributes.schedules`. The shape is forward-designed so it stays stable
 * once a durable-jobs backend (D51) lands.
 */
export interface ScheduledTask {
  /** Unique, namespaced task name, e.g. `'seo.regenerate-sitemap'`. */
  name: string;
  /** Cron expression or interval in milliseconds (reserved; not yet honored). */
  schedule: string | number;
  /** Task handler (reserved — the runtime does not invoke it yet). */
  handler?: (ctx: PluginContext) => Promise<void> | void;
  description?: string;
}

/**
 * @experimental A plugin-contributed email provider (C2/D65). Registers a new
 * provider `type` whose adapter is built from the (decrypted) provider config an
 * admin stores. Replaces the need to fork core's hardcoded provider switch.
 */
export interface PluginEmailProvider {
  /** Provider type id (e.g. `'mailgun'`). Must not collide with a built-in. */
  type: string;
  /** Build the adapter from the stored, decrypted provider configuration. */
  createAdapter: (config: Record<string, unknown>) => EmailProviderAdapter;
}

/**
 * @experimental A plugin-contributed email template (C2/D65), seeded into the
 * `email_templates` table on boot (idempotent by slug; never clobbers admin
 * edits). Resolvable by slug via `sendWithTemplate` and the direct API.
 */
export interface PluginEmailTemplate {
  slug: string;
  name: string;
  /** Subject line; supports `{{variable}}` interpolation. */
  subject: string;
  /** HTML body; supports `{{variable}}` interpolation. */
  htmlContent: string;
  plainTextContent?: string;
  variables?: Array<{ name: string; description?: string; required?: boolean }>;
  /** Wrap with the shared layout; default true. */
  useLayout?: boolean;
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
  /** @experimental Role bundles — named sets of permissions, seeded on boot (D67). */
  roles?: PluginRole[];
  /**
   * @experimental Custom services registered into DI (D64). Each entry is a
   * factory `(ctx) => instance`; the service is exposed lazily (instantiated on
   * first access) at `ctx.services.plugins.<thisPluginName>.<key>` and
   * `nextly.plugins.<thisPluginName>.<key>` (D66). Other plugins consume it via
   * their own `ctx.services.plugins.<name>.<key>`.
   */
  services?: Record<string, (ctx: PluginContext) => unknown>;
  /**
   * @experimental Scheduled tasks (D61) — **RESERVED, NOT EXECUTED** in this
   * release. The shape is published so authors aren't surprised by its absence,
   * but the runtime does not run these yet (a real scheduler needs durable jobs,
   * D51, because the typical Next.js/serverless deploy has no long-lived
   * process). Until then: trigger work via an external cron service hitting a
   * route handler, or react to events (as `plugin-seo` does for cache
   * invalidation). See `docs/plugins`.
   */
  schedules?: ScheduledTask[];
  /** @experimental Custom email providers, registered into the provider registry (C2/D65). */
  emailProviders?: PluginEmailProvider[];
  /** @experimental Email templates, seeded idempotently into the DB on boot (C2/D65). */
  emailTemplates?: PluginEmailTemplate[];
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
