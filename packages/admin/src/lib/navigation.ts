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
  setSearchParams({ [key]: value }, options);
}

/**
 * Set several query parameters as ONE history entry, a `null` value removing
 * its key: closing a panel that keeps two keys clears both in one step back,
 * rather than leaving a half-closed state on the stack.
 *
 * No-ops when every value is already set.
 */
export function setSearchParams(
  values: Readonly<Record<string, string | null>>,
  options?: { replace?: boolean }
): void {
  try {
    const url = new URL(window.location.href);
    const entries = Object.entries(values);
    if (entries.every(([key, value]) => url.searchParams.get(key) === value)) {
      return;
    }
    for (const [key, value] of entries) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    // The patched history methods in `useRouter` dispatch "locationchange"
    // themselves, so nothing is dispatched here.
    if (options?.replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  } catch (error) {
    console.error("Failed to set search param:", error);
  }
}

/**
 * Move to a page of this admin, from an address a plugin built.
 *
 * The address is outside input to the admin, so it is judged before anything
 * moves: a same-origin path under `/admin`, written as one. An absolute or
 * protocol-relative URL, a script URL, a path outside the admin, a relative
 * path or one that climbs out with `..` is refused by name rather than
 * followed — or quietly rewritten into an admin path, which would take the
 * author somewhere the caller never named.
 *
 * Within the admin the move is the router's own, so the page and its state
 * stay mounted where the same page answers the new address.
 *
 * @throws Error naming the refused address
 */
export function navigateWithinAdmin(href: string): void {
  const target = adminTargetOf(href);
  if (target === undefined) {
    throw new Error(
      `navigateWithinAdmin refused ${JSON.stringify(href)}: only a path of this admin, starting "/admin/", can be navigated to.`
    );
  }
  // Compared WHOLE — path, query and hash — so a move that only drops a query
  // still happens. `navigateTo` skips on the path alone, which would leave a
  // plugin unable to clear the query it set.
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target === here) return;
  window.history.pushState(null, "", target);
}

/** The admin path and query `href` names, or `undefined` when it names none. */
function adminTargetOf(href: string): string | undefined {
  if (!href.startsWith("/admin/") || href.startsWith("//")) return undefined;
  const url = new URL(href, window.location.origin);
  // The resolved path must still be the written one: `/admin/../x` resolves
  // outside the admin while starting with its prefix.
  const written = href.split(/[?#]/, 1)[0];
  if (url.origin !== window.location.origin || url.pathname !== written) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * `path` with the current address's query, less the keys in `drop`.
 *
 * For a move between two screens of one document: the query carries which
 * language of the document is being edited, and arriving without it loads
 * another translation over the author's unsaved edits.
 */
export function withCurrentQuery(
  path: string,
  drop: readonly string[] = []
): string {
  const query = new URLSearchParams(window.location.search);
  for (const key of drop) query.delete(key);
  const search = query.toString();
  return search === "" ? path : `${path}?${search}`;
}
