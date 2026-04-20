import { lazy } from "react";

import { ROUTES } from "../constants/routes";
import type { PageProps } from "../lib/routing";

import ForgotPasswordPage from "./(auth)/forgot-password";
import LoginPage from "./(auth)/login";
import RegisterPage from "./(auth)/register";
import ResetPasswordPage from "./(auth)/reset-password";
import SetupPage from "./(auth)/setup";
import VerifyEmailPage from "./(auth)/verify-email";
import CollectionsPage from "./dashboard/collection/index";
import ComponentsPage from "./dashboard/component/index";
import EditEntryPage from "./dashboard/entries/[slug]/[id]/index";
import APIPlaygroundPage from "./dashboard/entries/[slug]/api";
import CompareEntryPage from "./dashboard/entries/[slug]/compare";
import CreateEntryPage from "./dashboard/entries/[slug]/create";
import CollectionEntriesPage from "./dashboard/entries/[slug]/index";
import DashboardPage from "./dashboard/index";
import MediaLibraryPage from "./dashboard/media/index";
import PluginSettingsPage from "./dashboard/plugins/[slug]";
import PluginsOverviewPage from "./dashboard/plugins/index";
import RolesPage from "./dashboard/roles";
import RolesCreatePage from "./dashboard/roles/create";
import RolesEditPage from "./dashboard/roles/edit";
import CreateApiKeyPage from "./dashboard/settings/api-keys/create";
import ApiKeysPage from "./dashboard/settings/api-keys/index";
import CreateEmailProviderPage from "./dashboard/settings/email-providers/create";
import EditEmailProviderPage from "./dashboard/settings/email-providers/edit/[id]";
import EmailProvidersPage from "./dashboard/settings/email-providers/index";
import CreateEmailTemplatePage from "./dashboard/settings/email-templates/create";
import EditEmailTemplatePage from "./dashboard/settings/email-templates/edit/[id]";
import EmailTemplatesPage from "./dashboard/settings/email-templates/index";
import ImageSizesSettingsPage from "./dashboard/settings/image-sizes/index";
import SettingsPage from "./dashboard/settings/index";
import SettingsPermissionsPage from "./dashboard/settings/permissions/index";
import SingleAPIPlaygroundPage from "./dashboard/singles/[slug]/api";
import SingleEditPage from "./dashboard/singles/[slug]/index";
import SinglesPage from "./dashboard/singles/index";
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
const ComponentBuilderPage = lazy(
  () => import("./dashboard/component/builder/index")
);
const ComponentBuilderEditPage = lazy(
  () => import("./dashboard/component/builder/[slug]")
);
const SingleBuilderPage = lazy(
  () => import("./dashboard/singles/builder/index")
);
const SingleBuilderEditPage = lazy(
  () => import("./dashboard/singles/builder/[slug]")
);

export interface RouteConfig {
  component: React.ComponentType<PageProps>;
  type: "public" | "private";
  /** Permission slug required to access this route. Routes without this are accessible to all authenticated users. */
  requiredPermission?: string;
}

