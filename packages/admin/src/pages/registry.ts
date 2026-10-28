import { settingsPanelSlugs } from "../components/layout/sidebar/lib/settings-nav";
import {
  EMAIL_HUB_PERMISSIONS,
  EMAIL_PROVIDER_CREATE_PERMISSIONS,
  EMAIL_PROVIDER_READ_PERMISSIONS,
  EMAIL_PROVIDER_UPDATE_PERMISSIONS,
  EMAIL_TEMPLATE_CREATE_PERMISSIONS,
  EMAIL_TEMPLATE_READ_PERMISSIONS,
  EMAIL_TEMPLATE_UPDATE_PERMISSIONS,
} from "../constants/email-hub";
import {
  API_KEYS_LIST_PERMISSIONS,
  RELEASE_SECTION_PERMISSIONS,
} from "../constants/navigation";
import { type PublicRoutePath, ROUTES } from "../constants/routes";
import {
  collectionScreen,
  emailHubScreen,
  railScreen,
  settingsScreen,
  singleScreen,
  type ScreenName,
} from "../lib/navigation/screen-names";
import {
  builderSection,
  collectionContentSection,
  overridableBy,
} from "../lib/navigation/section-resolvers";
import { apiKeyGrantsFor } from "../lib/permissions/api-key-actions";
import {
  CHANGE_SETTINGS,
  CREATE_SETTINGS,
  READ_SETTINGS,
  UPDATE_SETTINGS,
} from "../lib/permissions/system-policy";
import type { PageProps } from "../lib/routing";
import type { RouteSection } from "../types/route-section";

import "../hooks/useUnsavedChanges";
// The unsaved-change guards register their one popstate listener when their
// module evaluates, and it must evaluate before the router adds its own - the
// entry editor was this module's only eager consumer before pages loaded on
// demand, so the module is imported above for that side effect. Ordering is
// the point: the import pulls no page code with it.

