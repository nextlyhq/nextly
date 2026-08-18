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

/**
 * Set or clear one query parameter on the CURRENT path, leaving the rest of the
 * query and the path untouched.
 *
 * The admin already reads state out of the query — the entry list takes its
 * filter from `?where=` — but nothing wrote one, so state that belonged in the
 * URL was kept in component state instead and could not be linked to, restored
 * on reload, or reached with the back button.
 *
 * `navigateTo` is not the tool for this. It compares only `window.location.pathname`
 * against its argument, so asking it to change a parameter on the page you are
 * already on is either skipped outright or works by the accident of the compared
 * strings differing once a `?` is involved.
 *
 * Pushes by default: changing one of these is a move the reader can undo with
 * the back button. Pass `replace` for a parameter that corrects the current
 * entry rather than making a new one.
 *
 * No-ops when the value is already set, so a component that writes the
 * parameter it just read does not fill the history with copies of one page.
 */
export function setSearchParam(
  key: string,
  value: string | null,
  options?: { replace?: boolean }
): void {
  try {
    const url = new URL(window.location.href);
    const current = url.searchParams.get(key);
    if (current === value) return;
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);

    const next = `${url.pathname}${url.search}${url.hash}`;
    // The patched history methods in `useRouter` dispatch "locationchange"
    // themselves, so nothing is dispatched here.
    if (options?.replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  } catch (error) {
    console.error("Failed to set search param:", error);
  }
}