export const routeConfig: Record<string, RouteConfig> = {
  // Public routes
  [ROUTES.SETUP]: { component: SetupPage, type: "public" },
  [ROUTES.LOGIN]: { component: LoginPage, type: "public" },
  [ROUTES.REGISTER]: { component: RegisterPage, type: "public" },
  [ROUTES.FORGOT_PASSWORD]: { component: ForgotPasswordPage, type: "public" },
  [ROUTES.RESET_PASSWORD]: { component: ResetPasswordPage, type: "public" },
  [ROUTES.VERIFY_EMAIL]: { component: VerifyEmailPage, type: "public" },

  // Dashboard route (homepage)
  [ROUTES.DASHBOARD]: { component: DashboardPage, type: "private" },

  // Users routes
  [ROUTES.USERS]: {
    component: DashboardUsersPage,
    type: "private",
    requiredPermission: "read-users",
  },
  [ROUTES.USERS_CREATE]: {
    component: CreateUserPage,
    type: "private",
    requiredPermission: "create-users",
  },
  [ROUTES.USERS_EDIT]: {
    component: EditUserPage,
    type: "private",
    requiredPermission: "update-users",
  },

  // Media routes
  [ROUTES.MEDIA]: {
    component: MediaLibraryPage,
    type: "private",
    requiredPermission: "read-media",
  },

  // Collections routes (schema management — requires manage-settings)
  [ROUTES.COLLECTIONS]: {
    component: CollectionsPage,
    type: "private",
  },
  [ROUTES.COLLECTIONS_CREATE]: {
    component: CollectionBuilderPage,
    type: "private",
  },
  [ROUTES.COLLECTIONS_EDIT]: {
    component: CollectionBuilderEditPage,
    type: "private",
  },
  [ROUTES.COLLECTIONS_BUILDER]: {
    component: CollectionBuilderPage,
    type: "private",
  },
  [ROUTES.COLLECTIONS_BUILDER_EDIT]: {
    component: CollectionBuilderEditPage,
    type: "private",
  },

  // Collection entries routes (dynamic collections)
  // IMPORTANT: Routes with literal segments (create, api, compare) must be
  // registered BEFORE the wildcard [id] route to ensure correct matching
  [ROUTES.COLLECTION_ENTRIES]: {
    component: CollectionEntriesPage,
    type: "private",
  },
  [ROUTES.COLLECTION_ENTRY_CREATE]: {
    component: CreateEntryPage,
    type: "private",
  },
  [ROUTES.COLLECTION_ENTRY_API]: {
    component: APIPlaygroundPage,
    type: "private",
  },
  [ROUTES.COLLECTION_ENTRY_COMPARE]: {
    component: CompareEntryPage,
    type: "private",
  },
  [ROUTES.COLLECTION_ENTRY_EDIT]: {
    component: EditEntryPage,
    type: "private",
  },

  // Security & Roles routes
  [ROUTES.SECURITY_ROLES]: {
    component: RolesPage,
    type: "private",
    requiredPermission: "read-roles",
  },
  [ROUTES.SECURITY_ROLES_CREATE]: {
    component: RolesCreatePage,
    type: "private",
    requiredPermission: "create-roles",
  },
  [ROUTES.SECURITY_ROLES_EDIT]: {
    component: RolesEditPage,
    type: "private",
    requiredPermission: "update-roles",
  },

  // Singles (Globals) routes (builder = schema management, edit = content)
  [ROUTES.SINGLES]: {
    component: SinglesPage,
    type: "private",
  },

  [ROUTES.SINGLES_BUILDER]: {
    component: SingleBuilderPage,
    type: "private",
  },
  [ROUTES.SINGLES_BUILDER_EDIT]: {
    component: SingleBuilderEditPage,
    type: "private",
  },
  // Single content editing — permission is per-slug (checked server-side)
  // IMPORTANT: literal segments like /api must be registered before the wildcard [slug]
  [ROUTES.SINGLE_API]: {
    component: SingleAPIPlaygroundPage,
    type: "private",
  },
  [ROUTES.SINGLE_EDIT]: { component: SingleEditPage, type: "private" },

  // Components routes (schema management — requires manage-settings)
  [ROUTES.COMPONENTS]: {
    component: ComponentsPage,
    type: "private",
  },
  [ROUTES.COMPONENTS_BUILDER]: {
    component: ComponentBuilderPage,
    type: "private",
  },
  [ROUTES.COMPONENTS_BUILDER_EDIT]: {
    component: ComponentBuilderEditPage,
    type: "private",
  },

  // Settings routes
  [ROUTES.SETTINGS]: {
    component: SettingsPage,
    type: "private",
    requiredPermission: "manage-settings",
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS]: {
    component: EmailProvidersPage,
    type: "private",
    requiredPermission: "manage-email-providers",
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS_CREATE]: {
    component: CreateEmailProviderPage,
    type: "private",
    requiredPermission: "manage-email-providers",
  },
  [ROUTES.SETTINGS_EMAIL_PROVIDERS_EDIT]: {
    component: EditEmailProviderPage,
    type: "private",
    requiredPermission: "manage-email-providers",
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES]: {
    component: EmailTemplatesPage,
    type: "private",
    requiredPermission: "manage-email-templates",
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE]: {
    component: CreateEmailTemplatePage,
    type: "private",
    requiredPermission: "manage-email-templates",
  },
  [ROUTES.SETTINGS_EMAIL_TEMPLATES_EDIT]: {
    component: EditEmailTemplatePage,
    type: "private",
    requiredPermission: "manage-email-templates",
  },
  [ROUTES.SETTINGS_PERMISSIONS]: {
    component: SettingsPermissionsPage,
    type: "private",
    requiredPermission: "manage-permissions",
  },
  [ROUTES.SETTINGS_API_KEYS]: {
    component: ApiKeysPage,
    type: "private",
    requiredPermission: "update-api-keys",
  },
  [ROUTES.SETTINGS_API_KEYS_CREATE]: {
    component: CreateApiKeyPage,
    type: "private",
    requiredPermission: "create-api-keys",
  },

  // Image sizes settings
  [ROUTES.SETTINGS_IMAGE_SIZES]: {
    component: ImageSizesSettingsPage,
    type: "private",
    requiredPermission: "manage-settings",
  },

  // Plugin routes
  [ROUTES.PLUGINS]: {
    component: PluginsOverviewPage,
    type: "private",
    requiredPermission: "manage-settings",
  },
  [ROUTES.PLUGIN_SETTINGS]: {
    component: PluginSettingsPage,
    type: "private",
    requiredPermission: "manage-settings",
  },

  [ROUTES.USERS_FIELDS]: {
    component: UserFieldsPage,
    type: "private",
    requiredPermission: "manage-settings",
  },
  [ROUTES.USERS_FIELDS_CREATE]: {
    component: CreateUserFieldPage,
    type: "private",
    requiredPermission: "manage-settings",
  },
  [ROUTES.USERS_FIELDS_EDIT]: {
    component: EditUserFieldPage,
    type: "private",
    requiredPermission: "manage-settings",
  },
};

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