import AcceptInvitePage from "./(auth)/accept-invite";
import ForgotPasswordPage from "./(auth)/forgot-password";
import LoginPage from "./(auth)/login";
import RegisterPage from "./(auth)/register";
import ResetPasswordPage from "./(auth)/reset-password";
import SetupPage from "./(auth)/setup";
import VerifyEmailPage from "./(auth)/verify-email";
import { lazyRoute } from "./lazy-route";
// The other pages load through the same wrapper as the builders:
// each chunk is fetched when its route renders, so opening one screen
// does not download the other pages.
const CollectionsPage = lazyRoute(() => import("./dashboard/collection/index"));
const EmailDesignPage = lazyRoute(() => import("./dashboard/email/design"));
const EmailMessagesPage = lazyRoute(() => import("./dashboard/email/index"));
const CreateEmailTemplatePage = lazyRoute(
  () => import("./dashboard/email/messages/create")
);
const EditEmailTemplatePage = lazyRoute(
  () => import("./dashboard/email/messages/edit/[id]")
);
const CreateEmailProviderPage = lazyRoute(
  () => import("./dashboard/email/sending/create")
);
const EditEmailProviderPage = lazyRoute(
  () => import("./dashboard/email/sending/edit/[id]")
);
const EmailProvidersPage = lazyRoute(
  () => import("./dashboard/email/sending/index")
);
const EditEntryPage = lazyRoute(
  () => import("./dashboard/entries/[slug]/[id]/index")
);
const EntryVersionsPage = lazyRoute(
  () => import("./dashboard/entries/[slug]/[id]/versions")
);
const APIPlaygroundPage = lazyRoute(
  () => import("./dashboard/entries/[slug]/api")
);
const CreateEntryPage = lazyRoute(
  () => import("./dashboard/entries/[slug]/create")
);
const CollectionEntriesPage = lazyRoute(
  () => import("./dashboard/entries/[slug]/index")
);
const FieldGroupsPage = lazyRoute(
  () => import("./dashboard/field-group/index")
);
const DashboardPage = lazyRoute(() => import("./dashboard/index"));
const MediaLibraryPage = lazyRoute(() => import("./dashboard/media/index"));
const PluginDetailPage = lazyRoute(() => import("./dashboard/plugins/[slug]"));
const PluginSettingsPage = lazyRoute(
  () => import("./dashboard/plugins/[slug]/settings")
);
const PluginBrowsePage = lazyRoute(() => import("./dashboard/plugins/browse"));
const PluginsOverviewPage = lazyRoute(
  () => import("./dashboard/plugins/index")
);
const CollectionsLandingRedirect = lazyRoute(
  () => import("./dashboard/redirects/CollectionsLandingRedirect")
);
const EmailSettingsRedirect = lazyRoute(
  () => import("./dashboard/redirects/EmailSettingsRedirect")
);
const FieldGroupsLandingRedirect = lazyRoute(
  () => import("./dashboard/redirects/FieldGroupsLandingRedirect")
);
const SinglesLandingRedirect = lazyRoute(
  () => import("./dashboard/redirects/SinglesLandingRedirect")
);
const ReleaseDetailPage = lazyRoute(() => import("./dashboard/releases/[id]"));
const ReleasesPage = lazyRoute(() => import("./dashboard/releases/index"));
const RolesPage = lazyRoute(() => import("./dashboard/roles"));
const RolesCreatePage = lazyRoute(() => import("./dashboard/roles/create"));
const RolesEditPage = lazyRoute(() => import("./dashboard/roles/edit"));
const CreateApiKeyPage = lazyRoute(
  () => import("./dashboard/settings/api-keys/create")
);
const EditApiKeyPage = lazyRoute(
  () => import("./dashboard/settings/api-keys/edit/[id]")
);
const ApiKeysPage = lazyRoute(
  () => import("./dashboard/settings/api-keys/index")
);
const BackgroundJobsPage = lazyRoute(
  () => import("./dashboard/settings/background-jobs/index")
);
const CreateImageSizePage = lazyRoute(
  () => import("./dashboard/settings/image-sizes/create")
);
const EditImageSizePage = lazyRoute(
  () => import("./dashboard/settings/image-sizes/edit/[id]")
);
const ImageSizesSettingsPage = lazyRoute(
  () => import("./dashboard/settings/image-sizes/index")
);
const SettingsPage = lazyRoute(() => import("./dashboard/settings/index"));
const SettingsPermissionsPage = lazyRoute(
  () => import("./dashboard/settings/permissions/index")
);
const WebhookDeliveryDetailPage = lazyRoute(
  () => import("./dashboard/settings/webhooks/[id]/deliveries/[deliveryId]")
);
const WebhookDeliveriesPage = lazyRoute(
  () => import("./dashboard/settings/webhooks/[id]/deliveries/index")
);
const CreateWebhookPage = lazyRoute(
  () => import("./dashboard/settings/webhooks/create")
);
const EditWebhookPage = lazyRoute(
  () => import("./dashboard/settings/webhooks/edit/[id]")
);
const WebhooksPage = lazyRoute(
  () => import("./dashboard/settings/webhooks/index")
);
const SingleAPIPlaygroundPage = lazyRoute(
  () => import("./dashboard/singles/[slug]/api")
);
const SingleEditPage = lazyRoute(
  () => import("./dashboard/singles/[slug]/index")
);
const SingleVersionsPage = lazyRoute(
  () => import("./dashboard/singles/[slug]/versions")
);
const SinglesPage = lazyRoute(() => import("./dashboard/singles/index"));
const TranslationsPage = lazyRoute(
  () => import("./dashboard/translations/index")
);
const CreateUserPage = lazyRoute(() => import("./dashboard/users/create"));
const EditUserPage = lazyRoute(() => import("./dashboard/users/edit"));
const CreateUserFieldPage = lazyRoute(
  () => import("./dashboard/users/fields/create")
);
const EditUserFieldPage = lazyRoute(
  () => import("./dashboard/users/fields/edit/[id]")
);
const UserFieldsPage = lazyRoute(
  () => import("./dashboard/users/fields/index")
);
const DashboardUsersPage = lazyRoute(() => import("./dashboard/users/index"));

// Heavy builder dependencies (@dnd-kit, Lexical, CodeMirror,
// schema-builder components) stay in chunks fetched when a builder opens, and
// the wrapper gives them the same retry a failed fetch gets anywhere else.
const CollectionBuilderPage = lazyRoute(
  () => import("./dashboard/collections/builder/index")
);
const CollectionBuilderEditPage = lazyRoute(
  () => import("./dashboard/collections/builder/[slug]")
);
const FieldGroupBuilderPage = lazyRoute(
  () => import("./dashboard/field-group/builder/index")
);
const FieldGroupBuilderEditPage = lazyRoute(
  () => import("./dashboard/field-group/builder/[slug]")
);
const SingleBuilderPage = lazyRoute(
  () => import("./dashboard/singles/builder/index")
);
const SingleBuilderEditPage = lazyRoute(
  () => import("./dashboard/singles/builder/[slug]")
);

