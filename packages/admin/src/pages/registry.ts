import { lazy } from "react";

import { settingsPanelSlugs } from "../components/layout/sidebar/lib/settings-nav";
import {
  API_KEYS_LIST_PERMISSIONS,
  RELEASE_SECTION_PERMISSIONS,
} from "../constants/navigation";
import { type PublicRoutePath, ROUTES } from "../constants/routes";
import {
  builderSection,
  collectionContentSection,
  overridableBy,
} from "../lib/navigation/section-resolvers";
import { API_KEY_ACTION_PERMISSIONS } from "../lib/permissions/api-key-actions";
import type { PageProps } from "../lib/routing";
import type { RouteSection } from "../types/route-section";

import AcceptInvitePage from "./(auth)/accept-invite";
import ForgotPasswordPage from "./(auth)/forgot-password";
import LoginPage from "./(auth)/login";
import RegisterPage from "./(auth)/register";
import ResetPasswordPage from "./(auth)/reset-password";
import SetupPage from "./(auth)/setup";
import VerifyEmailPage from "./(auth)/verify-email";
import CollectionsPage from "./dashboard/collection/index";
import EditEntryPage from "./dashboard/entries/[slug]/[id]/index";
import EntryVersionsPage from "./dashboard/entries/[slug]/[id]/versions";
import APIPlaygroundPage from "./dashboard/entries/[slug]/api";
import CreateEntryPage from "./dashboard/entries/[slug]/create";
import CollectionEntriesPage from "./dashboard/entries/[slug]/index";
import FieldGroupsPage from "./dashboard/field-group/index";
import DashboardPage from "./dashboard/index";
import MediaLibraryPage from "./dashboard/media/index";
import PluginDetailPage from "./dashboard/plugins/[slug]";
import PluginSettingsPage from "./dashboard/plugins/[slug]/settings";
import PluginBrowsePage from "./dashboard/plugins/browse";
import PluginsOverviewPage from "./dashboard/plugins/index";
import CollectionsLandingRedirect from "./dashboard/redirects/CollectionsLandingRedirect";
import FieldGroupsLandingRedirect from "./dashboard/redirects/FieldGroupsLandingRedirect";
import SinglesLandingRedirect from "./dashboard/redirects/SinglesLandingRedirect";
import ReleaseDetailPage from "./dashboard/releases/[id]";
import ReleasesPage from "./dashboard/releases/index";
import RolesPage from "./dashboard/roles";
import RolesCreatePage from "./dashboard/roles/create";
import RolesEditPage from "./dashboard/roles/edit";
import CreateApiKeyPage from "./dashboard/settings/api-keys/create";
import EditApiKeyPage from "./dashboard/settings/api-keys/edit/[id]";
import ApiKeysPage from "./dashboard/settings/api-keys/index";
import BackgroundJobsPage from "./dashboard/settings/background-jobs/index";
import CreateEmailProviderPage from "./dashboard/settings/email-providers/create";
import EditEmailProviderPage from "./dashboard/settings/email-providers/edit/[id]";
import EmailProvidersPage from "./dashboard/settings/email-providers/index";
import CreateEmailTemplatePage from "./dashboard/settings/email-templates/create";
import EditEmailTemplatePage from "./dashboard/settings/email-templates/edit/[id]";
import EmailTemplatesPage from "./dashboard/settings/email-templates/index";
import CreateImageSizePage from "./dashboard/settings/image-sizes/create";
import EditImageSizePage from "./dashboard/settings/image-sizes/edit/[id]";
import ImageSizesSettingsPage from "./dashboard/settings/image-sizes/index";
import SettingsPage from "./dashboard/settings/index";
import SettingsPermissionsPage from "./dashboard/settings/permissions/index";
import WebhookDeliveryDetailPage from "./dashboard/settings/webhooks/[id]/deliveries/[deliveryId]";
import WebhookDeliveriesPage from "./dashboard/settings/webhooks/[id]/deliveries/index";
import CreateWebhookPage from "./dashboard/settings/webhooks/create";
import EditWebhookPage from "./dashboard/settings/webhooks/edit/[id]";
import WebhooksPage from "./dashboard/settings/webhooks/index";
import SingleAPIPlaygroundPage from "./dashboard/singles/[slug]/api";
import SingleEditPage from "./dashboard/singles/[slug]/index";
import SingleVersionsPage from "./dashboard/singles/[slug]/versions";
import SinglesPage from "./dashboard/singles/index";
import TranslationsPage from "./dashboard/translations/index";
import CreateUserPage from "./dashboard/users/create";
import EditUserPage from "./dashboard/users/edit";
import CreateUserFieldPage from "./dashboard/users/fields/create";
import EditUserFieldPage from "./dashboard/users/fields/edit/[id]";
import UserFieldsPage from "./dashboard/users/fields/index";
import DashboardUsersPage from "./dashboard/users/index";

