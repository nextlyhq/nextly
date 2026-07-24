export const ROUTES = {
  // Public routes
  SETUP: "/admin/setup",
  LOGIN: "/admin/login",
  REGISTER: "/admin/register",
  FORGOT_PASSWORD: "/admin/forgot-password",
  RESET_PASSWORD: "/admin/reset-password",
  VERIFY_EMAIL: "/admin/verify-email",
  ACCEPT_INVITE: "/admin/accept-invite",

  // Dashboard route (homepage)
  DASHBOARD: "/admin",

  // Users routes
  USERS: "/admin/users",
  USERS_CREATE: "/admin/users/create",
  USERS_EDIT: "/admin/users/edit/[id]",

  // Media routes
  MEDIA: "/admin/media",

  // ============================================================
  // Builder routes (schema management)
  //
  // Why the /admin/builder/* prefix cleanly separates
  // schema-management surfaces from content-management surfaces. The
  // primary sidebar's "Builder" icon lands here; the secondary
  // "Builders" sidebar shows Collections / Singles / Components links
  // pointing into this prefix.
  // ============================================================
  BUILDER_COLLECTIONS: "/admin/builder/collections",
  BUILDER_COLLECTIONS_NEW: "/admin/builder/collections/new",
  BUILDER_COLLECTIONS_EDIT: "/admin/builder/collections/[slug]",
  BUILDER_SINGLES: "/admin/builder/singles",
  BUILDER_SINGLES_NEW: "/admin/builder/singles/new",
  BUILDER_SINGLES_EDIT: "/admin/builder/singles/[slug]",
  BUILDER_COMPONENTS: "/admin/builder/components",
  BUILDER_COMPONENTS_NEW: "/admin/builder/components/new",
  BUILDER_COMPONENTS_EDIT: "/admin/builder/components/[slug]",

  // ============================================================
  // Section landing pages (smart redirects).
  //
  // clicking a section icon in the primary sidebar
  // hits one of these. The page is a router that picks the most-
  // recently-created record (sorted by `created` DESC), redirects to
  // its content URL, or renders the standard 404 when zero records
  // exist. Components don't have a content surface, so /admin/components
  // is a static redirect to /admin/builder/components instead.
  // ============================================================
  COLLECTIONS: "/admin/collections",
  SINGLES: "/admin/singles",
  COMPONENTS: "/admin/components",

  // ============================================================
  // Collection entries routes (dynamic collections).
  //
  // Why plural (/admin/collections/[slug] not the older singular
  // /admin/collection/[slug] form, PR-6b): industry-standard REST
  // convention. Payload, the framework
  // most often compared to Nextly, uses the plural form throughout.
  // The path reads "in the collections section, this collection's
  // entries" instead of the awkward "the (singular) collection... 'posts'".
  // ============================================================
  COLLECTION_ENTRIES: "/admin/collections/[slug]",
  COLLECTION_ENTRY_CREATE: "/admin/collections/[slug]/create",
  COLLECTION_ENTRY_EDIT: "/admin/collections/[slug]/[id]",
  COLLECTION_ENTRY_API: "/admin/collections/[slug]/api",

  // Security & Roles routes
  SECURITY_ROLES: "/admin/security/roles",
  SECURITY_ROLES_CREATE: "/admin/security/roles/create",
  SECURITY_ROLES_EDIT: "/admin/security/roles/edit/[id]",

  // Single content routes (single document editing surface — these are
  // CONTENT urls, not Builder urls; they stay under /admin/singles/*).
  SINGLE_EDIT: "/admin/singles/[slug]",
  SINGLE_API: "/admin/singles/[slug]/api",

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
  SETTINGS_API_KEYS_EDIT: "/admin/settings/api-keys/edit/[id]",
  // Webhook endpoint management (Settings → Webhooks): list, create, and edit.
  SETTINGS_WEBHOOKS: "/admin/settings/webhooks",
  SETTINGS_WEBHOOKS_CREATE: "/admin/settings/webhooks/create",
  SETTINGS_WEBHOOKS_EDIT: "/admin/settings/webhooks/edit/[id]",
  // Delivery log for one endpoint, and one delivery's attempt history.
  SETTINGS_WEBHOOKS_DELIVERIES: "/admin/settings/webhooks/[id]/deliveries",
  SETTINGS_WEBHOOKS_DELIVERY_DETAIL:
    "/admin/settings/webhooks/[id]/deliveries/[deliveryId]",
  SETTINGS_IMAGE_SIZES: "/admin/settings/image-sizes",
  SETTINGS_IMAGE_SIZES_CREATE: "/admin/settings/image-sizes/create",
  SETTINGS_IMAGE_SIZES_EDIT: "/admin/settings/image-sizes/edit/[id]",

  // Plugin routes
  PLUGINS: "/admin/plugins",
  PLUGIN_DETAIL: "/admin/plugins/[slug]",
  PLUGIN_SETTINGS: "/admin/plugins/[slug]/settings",
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
