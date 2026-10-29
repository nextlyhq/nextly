/**
 * Cases for what a plugin declares in the configuration.
 *
 * Where the check that refuses a declaration runs on plain definitions, the case calls it with a
 * plugin that declares the fault. Otherwise it calls the factory the throw site calls, with the
 * message that site writes, and names the site.
 *
 * @module cli/__tests__/error-cases/plugin-config
 */
import type { CrossFileIssue } from "../../../domains/schema/ui-schema/cross-file";
import { collectPluginAuditKinds } from "../../../domains/audit/plugin-audit";
import { NextlyError } from "../../../errors/nextly-error";
import {
  adminWidgetError,
  adminWidgetShapeError,
} from "../../../plugins/admin-widget-error";
import {
  validateCapabilities,
  validateRequires,
} from "../../../plugins/capabilities";
import { clientConfigError } from "../../../plugins/client-config-error";
import { collectHookPoints } from "../../../plugins/hook-points";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { assertPluginConsent } from "../../../plugins/plugin-consent";
import { permissionCollisionError } from "../../../plugins/permission-error";
import { resolutionError } from "../../../plugins/resolution-error";
import { collectPluginRoutes } from "../../../plugins/routes/collect-routes";
import { routeInvalidMountError } from "../../../plugins/routes/route-error";
import {
  crossPluginRelationError,
  extendFieldDuplicateError,
  extendTargetUnknownError,
  relationTargetMissingError,
  renameUnknownTargetError,
  slugCollisionError,
} from "../../../plugins/schema-error";
import { topoSortPlugins } from "../../../plugins/topo-sort";
import { assertDocumentViews } from "../../../plugins/validate-document-views";
import { validatePluginMenus } from "../../../plugins/validate-menus";
import { validatePluginSlugs } from "../../../plugins/validate-slugs";
import { validatePluginVersions } from "../../../plugins/validate-versions";
import { builderSchemaConflict } from "../../errors/areas/plugin-config";

import type { ErrorCases } from "./types";

/** A plugin definition with what the case declares. */
function plugin(
  name: string,
  declares: Partial<PluginDefinition> = {}
): PluginDefinition {
  return { name, version: "1.0.0", nextly: ">=0.0.0", ...declares };
}

/** A route handler; no case runs one. */
const handler = () => new Response(null);

