/**
 * Resolve a route path to an admin-prefixed path.
 */
function toAdminPath(path: string): string {
  return path.startsWith("/admin")
    ? path
    : `/admin${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Navigate to a route programmatically.
 * Skips navigation if the browser is already at the target URL
 * to prevent infinite redirect loops between route guards.
 *
 * Accepts both static routes (RouteValue) and dynamic routes built with buildRoute()
 */
export function navigateTo(path: string): void {
  try {
    const adminPath = toAdminPath(path);

    // Skip if already at the target URL to prevent guard redirect loops
    if (window.location.pathname === adminPath) return;

    window.history.pushState(null, "", adminPath);
    // Note: the patched pushState in useRouter already dispatches
    // "locationchange", so we do NOT dispatch it again here.
  } catch (error) {
    console.error("Navigation failed:", error);
    const adminPath = toAdminPath(path);
    if (window.location.pathname !== adminPath) {
      window.location.href = adminPath;
    }
  }
}

/**
 * Replace current route programmatically.
 * Skips navigation if the browser is already at the target URL.
 *
 * Accepts both static routes (RouteValue) and dynamic routes built with buildRoute()
 */
export function replaceTo(path: string): void {
  try {
    const adminPath = toAdminPath(path);

    if (window.location.pathname === adminPath) return;

    window.history.replaceState(null, "", adminPath);
    // Note: the patched replaceState in useRouter already dispatches
    // "locationchange", so we do NOT dispatch it again here.
  } catch (error) {
    console.error("Navigation replace failed:", error);
    const adminPath = toAdminPath(path);
    if (window.location.pathname !== adminPath) {
      window.location.replace(adminPath);
    }
  }
}
