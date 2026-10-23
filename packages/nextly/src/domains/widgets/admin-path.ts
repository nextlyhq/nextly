/**
 * Whether a link a plugin or a widget wrote is a path inside the admin.
 *
 * ONE rule for both places that ask it: startup, which refuses a declaration
 * whose link breaks it, and the admin, which draws no link for a path that
 * breaks it whatever startup let through. Pure and dependency-free, so the
 * admin imports it from `nextly/config` with nothing of the server behind it.
 *
 * @module domains/widgets/admin-path
 */

/**
 * Whether `link` is a path relative to the admin: not empty, no scheme (so
 * never `javascript:`), not from the root (so never `//host`, and never the
 * admin's own address), no backslash, which browsers read as a slash.
 *
 * 🔴 And no segment that climbs out of it. A browser resolves `.` and `..`
 * before it navigates, percent-encoded ones included, so `../logout` under the
 * admin's prefix lands outside the admin however the prefix was written. Only
 * the path's own part is read: a query or a fragment is not a way out.
 *
 * @experimental
 */
export function isAdminRelativePath(link: unknown): link is string {
  return (
    typeof link === "string" &&
    link.trim() !== "" &&
    !/^[a-z][a-z0-9+.-]*:/i.test(link) &&
    !link.startsWith("/") &&
    !link.includes("\\") &&
    !leavesItsDirectory(link)
  );
}

/**
 * Whether a path's own part has a segment a browser would resolve upward or
 * sideways: `.` or `..` once decoded, one that decodes to a slash or a
 * backslash, or one that cannot be decoded at all.
 */
function leavesItsDirectory(link: string): boolean {
  const path = link.split(/[?#]/, 1)[0] ?? "";
  return path.split("/").some(segment => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    return (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    );
  });
}