// Builder pages are lazy-loaded so that heavy dependencies (@dnd-kit, Lexical,
// CodeMirror, schema-builder components) are split into separate chunks and
// only fetched when navigating to builder routes.
const CollectionBuilderPage = lazy(
  () => import("./dashboard/collections/builder/index")
);
const CollectionBuilderEditPage = lazy(
  () => import("./dashboard/collections/builder/[slug]")
);
const FieldGroupBuilderPage = lazy(
  () => import("./dashboard/field-group/builder/index")
);
const FieldGroupBuilderEditPage = lazy(
  () => import("./dashboard/field-group/builder/[slug]")
);
const SingleBuilderPage = lazy(
  () => import("./dashboard/singles/builder/index")
);
const SingleBuilderEditPage = lazy(
  () => import("./dashboard/singles/builder/[slug]")
);

interface RouteConfigBase {
  component: React.ComponentType<PageProps>;
  /**
   * Permission required to access this route. A single slug, or a list treated
   * as any-of (holding any one grants access — models an umbrella permission).
   * Routes without this are accessible to all authenticated users.
   */
  requiredPermission?: string | string[];
  /**
   * Route belongs to the schema builder, so it is only reachable where the
   * builder is enabled (`admin.branding.showBuilder`; off in production by
   * default). Its links are already hidden there — this covers arriving by URL.
   */
  requiresBuilder?: boolean;
}

/**
 * A route, and everything decided about it at declaration time.
 *
 * Split on `type` so the two states carry different obligations. A private
 * route MUST name the rail section it belongs to: the sidebar reads that
 * declaration rather than matching the URL, so a route added without one is a
 * compile error instead of a page that silently highlights Dashboard. A public
 * route renders outside the dashboard shell and has no rail at all, so naming a
 * section there would be meaningless — the union makes both unrepresentable
 * rather than relying on anyone to remember.
 */
export type RouteConfig =
  | (RouteConfigBase & { type: "public" })
  | (RouteConfigBase & { type: "private"; section: RouteSection });

/**
 * The page that answers each public route.
 *
 * Keyed by `PublicRoutePath` rather than by `string`, so the compiler requires
 * exactly the paths `PUBLIC_ROUTE_PATHS` declares: a path added there without a
 * page fails to build, and a page here for a path not declared public is
 * rejected. That is what keeps the two in step, since the interceptor derives
 * its own copy from the same declaration and cannot import this module.
 */
const PUBLIC_PAGES: Record<PublicRoutePath, React.ComponentType<PageProps>> = {
  [ROUTES.SETUP]: SetupPage,
  [ROUTES.LOGIN]: LoginPage,
  [ROUTES.REGISTER]: RegisterPage,
  [ROUTES.FORGOT_PASSWORD]: ForgotPasswordPage,
  [ROUTES.RESET_PASSWORD]: ResetPasswordPage,
  [ROUTES.VERIFY_EMAIL]: VerifyEmailPage,
  [ROUTES.ACCEPT_INVITE]: AcceptInvitePage,
};

/**
 * `PUBLIC_PAGES` as registry entries. Every one is `type: "public"` by
 * construction, so no entry can be declared public in one place and private in
 * the other.
 */
const publicRouteConfig: Record<string, RouteConfig> = Object.fromEntries(
  Object.entries(PUBLIC_PAGES).map(([path, component]) => [
    path,
    { component, type: "public" },
  ])
);

