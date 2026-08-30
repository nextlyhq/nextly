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

  // Translations
  TRANSLATIONS: "/admin/translations",

  // Content releases: a batch of documents that goes live at one instant.
  // Top-level rather than nested under a collection, because a release spans
  // collections and Singles and is the only shape that answers "what is going
  // live on Friday?" without starting from a document.
  RELEASES: "/admin/releases",
  RELEASES_DETAIL: "/admin/releases/[id]",

  // ============================================================
  // Builder routes (schema management)
  //
  // Why the /admin/builder/* prefix cleanly separates
  // schema-management surfaces from content-management surfaces. The
  // primary sidebar's "Builder" icon lands here; the secondary
  // "Builders" sidebar shows Collections, Singles and Field Groups links
  // pointing into this prefix.
  // ============================================================
  BUILDER_COLLECTIONS: "/admin/builder/collections",
  BUILDER_COLLECTIONS_NEW: "/admin/builder/collections/new",
  BUILDER_COLLECTIONS_EDIT: "/admin/builder/collections/[slug]",
  BUILDER_SINGLES: "/admin/builder/singles",
  BUILDER_SINGLES_NEW: "/admin/builder/singles/new",
  BUILDER_SINGLES_EDIT: "/admin/builder/singles/[slug]",
  BUILDER_FIELD_GROUPS: "/admin/builder/field-groups",
  BUILDER_FIELD_GROUPS_NEW: "/admin/builder/field-groups/new",
  BUILDER_FIELD_GROUPS_EDIT: "/admin/builder/field-groups/[slug]",

  // ============================================================
  // Section landing pages (smart redirects).
  //
  // clicking a section icon in the primary sidebar
  // hits one of these. The page is a router that picks the most-
  // recently-created record (sorted by `created` DESC), redirects to
  // its content URL, or renders the standard 404 when zero records
  // exist. Field groups have no content surface, so /admin/field-groups
  // is a static redirect to /admin/builder/field-groups instead.
  // ============================================================
  COLLECTIONS: "/admin/collections",
  SINGLES: "/admin/singles",
  FIELD_GROUPS: "/admin/field-groups",

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
  // A comparison is addressable: the pair being compared lives in the query
  // (`?from=&to=`), so a reader can send a colleague the exact comparison
  // rather than a description of how to reach it.
  COLLECTION_ENTRY_VERSIONS: "/admin/collections/[slug]/[id]/versions",

  // Security & Roles routes
  SECURITY_ROLES: "/admin/security/roles",
  SECURITY_ROLES_CREATE: "/admin/security/roles/create",
  SECURITY_ROLES_EDIT: "/admin/security/roles/edit/[id]",

  // Single content routes (single document editing surface — these are
  // CONTENT urls, not Builder urls; they stay under /admin/singles/*).
  SINGLE_EDIT: "/admin/singles/[slug]",
  SINGLE_API: "/admin/singles/[slug]/api",
  SINGLE_VERSIONS: "/admin/singles/[slug]/versions",

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
  // Outside the `/admin/plugins/` namespace on purpose. A plugin's detail
  // address is `/admin/plugins/<slug>`, and a slug is derived from a package
  // name that may be any string, so a sibling static page there is a page a
  // plugin can be named after — and whichever of the two wins, the other
  // becomes unreachable. A different parent removes the collision instead of
  // ranking it.
  PLUGIN_BROWSE: "/admin/plugin-directory",
  PLUGIN_DETAIL: "/admin/plugins/[slug]",
  PLUGIN_SETTINGS: "/admin/plugins/[slug]/settings",
} as const;

/**
 * Type representing all possible route values
 */
export type RouteValue = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * Routes reachable without a session.
 *
 * Declared once here because three places need this answer and they cannot all
 * ask the router:
 *
 * - the page registry pairs each path with its component and marks it public,
 *   which is what wraps the page in `PublicRoute`;
 * - the refresh interceptor suppresses its redirect to login on these paths,
 *   because a 401 from a background query is expected while nobody is signed
 *   in, and redirecting produces a loop;
 * - the pages themselves live under `pages/(auth)/`.
 *
 * The interceptor cannot import the registry to find out. The registry imports
 * every page, each page reaches `lib/api/fetcher`, and `fetcher` imports the
 * interceptor, so that dependency closes a cycle. This module imports nothing,
 * so both sides can depend on it.
 *
 * Adding a route here is not enough to make it reachable, and that is
 * deliberate: the registry owns which component answers, and its public entries
 * are keyed by {@link PublicRoutePath}, so a path added here without a page
 * fails to compile rather than becoming a silently unguarded URL.
 */
export const PUBLIC_ROUTE_PATHS = [
  ROUTES.SETUP,
  ROUTES.LOGIN,
  ROUTES.REGISTER,
  ROUTES.FORGOT_PASSWORD,
  ROUTES.RESET_PASSWORD,
  ROUTES.VERIFY_EMAIL,
  ROUTES.ACCEPT_INVITE,
] as const;

/** A route from {@link PUBLIC_ROUTE_PATHS}. */
export type PublicRoutePath = (typeof PUBLIC_ROUTE_PATHS)[number];

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
