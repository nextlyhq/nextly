export const ROUTES = {
  // Public routes
  HOME: "/admin/welcome",
  SETUP: "/admin/setup",
  LOGIN: "/admin/login",
  REGISTER: "/admin/register",
  FORGOT_PASSWORD: "/admin/forgot-password",
  RESET_PASSWORD: "/admin/reset-password",
  VERIFY_EMAIL: "/admin/verify-email",

  // Dashboard route (homepage)
  DASHBOARD: "/admin",

  // Users routes
  USERS: "/admin/users",
  USERS_CREATE: "/admin/users/create",
  USERS_EDIT: "/admin/users/edit/[id]",

  // Media routes
  MEDIA: "/admin/media",

  // Collections routes
  COLLECTIONS: "/admin/collections",
  COLLECTIONS_CREATE: "/admin/collections/create",
  COLLECTIONS_EDIT: "/admin/collections/edit",
  COLLECTIONS_BUILDER: "/admin/collections/builder",
  COLLECTIONS_BUILDER_EDIT: "/admin/collections/builder/[slug]",

  // Collection entries routes (dynamic collections)
  COLLECTION_ENTRIES: "/admin/collection/[slug]",
  COLLECTION_ENTRY_CREATE: "/admin/collection/[slug]/create",
  COLLECTION_ENTRY_EDIT: "/admin/collection/[slug]/[id]",
  COLLECTION_ENTRY_API: "/admin/collection/[slug]/api",
  COLLECTION_ENTRY_COMPARE: "/admin/collection/[slug]/compare",

  // Security & Roles routes
  SECURITY_ROLES: "/admin/security/roles",
  SECURITY_ROLES_CREATE: "/admin/security/roles/create",
  SECURITY_ROLES_EDIT: "/admin/security/roles/edit/[id]",

  // Singles (Globals) routes
  SINGLES: "/admin/singles",
  // Pages route for content editing
  SINGLES_BUILDER: "/admin/singles/builder",
  SINGLES_BUILDER_EDIT: "/admin/singles/builder/[slug]",
  SINGLE_EDIT: "/admin/singles/[slug]",
  SINGLE_API: "/admin/singles/[slug]/api",

  // Components routes
  COMPONENTS: "/admin/components",
  COMPONENTS_BUILDER: "/admin/components/builder",
  COMPONENTS_BUILDER_EDIT: "/admin/components/builder/[slug]",

  // Settings routes
  SETTINGS: "/admin/settings",
  // Users fields routes
  USERS_FIELDS: "/admin/users/fields",
  USERS_FIELDS_CREATE: "/admin/users/fields/create",
  USERS_FIELDS_EDIT: "/admin/users/fields/edit/[id]",
  SETTINGS_EMAIL_PROVIDERS: "/admin/settings/email-providers",
  SETTINGS_EMAIL_PROVIDERS_CREATE: "/admin/settings/email-providers/create",
  SETTINGS_EMAIL_PROVIDERS_EDIT: "/admin/settings/email-providers/edit/[id]",
  SETTINGS_EMAIL_TEMPLATES: "/admin/settings/email-templates",
  SETTINGS_EMAIL_TEMPLATES_CREATE: "/admin/settings/email-templates/create",
  SETTINGS_EMAIL_TEMPLATES_EDIT: "/admin/settings/email-templates/edit/[id]",
  SETTINGS_PERMISSIONS: "/admin/settings/permissions",
  SETTINGS_API_KEYS: "/admin/settings/api-keys",
  SETTINGS_API_KEYS_CREATE: "/admin/settings/api-keys/create",
  SETTINGS_IMAGE_SIZES: "/admin/settings/image-sizes",

  // Plugin routes
  PLUGINS: "/admin/plugins",
  PLUGIN_SETTINGS: "/admin/plugins/[slug]",
} as const;

/**
 * Type representing all possible route values
 */
export type RouteValue = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * Helper to build dynamic routes with parameters
 *
 * @example
 * ```typescript
 * // For user edit route
 * buildRoute(ROUTES.USERS_EDIT, { id: "123" })
 * // Returns: "/admin/users/edit/123"
 *
 * // For routes with multiple params
 * buildRoute("/admin/posts/[postId]/comments/[commentId]", {
 *   postId: "456",
 *   commentId: "789"
 * })
 * // Returns: "/admin/posts/456/comments/789"
 * ```
 */
export function buildRoute(
  route: string,
  params: Record<string, string | number>
): string {
  let builtRoute = route;

  // Replace all [param] placeholders with actual values
  Object.entries(params).forEach(([key, value]) => {
    builtRoute = builtRoute.replace(`[${key}]`, String(value));
  });

  return builtRoute;
}

/**
 * Helper to add query parameters to a route
 *
 * @example
 * ```typescript
 * withQuery(ROUTES.USERS, { page: 2, search: "john" })
 * // Returns: "/admin/users?page=2&search=john"
 * ```
 */
export function withQuery(
  route: string,
  query: Record<string, string | number | boolean | undefined>
): string {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return queryString ? `${route}?${queryString}` : route;
}