export const routeConfig: Record<string, RouteConfig> = {
  ...publicRouteConfig,

  // Dashboard route (homepage)
  [ROUTES.DASHBOARD]: {
    component: DashboardPage,
    type: "private",
    section: "dashboard",
  },

  // Users routes
  [ROUTES.USERS]: {
    component: DashboardUsersPage,
    type: "private",
    requiredPermission: "read-users",
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_CREATE]: {
    component: CreateUserPage,
    type: "private",
    requiredPermission: "create-users",
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_EDIT]: {
    component: EditUserPage,
    type: "private",
    requiredPermission: "update-users",
    section: overridableBy("settings"),
  },

  // Media routes
  [ROUTES.MEDIA]: {
    component: MediaLibraryPage,
    type: "private",
    requiredPermission: "read-media",
    section: overridableBy("media"),
  },
  [ROUTES.RELEASES]: {
    component: ReleasesPage,
    type: "private",
    // Gated on the SEEDED slug. The resource is `content-releases`, not
    // `releases`: registering the shorter name would reserve a word real sites
    // use for content. A permission that is not seeded matches nobody, so
    // naming one here would hide the page from every user including an
    // administrator, with nothing erroring to say so.
    requiredPermission: RELEASE_SECTION_PERMISSIONS,
    section: overridableBy("releases"),
  },
  [ROUTES.RELEASES_DETAIL]: {
    component: ReleaseDetailPage,
    type: "private",
    // The same grants as the list. A detail route gated more loosely than the
    // list it is reached from would be a way around the list's own gate.
    requiredPermission: RELEASE_SECTION_PERMISSIONS,
    section: overridableBy("releases"),
  },
  [ROUTES.TRANSLATIONS]: {
    component: TranslationsPage,
    type: "private",
    // No permission of its own: the page lists nothing the caller may not
    // already read. Every row comes back through the collection read rules, so
    // a reader with access to one collection sees exactly that collection's
    // outstanding work, and one with access to none sees an empty list rather
    // than a refusal.
    //
    // Its own rail section rather than Collections': the page exists to cross
    // collection boundaries, so highlighting one collection's rail while
    // showing every collection's work would point at the wrong thing.
    section: overridableBy("translations"),
  },

  // ============================================================
  // Builder — Collections (schema management).
  // /admin/collections/*). Old routes below redirect.
  // ============================================================
  [ROUTES.BUILDER_COLLECTIONS]: {
    component: CollectionsPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_COLLECTIONS_NEW]: {
    component: CollectionBuilderPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_COLLECTIONS_EDIT]: {
    component: CollectionBuilderEditPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },

  // ============================================================
  // Section landing redirects.
  //
  // hits one of these instead of a static schema-list. The router
  // picks the most-recently-created record, navigates to its content
  // URL, or surfaces 404 when none exist. Components is a static
  // redirect into the Builder since components have no content surface.
  // IMPORTANT: these section-landing routes must be registered BEFORE
  // the matching content routes (/admin/collections/[slug] etc.) so
  // the literal /admin/collections takes priority over the wildcard.
  // ============================================================
  [ROUTES.COLLECTIONS]: {
    component: CollectionsLandingRedirect,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.SINGLES]: {
    component: SinglesLandingRedirect,
    type: "private",
    section: overridableBy("singles"),
  },
  [ROUTES.FIELD_GROUPS]: {
    component: FieldGroupsLandingRedirect,
    type: "private",
    section: overridableBy("collections"),
  },

  // Collection entries routes (dynamic collections).
  // IMPORTANT: Routes with literal segments (create, api) must be
  // registered BEFORE the wildcard [id] route to ensure correct matching.
  [ROUTES.COLLECTION_ENTRIES]: {
    component: CollectionEntriesPage,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.COLLECTION_ENTRY_CREATE]: {
    component: CreateEntryPage,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.COLLECTION_ENTRY_API]: {
    component: APIPlaygroundPage,
    type: "private",
    section: collectionContentSection,
  },
  // Before the wildcard [id] route, matching the convention above. The
  // matcher's patterns are anchored so a four-segment path cannot be taken by
  // the two-segment edit route, but keeping the order makes that independent of
  // how the matcher is written.
  [ROUTES.COLLECTION_ENTRY_VERSIONS]: {
    component: EntryVersionsPage,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.COLLECTION_ENTRY_EDIT]: {
    component: EditEntryPage,
    type: "private",
    section: collectionContentSection,
  },

  // Security & Roles routes
  [ROUTES.SECURITY_ROLES]: {
    component: RolesPage,
    type: "private",
    requiredPermission: "read-roles",
    section: overridableBy("settings"),
  },
  [ROUTES.SECURITY_ROLES_CREATE]: {
    component: RolesCreatePage,
    type: "private",
    requiredPermission: "create-roles",
    section: overridableBy("settings"),
  },
  [ROUTES.SECURITY_ROLES_EDIT]: {
    component: RolesEditPage,
    type: "private",
    requiredPermission: "update-roles",
    section: overridableBy("settings"),
  },

  // ============================================================
  // Builder — Singles (schema management).
  // /admin/builder/singles/* — was /admin/singles + /admin/singles/builder.
  // Single CONTENT urls (/admin/singles/[slug]) stay where they are.
  // ============================================================
  [ROUTES.BUILDER_SINGLES]: {
    component: SinglesPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("singles"),
  },
  [ROUTES.BUILDER_SINGLES_NEW]: {
    component: SingleBuilderPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("singles"),
  },
  [ROUTES.BUILDER_SINGLES_EDIT]: {
    component: SingleBuilderEditPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("singles"),
  },
  // Single CONTENT routes — permission is per-slug (checked server-side).
  // IMPORTANT: literal segments like /api must be registered before the wildcard [slug].
  [ROUTES.SINGLE_API]: {
    component: SingleAPIPlaygroundPage,
    type: "private",
    section: overridableBy("singles"),
  },
  [ROUTES.SINGLE_VERSIONS]: {
    component: SingleVersionsPage,
    type: "private",
    section: overridableBy("singles"),
  },
  [ROUTES.SINGLE_EDIT]: {
    component: SingleEditPage,
    type: "private",
    section: overridableBy("singles"),
  },

  // ============================================================
  // Builder: field groups (schema management).
  // /admin/builder/field-groups/*. Field groups have no content surface.
  // ============================================================
  [ROUTES.BUILDER_FIELD_GROUPS]: {
    component: FieldGroupsPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_FIELD_GROUPS_NEW]: {
    component: FieldGroupBuilderPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_FIELD_GROUPS_EDIT]: {
    component: FieldGroupBuilderEditPage,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },

  // Settings routes
  // Any grant that reaches SOMETHING in the panel may open the panel's own URL.
  // Narrowing it to `manage-settings` turned the rail entry into a door that
  // closed in the face of anyone whose only destination was further in.
  //
  // This guard admits them; it does not place them. The page behind it is
  // General Settings, whose own query answers to `manage-settings`, so a reader
  // admitted here without that grant sees a 403. Nothing on the page sends them
  // elsewhere. The rail is what keeps them off this URL: `resolveSettingsLanding`
  // picks the first destination in the panel they can actually open, and every
  // grant in `settingsPanelSlugs()` opens one, so the fallthrough to
  // `/admin/settings` is unreachable for anyone this guard admits.
  [ROUTES.SETTINGS]: {
    component: SettingsPage,
    type: "private",
    requiredPermission: settingsPanelSlugs(),
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS]: {
    component: EmailProvidersPage,
    type: "private",
    requiredPermission: "manage-email-providers",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS_CREATE]: {
    component: CreateEmailProviderPage,
    type: "private",
    requiredPermission: "manage-email-providers",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS_EDIT]: {
    component: EditEmailProviderPage,
    type: "private",
    requiredPermission: "manage-email-providers",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES]: {
    component: EmailTemplatesPage,
    type: "private",
    requiredPermission: "manage-email-templates",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE]: {
    component: CreateEmailTemplatePage,
    type: "private",
    requiredPermission: "manage-email-templates",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES_EDIT]: {
    component: EditEmailTemplatePage,
    type: "private",
    requiredPermission: "manage-email-templates",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_PERMISSIONS]: {
    component: SettingsPermissionsPage,
    type: "private",
    requiredPermission: "manage-permissions",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_API_KEYS]: {
    component: ApiKeysPage,
    type: "private",
    requiredPermission: [...API_KEYS_LIST_PERMISSIONS],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_API_KEYS_CREATE]: {
    component: CreateApiKeyPage,
    type: "private",
    // The endpoint accepts `create-api-keys` OR the `update-api-keys`
    // umbrella, so the route does too. Guarding on the narrower grant alone
    // turned the Create control into a door that closed on a holder the API
    // would have served.
    requiredPermission: [...API_KEY_ACTION_PERMISSIONS.create],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_API_KEYS_EDIT]: {
    component: EditApiKeyPage,
    type: "private",
    requiredPermission: "update-api-keys",
    section: overridableBy("settings"),
  },

  // Webhooks settings. `update-webhooks` is the backend's management umbrella
  // (it satisfies read/create/delete too), so each route accepts it in addition
  // to the specific slug — a role with only `update-webhooks` still reaches them.
  // The background job monitor is a READ, but it is gated on the management
  // permission: `lastError` is whatever a handler threw, and there is no seeded
  // read-only slug for this resource to widen to.
  [ROUTES.SETTINGS_BACKGROUND_JOBS]: {
    component: BackgroundJobsPage,
    type: "private",
    requiredPermission: "manage-background-jobs",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS]: {
    component: WebhooksPage,
    type: "private",
    requiredPermission: ["read-webhooks", "update-webhooks", "create-webhooks"],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS_CREATE]: {
    component: CreateWebhookPage,
    type: "private",
    requiredPermission: ["create-webhooks", "update-webhooks"],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS_EDIT]: {
    component: EditWebhookPage,
    type: "private",
    requiredPermission: "update-webhooks",
    section: overridableBy("settings"),
  },
  // Delivery log routes are read surfaces, so a plain reader may open them; the
  // redeliver and drain actions inside are separately gated on update-webhooks.
  [ROUTES.SETTINGS_WEBHOOKS_DELIVERIES]: {
    component: WebhookDeliveriesPage,
    type: "private",
    requiredPermission: ["read-webhooks", "update-webhooks"],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS_DELIVERY_DETAIL]: {
    component: WebhookDeliveryDetailPage,
    type: "private",
    requiredPermission: ["read-webhooks", "update-webhooks"],
    section: overridableBy("settings"),
  },

  // Image sizes settings
  [ROUTES.SETTINGS_IMAGE_SIZES]: {
    component: ImageSizesSettingsPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_IMAGE_SIZES_CREATE]: {
    component: CreateImageSizePage,
    type: "private",
    requiredPermission: "manage-settings",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_IMAGE_SIZES_EDIT]: {
    component: EditImageSizePage,
    type: "private",
    requiredPermission: "manage-settings",
    section: overridableBy("settings"),
  },

  // Plugin routes
  [ROUTES.PLUGINS]: {
    component: PluginsOverviewPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: "plugins",
  },
  // Registered outside `/admin/plugins/`, so no ordering rule holds this in
  // place: the directory and a plugin's detail page cannot match the same
  // path, whatever the plugin is called.
  [ROUTES.PLUGIN_BROWSE]: {
    component: PluginBrowsePage,
    type: "private",
    requiredPermission: "manage-settings",
    section: "plugins",
  },
  [ROUTES.PLUGIN_DETAIL]: {
    component: PluginDetailPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: "plugins",
  },
  [ROUTES.PLUGIN_SETTINGS]: {
    component: PluginSettingsPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: "plugins",
  },

  [ROUTES.USERS_FIELDS]: {
    component: UserFieldsPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_FIELDS_CREATE]: {
    component: CreateUserFieldPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_FIELDS_EDIT]: {
    component: EditUserFieldPage,
    type: "private",
    requiredPermission: "manage-settings",
    section: overridableBy("settings"),
  },
};

// D4 (§4.12.4): the visual schema builder is development-only. Drop its
// editor routes in production so they never mount (data editing is
// unaffected; only the schema-builder pages are removed).
if (process.env.NODE_ENV === "production") {
  const devOnlyBuilderRoutes = [
    ROUTES.BUILDER_COLLECTIONS_NEW,
    ROUTES.BUILDER_COLLECTIONS_EDIT,
    ROUTES.BUILDER_SINGLES_NEW,
    ROUTES.BUILDER_SINGLES_EDIT,
    ROUTES.BUILDER_FIELD_GROUPS_NEW,
    ROUTES.BUILDER_FIELD_GROUPS_EDIT,
  ];
  for (const key of devOnlyBuilderRoutes) {
    delete routeConfig[key];
  }
}

// Legacy export for backward compatibility
const registry: Record<string, React.ComponentType<PageProps>> = Object.entries(
  routeConfig
).reduce(
  (acc, [path, config]) => {
    acc[path] = config.component;
    return acc;
  },
  {} as Record<string, React.ComponentType>
);

export default registry;
