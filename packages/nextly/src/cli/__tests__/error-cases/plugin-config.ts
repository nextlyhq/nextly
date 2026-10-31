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
import { assertAdminWidgets } from "../../../plugins/validate-admin-widgets";
import { assertDocumentViews } from "../../../plugins/validate-document-views";
import { validatePluginMenus } from "../../../plugins/validate-menus";
import { validatePluginSlugs } from "../../../plugins/validate-slugs";
import { validatePluginVersions } from "../../../plugins/validate-versions";
import { builderSchemaConflict } from "../../errors/areas/plugin-config";

import type { CliErrorCode } from "../../errors";

import type { ErrorCase, ErrorCases } from "./types";

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
  NEXTLY_ROUTE_COLLISION: () =>
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
  NEXTLY_ROUTE_INVALID_PATH: () =>
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
  PLUGIN_RESOLUTION_ERROR: () =>
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
  NEXTLY_SCHEMA_SLUG_COLLISION: () =>
    slugCollisionError("collection", "reviews", ["code", "reviews"]),
  // `plugins/schema/apply-contributions.ts`.
  NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN: () =>
    extendTargetUnknownError("prodcuts", "reviews"),
  // `plugins/schema/apply-contributions.ts`.
  NEXTLY_SCHEMA_EXTEND_FIELD_DUPLICATE: () =>
    extendFieldDuplicateError("products", "rating", "reviews"),
  // `plugins/schema/validate-relations.ts`.
  NEXTLY_SCHEMA_RELATION_TARGET_MISSING: () =>
    relationTargetMissingError("reviews", "product", "prodcuts"),
  // `plugins/schema/apply-contributions.ts`.
  NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET: () =>
    renameUnknownTargetError("review", "reviews"),
  // `plugins/schema/validate-relations.ts`.
  NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION: () =>
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
  NEXTLY_PERMISSION_COLLISION: () =>
    permissionCollisionError(
      "export",
      "reports",
      ["app", "reports"],
      "duplicate-permission"
    ),
  // `plugins/removed-widget-keys.ts`, through the startup check, for a plugin that still
  // declares a widget data source under `contributes.widgetSources`.
  NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL: () =>
    thrown(() =>
      assertAdminWidgets([
        plugin("reviews", {
          contributes: { widgetSources: [] },
        } as unknown as Partial<PluginDefinition>),
      ])
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

  // As `plugins/jobs/collect-jobs.ts` refuses a slug two plugins declare.
  PLUGIN_JOB_SLUG_TAKEN: () =>
    NextlyError.invalidInput({
      message:
        'NEXTLY_JOB_COLLISION: job slug "seo.sitemap" is declared by both "@acme/seo" and "@acme/sitemap". Job slugs must be unique.',
      logContext: {
        slug: "seo.sitemap",
        owner: "@acme/sitemap",
        previous: "@acme/seo",
      },
    }),
  // The refusals of `plugins/widgets/collect-widget-sources.ts`, each as it builds it.
  PLUGIN_WIDGET_SOURCE_INVALID: () =>
    NextlyError.invalidInput({
      message:
        'NEXTLY_WIDGET_SOURCE_INVALID: "@acme/stats" contributes widget source "acme/visits" without a resolver function.',
      logContext: { id: "acme/visits", owner: "@acme/stats" },
    }),
  PLUGIN_WIDGET_SOURCE_RESERVED: () =>
    NextlyError.invalidInput({
      message:
        'NEXTLY_WIDGET_SOURCE_RESERVED: "@acme/stats" contributes widget source "nextly/visits", but the "nextly" namespace is reserved for Nextly\'s own sources.',
      logContext: {
        id: "nextly/visits",
        owner: "@acme/stats",
        reserved: "nextly",
      },
    }),
  PLUGIN_WIDGET_SOURCE_NAMESPACE: () =>
    NextlyError.invalidInput({
      message:
        'NEXTLY_WIDGET_SOURCE_NAMESPACE: "@acme/stats" contributes widget source "visits", but a contributed source\'s id must start with its plugin\'s name.',
      logContext: { id: "visits", owner: "@acme/stats" },
    }),
  PLUGIN_WIDGET_SOURCE_KIND: () =>
    NextlyError.invalidInput({
      message:
        'NEXTLY_WIDGET_SOURCE_KIND: "@acme/stats" contributes widget source "acme/visits" with kind "gauge", which the dashboard does not draw.',
      logContext: { id: "acme/visits", owner: "@acme/stats" },
    }),
  PLUGIN_WIDGET_SOURCE_COLLISION: () =>
    NextlyError.invalidInput({
      message:
        'NEXTLY_WIDGET_SOURCE_COLLISION: widget source "acme/visits" is declared by both "@acme/stats" and "@acme/analytics". Source ids must be unique.',
      logContext: {
        id: "acme/visits",
        owner: "@acme/analytics",
        previous: "@acme/stats",
      },
    }),
  // As `assertModuleNamesUnique` in `domains/schema/migrate/plugin/plugin-migration.ts` throws it.
  PLUGIN_MIGRATION_NAME_DUPLICATE: () =>
    NextlyError.invalidInput({
      message:
        'Plugin "@acme/seo" ships more than one migration named "0002_Redirects". Each module\'s name is its key in the migration ledger, so every name must be unique (ignoring case). Rename one, then reseal it with `migrationChecksum`.',
      logContext: {
        plugin: "@acme/seo",
        migration: "0002_Redirects",
        clashesWith: "0002_redirects",
      },
    }),
  // As `writeModule` in `domains/schema/migrate-create/generate-plugin.ts` refuses an existing file.
  PLUGIN_MIGRATION_MODULE_EXISTS: () =>
    NextlyError.conflict({
      reason: "state",
      message:
        "A migration module already exists at src/migrations/0003_add_redirects.ts, and it was left as it is. Run the command again for a module with a new name.",
      logContext: { modulePath: "src/migrations/0003_add_redirects.ts" },
    }),
} satisfies ErrorCases;