/** What `run` threw, so a check that refuses is read as the error it raises. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return new Error("the check did not refuse the declaration");
}

export const PLUGIN_CONFIG_CASES = {
  PLUGIN_ROUTE_COLLISION: () =>
    thrown(() =>
      collectPluginRoutes([
        plugin("feeds", {
          contributes: {
            routes: [
              { method: "GET", path: "/feeds/rss", mount: "root", handler },
            ],
          },
        }),
        plugin("syndication", {
          contributes: {
            routes: [
              { method: "GET", path: "/feeds/rss", mount: "root", handler },
            ],
          },
        }),
      ])
    ),
  PLUGIN_ROUTE_PATH_INVALID: () =>
    thrown(() =>
      collectPluginRoutes([
        plugin("reviews", {
          contributes: {
            routes: [{ method: "GET", path: "summary", handler }],
          },
        }),
      ])
    ),
  PLUGIN_ROUTE_ROOT_UNREACHABLE: () =>
    thrown(() =>
      collectPluginRoutes([
        plugin("reviews", {
          contributes: {
            routes: [
              {
                method: "GET",
                path: "/admin-meta/reviews",
                mount: "root",
                handler,
              },
            ],
          },
        }),
      ])
    ),
  // A mount outside the type reaches `collect-routes.ts` only from JavaScript.
  PLUGIN_ROUTE_MOUNT_INVALID: () =>
    routeInvalidMountError("reviews", "/summary", "global"),
  PLUGIN_ROUTE_OPTIONS_INVALID: () =>
    thrown(() =>
      collectPluginRoutes([
        plugin("reviews", {
          contributes: {
            routes: [
              { method: "GET", path: "/summary", rawBody: true, handler },
            ],
          },
        }),
      ])
    ),

  // `plugins/schema/apply-contributions.ts`: a plugin's slug the config already declares.
  PLUGIN_SLUG_COLLISION: () =>
    slugCollisionError("collection", "reviews", ["code", "reviews"]),
  // `plugins/schema/apply-contributions.ts`.
  PLUGIN_EXTEND_TARGET_UNKNOWN: () =>
    extendTargetUnknownError("prodcuts", "reviews"),
  // `plugins/schema/apply-contributions.ts`.
  PLUGIN_EXTEND_FIELD_DUPLICATE: () =>
    extendFieldDuplicateError("products", "rating", "reviews"),
  // `plugins/schema/validate-relations.ts`.
  RELATION_TARGET_UNKNOWN: () =>
    relationTargetMissingError("reviews", "product", "prodcuts"),
  // `plugins/schema/apply-contributions.ts`.
  PLUGIN_RENAME_TARGET_UNKNOWN: () =>
    renameUnknownTargetError("review", "reviews"),
  // `plugins/schema/validate-relations.ts`.
  PLUGIN_RELATION_DEPENDENCY_UNDECLARED: () =>
    crossPluginRelationError("reviews", "commerce", "products"),
  // `cli/commands/migrate-check.ts` reads these issues from `validateCrossFile`.
  BUILDER_SLUG_COLLISION: () =>
    builderSchemaConflict([
      {
        code: "NEXTLY_SCHEMA_SLUG_COLLISION",
        message:
          "slug 'posts' is defined in both nextly.config.ts and ui-schema.json",
      },
    ] satisfies CrossFileIssue[]),
  BUILDER_RELATION_TARGET_UNKNOWN: () =>
    builderSchemaConflict([
      {
        code: "NEXTLY_SCHEMA_RELATION_TARGET_MISSING",
        message: "articles.author relates to unknown target 'authors'",
      },
    ] satisfies CrossFileIssue[]),

  // `plugins/permissions/collect-permissions.ts`.
  PLUGIN_PERMISSION_DUPLICATE: () =>
    permissionCollisionError(
      "export",
      "reports",
      ["app", "reports"],
      "duplicate-permission"
    ),
  PLUGIN_PERMISSION_SYSTEM_RESOURCE: () =>
    permissionCollisionError(
      "export",
      "users",
      ["reports"],
      "system-resource-reserved"
    ),
  PLUGIN_PERMISSION_CRUD_RESERVED: () =>
    permissionCollisionError(
      "delete",
      "posts",
      ["reports"],
      "crud-permission-reserved"
    ),

  // `plugins/validate-admin-widgets.ts`, for a widget whose query holds a bigint.
  PLUGIN_ADMIN_WIDGET_NOT_JSON: () =>
    adminWidgetError("reviews", "stats", ["query"]),
  // `plugins/validate-admin-widgets.ts`, with the reason `undrawableReason` gives.
  PLUGIN_ADMIN_WIDGET_UNDRAWABLE: () =>
    adminWidgetShapeError(
      "reviews",
      "stats",
      'describes no body: it needs either a usable "component", or an ' +
        '"archetype" other than "custom" together with the "query" core draws it ' +
        "from"
    ),
  // `plugins/validate-client-config.ts`.
  PLUGIN_CLIENT_CONFIG_NOT_JSON: () => clientConfigError("reviews", ["onSave"]),
  PLUGIN_DOCUMENT_VIEW_COLLISION: () =>
    thrown(() =>
      assertDocumentViews([
        plugin("seo", {
          contributes: {
            admin: {
              views: {
                posts: {
                  documentViews: [{ path: "insights", component: "seo#Panel" }],
                },
              },
            },
          },
        }),
        plugin("analytics", {
          contributes: {
            admin: {
              views: {
                posts: {
                  documentViews: [
                    { path: "insights", component: "analytics#Panel" },
                  ],
                },
              },
            },
          },
        }),
      ])
    ),
  PLUGIN_DOCUMENT_VIEW_FIELD_TYPE_UNOWNED: () =>
    thrown(() =>
      assertDocumentViews([
        plugin("seo", {
          contributes: {
            admin: {
              documentViews: [
                {
                  fieldType: "richText",
                  path: "audit",
                  component: "seo#Audit",
                },
              ],
            },
          },
        }),
      ])
    ),
  PLUGIN_DOCUMENT_VIEW_INVALID: () =>
    thrown(() =>
      assertDocumentViews([
        plugin("seo", {
          contributes: {
            admin: {
              views: {
                posts: {
                  documentViews: [{ path: "Insights", component: "seo#Panel" }],
                },
              },
            },
          },
        }),
      ])
    ),
  // `plugins/codegen/block-document.ts`, the emission check's refusal.
  BLOCK_SCHEMA_DERIVATION_FAILED: () =>
    new NextlyError({
      code: "SCHEMA_DERIVATION_FAILED",
      publicMessage:
        "The block document schema could not be derived, so it was not emitted.",
      logContext: {
        missing: ["id", "type"],
        cause:
          "Object.prototype has been extended; zod's registry reads `id` off the object given to .meta(), so the emitted schema loses the node's fields and would describe a format that accepts malformed nodes.",
      },
    }),

  PLUGIN_DEPENDENCY_MISSING: () =>
    thrown(() =>
      topoSortPlugins([
        plugin("reviews", { dependsOn: { commerce: "^1.0.0" } }),
      ])
    ),
  PLUGIN_DEPENDENCY_CYCLE: () =>
    thrown(() =>
      topoSortPlugins([
        plugin("reviews", { dependsOn: { commerce: "^1.0.0" } }),
        plugin("commerce", { dependsOn: { reviews: "^1.0.0" } }),
      ])
    ),
  PLUGIN_NEXTLY_RANGE_INVALID: () =>
    thrown(() =>
      validatePluginVersions([plugin("reviews", { nextly: "latest" })], "1.4.0")
    ),
  PLUGIN_NEXTLY_INCOMPATIBLE: () =>
    thrown(() =>
      validatePluginVersions([plugin("reviews", { nextly: "^2.0.0" })], "1.4.0")
    ),
  PLUGIN_DEPENDENCY_VERSION_INCOMPATIBLE: () =>
    thrown(() =>
      validatePluginVersions(
        [
          plugin("reviews", { dependsOn: { commerce: "^2.0.0" } }),
          plugin("commerce"),
        ],
        "1.4.0"
      )
    ),
  PLUGIN_OPTIONAL_DEPENDENCY_VERSION_INCOMPATIBLE: () =>
    thrown(() =>
      validatePluginVersions(
        [
          plugin("reviews", { optionalDependsOn: { commerce: "^2.0.0" } }),
          plugin("commerce"),
        ],
        "1.4.0"
      )
    ),
  PLUGIN_MENU_COLLECTION_UNOWNED: () =>
    thrown(() =>
      validatePluginMenus([
        plugin("reviews", {
          contributes: {
            collections: [{ slug: "reviews", fields: [] }],
            admin: {
              menu: [
                { label: "Products", to: "/products", collection: "products" },
              ],
            },
          },
        }),
      ])
    ),
  // `plugins/settings-permission.ts`.
  PLUGIN_SETTINGS_PERMISSION_WITHOUT_SETTINGS: () =>
    resolutionError(
      "settings-permission-without-settings",
      'Plugin "reviews" declares settingsPermission "manage-reviews" but no settings schema for it to guard.',
      { plugin: "reviews", settingsPermission: "manage-reviews" }
    ),
  // `plugins/settings-permission.ts`.
  PLUGIN_SETTINGS_PERMISSION_UNDECLARED: () =>
    resolutionError(
      "settings-permission-undeclared",
      'Plugin "reviews" declares settingsPermission "manage-reviews", which is not one of its own permissions (moderate-reviews).',
      { plugin: "reviews", settingsPermission: "manage-reviews" }
    ),
  // `plugins/limits/limit-rules.ts`.
  PLUGIN_LIMIT_RULE_INVALID: () =>
    resolutionError(
      "limit-rule-invalid",
      'Plugin "reviews" declares the limit rule "reviews-per-day", which must be of type "window" or "backoff".',
      {
        plugin: "reviews",
        rule: "reviews-per-day",
        problem: 'be of type "window" or "backoff"',
      }
    ),
  PLUGIN_ADMIN_SLUG_COLLISION: () =>
    thrown(() =>
      validatePluginSlugs([plugin("@acme/reviews"), plugin("acme-reviews")])
    ),
  // `plugins/resolve.ts`.
  PLUGIN_EVENT_NAME_RESERVED: () =>
    resolutionError(
      "plugin-event-name-reserved",
      'Plugin "reviews" declares the event "collection.review-created", whose prefix core reserves for its own events.',
      { plugin: "reviews", event: "collection.review-created" }
    ),
  // `plugins/resolve.ts`.
  PLUGIN_EVENT_OUTSIDE_NAMESPACE: () =>
    resolutionError(
      "plugin-event-outside-namespace",
      'Plugin "reviews" declares the event "review.created", which must start with "reviews.".',
      {
        plugin: "reviews",
        event: "review.created",
        expectedPrefix: "reviews.",
      }
    ),
  // `plugins/resolve.ts`.
  PLUGIN_CHALLENGE_ID_RESERVED: () =>
    resolutionError(
      "plugin-challenge-id-reserved",
      'Plugin "accounts" declares the challenge id "must-change-password", which core reserves for its forced password change.',
      { plugin: "accounts", challengeId: "must-change-password" }
    ),
  // `plugins/resolve.ts`.
  PLUGIN_CHALLENGE_ID_DUPLICATE: () =>
    resolutionError(
      "plugin-challenge-id-duplicate",
      'Plugins "accounts" and "mfa" both declare the challenge id "otp".',
      { plugins: ["accounts", "mfa"], challengeId: "otp" }
    ),
  // `plugins/hook-points.ts`.
  PLUGIN_HOOK_POINT_RESERVED: () =>
    resolutionError(
      "hook-point-reserved",
      'Plugin "reviews" declares the hook point "email.review", whose prefix "email." core reserves for its own seams.',
      { plugin: "reviews", hookPoint: "email.review", reservedPrefix: "email." }
    ),
  PLUGIN_HOOK_POINT_OUTSIDE_NAMESPACE: () =>
    thrown(() =>
      collectHookPoints([
        plugin("reviews", {
          contributes: {
            hookPoints: [{ name: "review.score", kind: "filter" }],
          },
        }),
      ])
    ),
  // `plugins/hook-points.ts`.
  PLUGIN_HOOK_POINT_COLLISION: () =>
    resolutionError(
      "hook-point-collision",
      'Plugins "@acme/reviews" and "acme-reviews" both declare the hook point "acme-reviews.score".',
      {
        hookPoint: "acme-reviews.score",
        owners: ["@acme/reviews", "acme-reviews"],
      }
    ),
  // `plugins/hook-points.ts`, when a hook point runs.
  PLUGIN_HOOK_POINT_KIND_MISMATCH: () =>
    resolutionError(
      "hook-point-kind-mismatch",
      'Hook point "reviews.approve" (declared by reviews) is a decision, but it was executed as a filter. A decision executed as a filter cannot veto, so the call would fail open.',
      { point: "reviews.approve", declared: "decision", executedAs: "filter" }
    ),
  // `plugins/principals/registry.ts`.
  PLUGIN_PRINCIPAL_KIND_INVALID: () =>
    resolutionError(
      "principal-kind-invalid",
      'Plugin "accounts" registers a kind of signed-in person that cannot be used: resolve must be a function.',
      {
        plugin: "accounts",
        problem: "resolve must be a function",
      }
    ),
  // `plugins/principals/registry.ts`.
  PLUGIN_PRINCIPAL_KIND_COLLISION: () =>
    resolutionError(
      "principal-kind-collision",
      'Plugins "accounts" and "portal" both register the kind of signed-in person "customer".',
      { principalKind: "customer", owners: ["accounts", "portal"] }
    ),
  PLUGIN_AUDIT_KIND_OUTSIDE_NAMESPACE: () =>
    thrown(() =>
      collectPluginAuditKinds("reviews", [{ kind: "review.approved" }])
    ),
  PLUGIN_AUDIT_KIND_INVALID: () =>
    thrown(() =>
      collectPluginAuditKinds("reviews", [{ kind: "reviews.Approved!" }])
    ),
  PLUGIN_AUDIT_KIND_TOO_LONG: () =>
    thrown(() =>
      collectPluginAuditKinds("reviews", [
        {
          kind: "reviews.approved-by-a-moderator-after-a-second-report-was-filed-late",
        },
      ])
    ),
  PLUGIN_AUDIT_KIND_DUPLICATE: () =>
    thrown(() =>
      collectPluginAuditKinds("reviews", [
        { kind: "reviews.approved" },
        { kind: "reviews.approved" },
      ])
    ),
  PLUGIN_CAPABILITY_NOT_CONSENTED: () =>
    thrown(() =>
      assertPluginConsent(
        [plugin("reports", { capabilities: { db: { rawSql: true } } })],
        { rawSql: [] }
      )
    ),
  // `plugins/plugin-consent.ts`, for a transformer that swapped the plugin's `init`.
  PLUGIN_CODE_REPLACED_BY_SETUP: () =>
    resolutionError(
      "plugin-code-replaced-by-setup",
      "A setup transformer changed the code of plugin \"reports\" (init), which declares capabilities.db.rawSql. That capability grants the live database handle at ctx.db.raw, which reaches every table, and the app's listing covers the plugin it configured, with that plugin's own code. " +
        "Leave the definitions of plugins that declare capabilities.db.rawSql as configured in setup transformers.",
      {
        plugin: "reports",
        capability: "capabilities.db.rawSql",
        path: "init",
      }
    ),
  // `plugins/plugin-consent.ts`.
  PLUGIN_CAPABILITY_ADDED_BY_SETUP: () =>
    resolutionError(
      "capability-added-by-setup",
      'A setup transformer added capabilities.db.rawSql to plugin "reports", whose own manifest does not declare it. That capability grants the live database handle at ctx.db.raw, which reaches every table, and the app\'s listing covers only a plugin that declares it in its own manifest under the listed name. ' +
        "Declare capabilities.db.rawSql in the manifest of the plugin the app configures, rather than in a setup transformer.",
      { plugin: "reports", capability: "capabilities.db.rawSql" }
    ),
  // `plugins/capabilities.ts`: an unknown key reaches it only from JavaScript.
  PLUGIN_CAPABILITY_UNKNOWN: () =>
    resolutionError(
      "unknown-capability",
      'Plugin "reports" declares an unknown capability "filesystem".',
      { plugin: "reports", capability: "filesystem" }
    ),
  PLUGIN_SCHEMA_VERSION_INVALID: () =>
    thrown(() =>
      validateCapabilities([plugin("reports", { schemaVersion: 0 })])
    ),
  // `plugins/capabilities.ts`, for a manifest field of the wrong type.
  PLUGIN_MANIFEST_INVALID: () =>
    resolutionError(
      "invalid-manifest",
      'Plugin "reports" declares an invalid manifest at "provides": Invalid input: expected array, received string.',
      {
        plugin: "reports",
        path: "provides",
        issue: "Invalid input: expected array, received string",
      }
    ),
  PLUGIN_OUTBOUND_HOST_INVALID: () =>
    thrown(() =>
      validateCapabilities([
        plugin("reports", {
          capabilities: { net: { outbound: ["https://api.example.com"] } },
        }),
      ])
    ),
  PLUGIN_SECRETS_WITHOUT_SETTINGS: () =>
    thrown(() =>
      validateCapabilities([
        plugin("reports", { capabilities: { secrets: ["apiKey"] } }),
      ])
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_SECRET_PATH_DUPLICATE: () =>
    resolutionError(
      "invalid-secret-path",
      'Plugin "reports" declares the secret path "apiKey" twice.',
      { plugin: "reports", path: "apiKey" }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_SECRET_PATH_EMPTY: () =>
    resolutionError(
      "invalid-secret-path",
      'Plugin "reports" declares an empty secret path.',
      { plugin: "reports" }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_SECRET_PATH_UNKNOWN: () =>
    resolutionError(
      "unknown-secret-path",
      'Plugin "reports" declares the secret path "apiKey", which its settings schema does not contain.',
      { plugin: "reports", path: "apiKey" }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_SECRET_PATH_NAMES_GROUP: () =>
    resolutionError(
      "secret-path-names-group",
      'Plugin "reports" declares the secret path "provider", which names a group of settings rather than one value; name the value inside it.',
      { plugin: "reports", path: "provider" }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_SECRET_PATH_NOT_STRING: () =>
    resolutionError(
      "secret-path-not-string",
      'Plugin "reports" declares the secret path "retries", which names a value that cannot be a string; a secret is stored as a string.',
      { plugin: "reports", path: "retries" }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_NAME_TOO_LONG_FOR_SETTINGS: () =>
    resolutionError(
      "plugin-name-too-long-for-settings",
      `Plugin "${"reports-".repeat(25)}" stores settings, and its name is longer than the 191 characters the settings storage holds.`,
      { plugin: "reports-".repeat(25), maxLength: 191 }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_SETTINGS_KEY_TOO_LONG: () =>
    resolutionError(
      "settings-key-too-long",
      `Plugin "reports" declares the settings key "${"delivery".repeat(25)}", which is longer than the 191 characters the settings storage holds.`,
      { plugin: "reports", key: "delivery".repeat(25), maxLength: 191 }
    ),
  // `plugins/capabilities.ts`.
  PLUGIN_CAPABILITY_PROVIDED_TWICE: () =>
    resolutionError(
      "capability-provided-twice",
      'Plugins "mailer" and "smtp" both provide the capability "email".',
      { capability: "email", providers: ["mailer", "smtp"] }
    ),
  PLUGIN_CAPABILITY_MISSING: () =>
    thrown(() =>
      validateRequires([plugin("reports", { requires: { email: "^1.0.0" } })])
    ),
  PLUGIN_CAPABILITY_VERSION_INCOMPATIBLE: () =>
    thrown(() =>
      validateRequires([
        plugin("mailer", { provides: ["email"] }),
        plugin("reports", { requires: { email: "^2.0.0" } }),
      ])
    ),
} satisfies ErrorCases;