interface RouteConfigBase {
  component: React.ComponentType<PageProps>;
  /**
   * What the browser tab calls this screen, before the site's name. Required,
   * so a route added without one fails to compile instead of leaving its tab
   * unnamed. Read from the sidebar's label wherever the sidebar names the
   * destination (`railScreen`, `settingsScreen`), from the open collection or
   * Single on content routes, and spelled here only for screens nothing else
   * names. See `lib/navigation/screen-names`.
   */
  screenName: ScreenName;
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
// Each public page carries its screen name with it. The signed-out screens
// have no sidebar to read a name from, so these are the one place they are
// named, after what each screen is for.
const PUBLIC_PAGES: Record<
  PublicRoutePath,
  Pick<RouteConfigBase, "component" | "screenName">
> = {
  [ROUTES.SETUP]: { component: SetupPage, screenName: "Set Up" },
  [ROUTES.LOGIN]: { component: LoginPage, screenName: "Sign In" },
  [ROUTES.REGISTER]: { component: RegisterPage, screenName: "Create Account" },
  [ROUTES.FORGOT_PASSWORD]: {
    component: ForgotPasswordPage,
    screenName: "Forgot Password",
  },
  [ROUTES.RESET_PASSWORD]: {
    component: ResetPasswordPage,
    screenName: "Reset Password",
  },
  [ROUTES.VERIFY_EMAIL]: {
    component: VerifyEmailPage,
    screenName: "Verify Email",
  },
  [ROUTES.ACCEPT_INVITE]: {
    component: AcceptInvitePage,
    screenName: "Accept Invitation",
  },
};

/**
 * `PUBLIC_PAGES` as registry entries. Every one is `type: "public"` by
 * construction, so no entry can be declared public in one place and private in
 * the other.
 */
const publicRouteConfig: Record<string, RouteConfig> = Object.fromEntries(
  Object.entries(PUBLIC_PAGES).map(([path, page]) => [
    path,
    { ...page, type: "public" },
  ])
);

/**
 * Names for screens the sidebar lists only in markup, not in a declaration
 * this table can read: the builder panel's three entries. Each is named once
 * here and shared by the list, create and edit screens it covers.
 */
const BUILDER_COLLECTIONS_NAME = "Collections";
const BUILDER_SINGLES_NAME = "Singles";
const BUILDER_FIELD_GROUPS_NAME = "Field Groups";

/**
 * General settings is listed in its panel as "General", which reads as a
 * setting only under the panel's group heading. Alone in a tab it needs the
 * word its page heading gives it.
 */
const GENERAL_SETTINGS_NAME = "General Settings";

export const routeConfig: Record<string, RouteConfig> = {
  ...publicRouteConfig,

  // Dashboard route (homepage)
  [ROUTES.DASHBOARD]: {
    component: DashboardPage,
    screenName: railScreen("dashboard"),
    type: "private",
    section: "dashboard",
  },

  // Users routes
  [ROUTES.USERS]: {
    component: DashboardUsersPage,
    screenName: settingsScreen(ROUTES.USERS),
    type: "private",
    requiredPermission: "read-users",
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_CREATE]: {
    component: CreateUserPage,
    screenName: settingsScreen(ROUTES.USERS),
    type: "private",
    requiredPermission: "create-users",
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_EDIT]: {
    component: EditUserPage,
    screenName: settingsScreen(ROUTES.USERS),
    type: "private",
    requiredPermission: "update-users",
    section: overridableBy("settings"),
  },

  // Media routes
  [ROUTES.MEDIA]: {
    component: MediaLibraryPage,
    screenName: railScreen("media"),
    type: "private",
    requiredPermission: "read-media",
    section: overridableBy("media"),
  },
  [ROUTES.RELEASES]: {
    component: ReleasesPage,
    screenName: railScreen("releases"),
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
    screenName: railScreen("releases"),
    type: "private",
    // The same grants as the list. A detail route gated more loosely than the
    // list it is reached from would be a way around the list's own gate.
    requiredPermission: RELEASE_SECTION_PERMISSIONS,
    section: overridableBy("releases"),
  },
  [ROUTES.TRANSLATIONS]: {
    component: TranslationsPage,
    screenName: railScreen("translations"),
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
    screenName: BUILDER_COLLECTIONS_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_COLLECTIONS_NEW]: {
    component: CollectionBuilderPage,
    screenName: BUILDER_COLLECTIONS_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_COLLECTIONS_EDIT]: {
    component: CollectionBuilderEditPage,
    screenName: BUILDER_COLLECTIONS_NAME,
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
    // Named here, not by the rail: the rail holds one Content item for both, so it has no
    // Collections item to read a label from.
    screenName: "Collections",
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.SINGLES]: {
    component: SinglesLandingRedirect,
    // As Collections above: the rail's one Content item holds Singles too.
    screenName: "Singles",
    type: "private",
    section: overridableBy("singles"),
  },
  [ROUTES.FIELD_GROUPS]: {
    component: FieldGroupsLandingRedirect,
    screenName: BUILDER_FIELD_GROUPS_NAME,
    type: "private",
    section: overridableBy("collections"),
  },

  // Collection entries routes (dynamic collections).
  // IMPORTANT: Routes with literal segments (create, api) must be
  // registered BEFORE the wildcard [id] route to ensure correct matching.
  [ROUTES.COLLECTION_ENTRIES]: {
    component: CollectionEntriesPage,
    screenName: collectionScreen,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.COLLECTION_ENTRY_CREATE]: {
    component: CreateEntryPage,
    screenName: collectionScreen,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.COLLECTION_ENTRY_API]: {
    component: APIPlaygroundPage,
    screenName: collectionScreen,
    type: "private",
    section: collectionContentSection,
  },
  // Before the wildcard [id] route, matching the convention above. The
  // matcher's patterns are anchored so a four-segment path cannot be taken by
  // the two-segment edit route, but keeping the order makes that independent of
  // how the matcher is written.
  [ROUTES.COLLECTION_ENTRY_VERSIONS]: {
    component: EntryVersionsPage,
    screenName: collectionScreen,
    type: "private",
    section: collectionContentSection,
  },
  [ROUTES.COLLECTION_ENTRY_EDIT]: {
    component: EditEntryPage,
    screenName: collectionScreen,
    type: "private",
    section: collectionContentSection,
  },
  // The entry's own page draws a plugin's document view, so the document's
  // loading, lock, recovery and save are the editor's and not re-implemented.
  // After the versions route, which must keep its address.
  [ROUTES.COLLECTION_ENTRY_VIEW]: {
    component: EditEntryPage,
    screenName: collectionScreen,
    type: "private",
    section: collectionContentSection,
  },

  // Security & Roles routes
  [ROUTES.SECURITY_ROLES]: {
    component: RolesPage,
    screenName: settingsScreen(ROUTES.SECURITY_ROLES),
    type: "private",
    requiredPermission: "read-roles",
    section: overridableBy("settings"),
  },
  [ROUTES.SECURITY_ROLES_CREATE]: {
    component: RolesCreatePage,
    screenName: settingsScreen(ROUTES.SECURITY_ROLES),
    type: "private",
    requiredPermission: "create-roles",
    section: overridableBy("settings"),
  },
  [ROUTES.SECURITY_ROLES_EDIT]: {
    component: RolesEditPage,
    screenName: settingsScreen(ROUTES.SECURITY_ROLES),
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
    screenName: BUILDER_SINGLES_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("singles"),
  },
  [ROUTES.BUILDER_SINGLES_NEW]: {
    component: SingleBuilderPage,
    screenName: BUILDER_SINGLES_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("singles"),
  },
  [ROUTES.BUILDER_SINGLES_EDIT]: {
    component: SingleBuilderEditPage,
    screenName: BUILDER_SINGLES_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("singles"),
  },
  // Single CONTENT routes — permission is per-slug (checked server-side).
  // IMPORTANT: literal segments like /api must be registered before the wildcard [slug].
  [ROUTES.SINGLE_API]: {
    component: SingleAPIPlaygroundPage,
    screenName: singleScreen,
    type: "private",
    section: overridableBy("singles"),
  },
  [ROUTES.SINGLE_VERSIONS]: {
    component: SingleVersionsPage,
    screenName: singleScreen,
    type: "private",
    section: overridableBy("singles"),
  },
  [ROUTES.SINGLE_EDIT]: {
    component: SingleEditPage,
    screenName: singleScreen,
    type: "private",
    section: overridableBy("singles"),
  },
  // The Single's own page draws a plugin's document view, for the reason the
  // entry route above gives. After the api and versions routes.
  [ROUTES.SINGLE_VIEW]: {
    component: SingleEditPage,
    screenName: singleScreen,
    type: "private",
    section: overridableBy("singles"),
  },

  // ============================================================
  // Builder: field groups (schema management).
  // /admin/builder/field-groups/*. Field groups have no content surface.
  // ============================================================
  [ROUTES.BUILDER_FIELD_GROUPS]: {
    component: FieldGroupsPage,
    screenName: BUILDER_FIELD_GROUPS_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_FIELD_GROUPS_NEW]: {
    component: FieldGroupBuilderPage,
    screenName: BUILDER_FIELD_GROUPS_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },
  [ROUTES.BUILDER_FIELD_GROUPS_EDIT]: {
    component: FieldGroupBuilderEditPage,
    screenName: BUILDER_FIELD_GROUPS_NAME,
    type: "private",
    requiresBuilder: true,
    section: builderSection("collections"),
  },

  // Settings routes
  // Any grant that reaches SOMETHING in the panel may open the panel's own URL.
  // Narrowing it to `read-settings` turned the rail entry into a door that
  // closed in the face of anyone whose only destination was further in.
  //
  // This guard admits them; it does not place them. The page behind it is
  // General Settings, whose own query answers to `read-settings`, so a reader
  // admitted here without that grant sees a 403. Nothing on the page sends them
  // elsewhere. The rail is what keeps them off this URL: `resolveSettingsLanding`
  // picks the first destination in the panel they can actually open, and every
  // grant in `settingsPanelSlugs()` opens one, so the fallthrough to
  // `/admin/settings` is unreachable for anyone this guard admits.
  // ============================================================
  // The Email hub. Each tab is guarded by the grants that read what it shows,
  // and each editor by the grant its save needs; the server checks the same
  // grants again on every request. The landing page admits any hub grant and
  // moves a reader who may not see Messages on to a tab they may see.
  // Literal paths are registered before the [id] ones they would match.
  // ============================================================
  [ROUTES.EMAIL]: {
    component: EmailMessagesPage,
    screenName: emailHubScreen(ROUTES.EMAIL),
    type: "private",
    requiredPermission: [...EMAIL_HUB_PERMISSIONS],
    section: "email",
  },
  [ROUTES.EMAIL_DESIGN]: {
    component: EmailDesignPage,
    screenName: emailHubScreen(ROUTES.EMAIL_DESIGN),
    type: "private",
    requiredPermission: [...EMAIL_TEMPLATE_READ_PERMISSIONS],
    section: "email",
  },
  [ROUTES.EMAIL_SENDING]: {
    component: EmailProvidersPage,
    screenName: emailHubScreen(ROUTES.EMAIL_SENDING),
    type: "private",
    requiredPermission: [...EMAIL_PROVIDER_READ_PERMISSIONS],
    section: "email",
  },
  [ROUTES.EMAIL_MESSAGES_CREATE]: {
    component: CreateEmailTemplatePage,
    screenName: emailHubScreen(ROUTES.EMAIL),
    type: "private",
    requiredPermission: [...EMAIL_TEMPLATE_CREATE_PERMISSIONS],
    section: "email",
  },
  [ROUTES.EMAIL_MESSAGES_EDIT]: {
    component: EditEmailTemplatePage,
    screenName: emailHubScreen(ROUTES.EMAIL),
    type: "private",
    requiredPermission: [...EMAIL_TEMPLATE_UPDATE_PERMISSIONS],
    section: "email",
  },
  [ROUTES.EMAIL_SENDING_CREATE]: {
    component: CreateEmailProviderPage,
    screenName: emailHubScreen(ROUTES.EMAIL_SENDING),
    type: "private",
    requiredPermission: [...EMAIL_PROVIDER_CREATE_PERMISSIONS],
    section: "email",
  },
  [ROUTES.EMAIL_SENDING_EDIT]: {
    component: EditEmailProviderPage,
    screenName: emailHubScreen(ROUTES.EMAIL_SENDING),
    type: "private",
    requiredPermission: [...EMAIL_PROVIDER_UPDATE_PERMISSIONS],
    section: "email",
  },

  [ROUTES.SETTINGS]: {
    component: SettingsPage,
    screenName: GENERAL_SETTINGS_NAME,
    type: "private",
    requiredPermission: settingsPanelSlugs(),
    section: overridableBy("settings"),
  },
  // Where email lived before the hub. Each redirects to its place there, and
  // carries no permission of its own: the page it lands on is guarded, and a
  // refusal here would leave the reader on a URL that no longer means
  // anything.
  [ROUTES.SETTINGS_EMAIL_PROVIDERS]: {
    component: EmailSettingsRedirect,
    screenName: emailHubScreen(ROUTES.EMAIL_SENDING),
    type: "private",
    section: "email",
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS_CREATE]: {
    component: EmailSettingsRedirect,
    screenName: emailHubScreen(ROUTES.EMAIL_SENDING),
    type: "private",
    section: "email",
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS_EDIT]: {
    component: EmailSettingsRedirect,
    screenName: emailHubScreen(ROUTES.EMAIL_SENDING),
    type: "private",
    section: "email",
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES]: {
    component: EmailSettingsRedirect,
    screenName: emailHubScreen(ROUTES.EMAIL),
    type: "private",
    section: "email",
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE]: {
    component: EmailSettingsRedirect,
    screenName: emailHubScreen(ROUTES.EMAIL),
    type: "private",
    section: "email",
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES_EDIT]: {
    component: EmailSettingsRedirect,
    screenName: emailHubScreen(ROUTES.EMAIL),
    type: "private",
    section: "email",
  },
  [ROUTES.SETTINGS_PERMISSIONS]: {
    component: SettingsPermissionsPage,
    // Not an entry in the settings panel, so named after its page heading.
    screenName: "Permissions",
    type: "private",
    requiredPermission: "manage-permissions",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_API_KEYS]: {
    component: ApiKeysPage,
    screenName: settingsScreen(ROUTES.SETTINGS_API_KEYS),
    type: "private",
    requiredPermission: [...API_KEYS_LIST_PERMISSIONS],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_API_KEYS_CREATE]: {
    component: CreateApiKeyPage,
    screenName: settingsScreen(ROUTES.SETTINGS_API_KEYS),
    type: "private",
    // The endpoint accepts `create-api-keys` OR the `update-api-keys`
    // umbrella, so the route does too. Guarding on the narrower grant alone
    // turned the Create control into a door that closed on a holder the API
    // would have served.
    requiredPermission: apiKeyGrantsFor("create"),
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_API_KEYS_EDIT]: {
    component: EditApiKeyPage,
    screenName: settingsScreen(ROUTES.SETTINGS_API_KEYS),
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
    screenName: settingsScreen(ROUTES.SETTINGS_BACKGROUND_JOBS),
    type: "private",
    requiredPermission: "manage-background-jobs",
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS]: {
    component: WebhooksPage,
    screenName: settingsScreen(ROUTES.SETTINGS_WEBHOOKS),
    type: "private",
    requiredPermission: ["read-webhooks", "update-webhooks", "create-webhooks"],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS_CREATE]: {
    component: CreateWebhookPage,
    screenName: settingsScreen(ROUTES.SETTINGS_WEBHOOKS),
    type: "private",
    requiredPermission: ["create-webhooks", "update-webhooks"],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS_EDIT]: {
    component: EditWebhookPage,
    screenName: settingsScreen(ROUTES.SETTINGS_WEBHOOKS),
    type: "private",
    requiredPermission: "update-webhooks",
    section: overridableBy("settings"),
  },
  // Delivery log routes are read surfaces, so a plain reader may open them; the
  // redeliver and drain actions inside are separately gated on update-webhooks.
  [ROUTES.SETTINGS_WEBHOOKS_DELIVERIES]: {
    component: WebhookDeliveriesPage,
    screenName: settingsScreen(ROUTES.SETTINGS_WEBHOOKS),
    type: "private",
    requiredPermission: ["read-webhooks", "update-webhooks"],
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_WEBHOOKS_DELIVERY_DETAIL]: {
    component: WebhookDeliveryDetailPage,
    screenName: settingsScreen(ROUTES.SETTINGS_WEBHOOKS),
    type: "private",
    requiredPermission: ["read-webhooks", "update-webhooks"],
    section: overridableBy("settings"),
  },

  // Image sizes settings
  [ROUTES.SETTINGS_IMAGE_SIZES]: {
    component: ImageSizesSettingsPage,
    screenName: settingsScreen(ROUTES.SETTINGS_IMAGE_SIZES),
    type: "private",
    requiredPermission: READ_SETTINGS,
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_IMAGE_SIZES_CREATE]: {
    component: CreateImageSizePage,
    screenName: settingsScreen(ROUTES.SETTINGS_IMAGE_SIZES),
    type: "private",
    requiredPermission: CREATE_SETTINGS,
    section: overridableBy("settings"),
  },
  [ROUTES.SETTINGS_IMAGE_SIZES_EDIT]: {
    component: EditImageSizePage,
    screenName: settingsScreen(ROUTES.SETTINGS_IMAGE_SIZES),
    type: "private",
    requiredPermission: UPDATE_SETTINGS,
    section: overridableBy("settings"),
  },

  // Plugin routes. The plugins area configures settings, so any settings
  // change opens it, as it opens the plugins rail (`canManageSettings`).
  [ROUTES.PLUGINS]: {
    component: PluginsOverviewPage,
    screenName: railScreen("plugins"),
    type: "private",
    requiredPermission: [...CHANGE_SETTINGS],
    section: "plugins",
  },
  // Registered outside `/admin/plugins/`, so no ordering rule holds this in
  // place: the directory and a plugin's detail page cannot match the same
  // path, whatever the plugin is called.
  [ROUTES.PLUGIN_BROWSE]: {
    component: PluginBrowsePage,
    // The plugins panel's link to this screen is markup rather than a
    // declaration, so its label is repeated here.
    screenName: "Browse plugins",
    type: "private",
    requiredPermission: [...CHANGE_SETTINGS],
    section: "plugins",
  },
  [ROUTES.PLUGIN_DETAIL]: {
    component: PluginDetailPage,
    screenName: railScreen("plugins"),
    type: "private",
    requiredPermission: [...CHANGE_SETTINGS],
    section: "plugins",
  },
  // No fixed permission: a plugin may keep its settings to a permission of
  // its own, which only its metadata names. The page asks for it, once the
  // plugin list has arrived; see `PluginSettingsGate`.
  [ROUTES.PLUGIN_SETTINGS]: {
    component: PluginSettingsPage,
    // Named as the page's breadcrumb ends, so with the plugin's name before it
    // the tab reads "Acme Forms · Settings", apart from the plugin's details.
    screenName: "Settings",
    type: "private",
    section: "plugins",
  },

  [ROUTES.USERS_FIELDS]: {
    component: UserFieldsPage,
    screenName: settingsScreen(ROUTES.USERS_FIELDS),
    type: "private",
    requiredPermission: READ_SETTINGS,
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_FIELDS_CREATE]: {
    component: CreateUserFieldPage,
    screenName: settingsScreen(ROUTES.USERS_FIELDS),
    type: "private",
    requiredPermission: CREATE_SETTINGS,
    section: overridableBy("settings"),
  },
  [ROUTES.USERS_FIELDS_EDIT]: {
    component: EditUserFieldPage,
    screenName: settingsScreen(ROUTES.USERS_FIELDS),
    type: "private",
    requiredPermission: UPDATE_SETTINGS,
    section: overridableBy("settings"),
  },
};

// The builder's editor routes stay in the table unconditionally, and nothing
// here may consult NODE_ENV to drop them. This package is PREBUILT: the bundler folds
// `process.env.NODE_ENV` at package build time, so a module-load env check in
// the dist answers where the LIBRARY was built, never where it is RUNNING.
//
// Availability is a runtime question with runtime answers at every layer that
// needs one: the route entries below carry `requiresBuilder: true`, so
// RootLayout wraps them in BuilderGuard, which reads the host's
// `admin.branding.showBuilder` answer; the sidebar hides its Builders section
// on the same value; and the server refuses builder mutations through
// `isBuilderEnabled()` regardless of what any client renders. Dropping routes
// here would add a fourth, build-time answer that can only disagree with the
// other three.

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