/**
 * The causes that were codes of their own before the guides' documented code was kept for them:
 * each still has its own reading, so each still has its case, under the code it now ends as.
 */
export const PLUGIN_CONFIG_MERGED_CASES: Record<
  string,
  { code: CliErrorCode; make: ErrorCase }
> = {
  PLUGIN_ROUTE_OPTIONS_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
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
  },
  PLUGIN_PERMISSION_SYSTEM_RESOURCE: {
    code: "NEXTLY_PERMISSION_COLLISION",
    make: () =>
      permissionCollisionError(
        "export",
        "users",
        ["reports"],
        "system-resource-reserved"
      ),
  },
  PLUGIN_PERMISSION_CRUD_RESERVED: {
    code: "NEXTLY_PERMISSION_COLLISION",
    make: () =>
      permissionCollisionError(
        "delete",
        "posts",
        ["reports"],
        "crud-permission-reserved"
      ),
  },
  PLUGIN_DEPENDENCY_MISSING: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        topoSortPlugins([
          plugin("reviews", { dependsOn: { commerce: "^1.0.0" } }),
        ])
      ),
  },
  PLUGIN_DEPENDENCY_CYCLE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        topoSortPlugins([
          plugin("reviews", { dependsOn: { commerce: "^1.0.0" } }),
          plugin("commerce", { dependsOn: { reviews: "^1.0.0" } }),
        ])
      ),
  },
  PLUGIN_NEXTLY_RANGE_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validatePluginVersions(
          [plugin("reviews", { nextly: "latest" })],
          "1.4.0"
        )
      ),
  },
  PLUGIN_NEXTLY_INCOMPATIBLE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validatePluginVersions(
          [plugin("reviews", { nextly: "^2.0.0" })],
          "1.4.0"
        )
      ),
  },
  PLUGIN_DEPENDENCY_VERSION_INCOMPATIBLE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validatePluginVersions(
          [
            plugin("reviews", { dependsOn: { commerce: "^2.0.0" } }),
            plugin("commerce"),
          ],
          "1.4.0"
        )
      ),
  },
  PLUGIN_OPTIONAL_DEPENDENCY_VERSION_INCOMPATIBLE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validatePluginVersions(
          [
            plugin("reviews", { optionalDependsOn: { commerce: "^2.0.0" } }),
            plugin("commerce"),
          ],
          "1.4.0"
        )
      ),
  },
  PLUGIN_MENU_COLLECTION_UNOWNED: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validatePluginMenus([
          plugin("reviews", {
            contributes: {
              collections: [{ slug: "reviews", fields: [] }],
              admin: {
                menu: [
                  {
                    label: "Products",
                    to: "/products",
                    collection: "products",
                  },
                ],
              },
            },
          }),
        ])
      ),
  },
  PLUGIN_SETTINGS_PERMISSION_WITHOUT_SETTINGS: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "settings-permission-without-settings",
        'Plugin "reviews" declares settingsPermission "manage-reviews" but no settings schema for it to guard.',
        { plugin: "reviews", settingsPermission: "manage-reviews" }
      ),
  },
  PLUGIN_SETTINGS_PERMISSION_UNDECLARED: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "settings-permission-undeclared",
        'Plugin "reviews" declares settingsPermission "manage-reviews", which is not one of its own permissions (moderate-reviews).',
        { plugin: "reviews", settingsPermission: "manage-reviews" }
      ),
  },
  PLUGIN_LIMIT_RULE_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "limit-rule-invalid",
        'Plugin "reviews" declares the limit rule "reviews-per-day", which must be of type "window" or "backoff".',
        {
          plugin: "reviews",
          rule: "reviews-per-day",
          problem: 'be of type "window" or "backoff"',
        }
      ),
  },
  PLUGIN_ADMIN_SLUG_COLLISION: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validatePluginSlugs([plugin("@acme/reviews"), plugin("acme-reviews")])
      ),
  },
  PLUGIN_EVENT_NAME_RESERVED: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "plugin-event-name-reserved",
        'Plugin "reviews" declares the event "collection.review-created", whose prefix core reserves for its own events.',
        { plugin: "reviews", event: "collection.review-created" }
      ),
  },
  PLUGIN_EVENT_OUTSIDE_NAMESPACE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "plugin-event-outside-namespace",
        'Plugin "reviews" declares the event "review.created", which must start with "reviews.".',
        {
          plugin: "reviews",
          event: "review.created",
          expectedPrefix: "reviews.",
        }
      ),
  },
  PLUGIN_CHALLENGE_ID_RESERVED: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "plugin-challenge-id-reserved",
        'Plugin "accounts" declares the challenge id "must-change-password", which core reserves for its forced password change.',
        { plugin: "accounts", challengeId: "must-change-password" }
      ),
  },
  PLUGIN_CHALLENGE_ID_DUPLICATE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "plugin-challenge-id-duplicate",
        'Plugins "accounts" and "mfa" both declare the challenge id "otp".',
        { plugins: ["accounts", "mfa"], challengeId: "otp" }
      ),
  },
  PLUGIN_HOOK_POINT_RESERVED: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "hook-point-reserved",
        'Plugin "reviews" declares the hook point "email.review", whose prefix "email." core reserves for its own seams.',
        {
          plugin: "reviews",
          hookPoint: "email.review",
          reservedPrefix: "email.",
        }
      ),
  },
  PLUGIN_HOOK_POINT_OUTSIDE_NAMESPACE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        collectHookPoints([
          plugin("reviews", {
            contributes: {
              hookPoints: [{ name: "review.score", kind: "filter" }],
            },
          }),
        ])
      ),
  },
  PLUGIN_HOOK_POINT_COLLISION: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "hook-point-collision",
        'Plugins "@acme/reviews" and "acme-reviews" both declare the hook point "acme-reviews.score".',
        {
          hookPoint: "acme-reviews.score",
          owners: ["@acme/reviews", "acme-reviews"],
        }
      ),
  },
  PLUGIN_HOOK_POINT_KIND_MISMATCH: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "hook-point-kind-mismatch",
        'Hook point "reviews.approve" (declared by reviews) is a decision, but it was executed as a filter. A decision executed as a filter cannot veto, so the call would fail open.',
        { point: "reviews.approve", declared: "decision", executedAs: "filter" }
      ),
  },
  PLUGIN_PRINCIPAL_KIND_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "principal-kind-invalid",
        'Plugin "accounts" registers a kind of signed-in person that cannot be used: resolve must be a function.',
        {
          plugin: "accounts",
          problem: "resolve must be a function",
        }
      ),
  },
  PLUGIN_PRINCIPAL_KIND_COLLISION: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "principal-kind-collision",
        'Plugins "accounts" and "portal" both register the kind of signed-in person "customer".',
        { principalKind: "customer", owners: ["accounts", "portal"] }
      ),
  },
  PLUGIN_AUDIT_KIND_OUTSIDE_NAMESPACE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        collectPluginAuditKinds("reviews", [{ kind: "review.approved" }])
      ),
  },
  PLUGIN_AUDIT_KIND_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        collectPluginAuditKinds("reviews", [{ kind: "reviews.Approved!" }])
      ),
  },
  PLUGIN_AUDIT_KIND_TOO_LONG: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        collectPluginAuditKinds("reviews", [
          {
            kind: "reviews.approved-by-a-moderator-after-a-second-report-was-filed-late",
          },
        ])
      ),
  },
  PLUGIN_AUDIT_KIND_DUPLICATE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        collectPluginAuditKinds("reviews", [
          { kind: "reviews.approved" },
          { kind: "reviews.approved" },
        ])
      ),
  },
  PLUGIN_CAPABILITY_NOT_CONSENTED: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        assertPluginConsent(
          [plugin("reports", { capabilities: { db: { rawSql: true } } })],
          { rawSql: [] }
        )
      ),
  },
  PLUGIN_CODE_REPLACED_BY_SETUP: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
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
  },
  PLUGIN_CAPABILITY_ADDED_BY_SETUP: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "capability-added-by-setup",
        'A setup transformer added capabilities.db.rawSql to plugin "reports", whose own manifest does not declare it. That capability grants the live database handle at ctx.db.raw, which reaches every table, and the app\'s listing covers only a plugin that declares it in its own manifest under the listed name. ' +
          "Declare capabilities.db.rawSql in the manifest of the plugin the app configures, rather than in a setup transformer.",
        { plugin: "reports", capability: "capabilities.db.rawSql" }
      ),
  },
  PLUGIN_CAPABILITY_UNKNOWN: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "unknown-capability",
        'Plugin "reports" declares an unknown capability "filesystem".',
        { plugin: "reports", capability: "filesystem" }
      ),
  },
  PLUGIN_SCHEMA_VERSION_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validateCapabilities([plugin("reports", { schemaVersion: 0 })])
      ),
  },
  PLUGIN_MANIFEST_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "invalid-manifest",
        'Plugin "reports" declares an invalid manifest at "provides": Invalid input: expected array, received string.',
        {
          plugin: "reports",
          path: "provides",
          issue: "Invalid input: expected array, received string",
        }
      ),
  },
  PLUGIN_OUTBOUND_HOST_INVALID: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validateCapabilities([
          plugin("reports", {
            capabilities: { net: { outbound: ["https://api.example.com"] } },
          }),
        ])
      ),
  },
  PLUGIN_SECRETS_WITHOUT_SETTINGS: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validateCapabilities([
          plugin("reports", { capabilities: { secrets: ["apiKey"] } }),
        ])
      ),
  },
  PLUGIN_SECRET_PATH_DUPLICATE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "invalid-secret-path",
        'Plugin "reports" declares the secret path "apiKey" twice.',
        { plugin: "reports", path: "apiKey" }
      ),
  },
  PLUGIN_SECRET_PATH_EMPTY: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "invalid-secret-path",
        'Plugin "reports" declares an empty secret path.',
        { plugin: "reports" }
      ),
  },
  PLUGIN_SECRET_PATH_UNKNOWN: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "unknown-secret-path",
        'Plugin "reports" declares the secret path "apiKey", which its settings schema does not contain.',
        { plugin: "reports", path: "apiKey" }
      ),
  },
  PLUGIN_SECRET_PATH_NAMES_GROUP: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "secret-path-names-group",
        'Plugin "reports" declares the secret path "provider", which names a group of settings rather than one value; name the value inside it.',
        { plugin: "reports", path: "provider" }
      ),
  },
  PLUGIN_SECRET_PATH_NOT_STRING: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "secret-path-not-string",
        'Plugin "reports" declares the secret path "retries", which names a value that cannot be a string; a secret is stored as a string.',
        { plugin: "reports", path: "retries" }
      ),
  },
  PLUGIN_NAME_TOO_LONG_FOR_SETTINGS: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "plugin-name-too-long-for-settings",
        `Plugin "${"reports-".repeat(25)}" stores settings, and its name is longer than the 191 characters the settings storage holds.`,
        { plugin: "reports-".repeat(25), maxLength: 191 }
      ),
  },
  PLUGIN_SETTINGS_KEY_TOO_LONG: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "settings-key-too-long",
        `Plugin "reports" declares the settings key "${"delivery".repeat(25)}", which is longer than the 191 characters the settings storage holds.`,
        { plugin: "reports", key: "delivery".repeat(25), maxLength: 191 }
      ),
  },
  PLUGIN_CAPABILITY_PROVIDED_TWICE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      resolutionError(
        "capability-provided-twice",
        'Plugins "mailer" and "smtp" both provide the capability "email".',
        { capability: "email", providers: ["mailer", "smtp"] }
      ),
  },
  PLUGIN_CAPABILITY_MISSING: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validateRequires([plugin("reports", { requires: { email: "^1.0.0" } })])
      ),
  },
  PLUGIN_CAPABILITY_VERSION_INCOMPATIBLE: {
    code: "PLUGIN_RESOLUTION_ERROR",
    make: () =>
      thrown(() =>
        validateRequires([
          plugin("mailer", { provides: ["email"] }),
          plugin("reports", { requires: { email: "^2.0.0" } }),
        ])
      ),
  },
};
