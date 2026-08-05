/**
 * Split a permission slug into its `action` and `resource`.
 *
 * Permission slugs are canonically `${action}-${resource}` (e.g.
 * `"export-submissions"`). Actions are single tokens with no hyphen, so we split
 * on the FIRST hyphen — any further hyphens belong to the resource (e.g.
 * `"export-form-submissions"` → `{ action: "export", resource: "form-submissions" }`).
 * A slug with no hyphen is treated as an action with an empty resource.
 *
 * The inverse of `permissionSlug` in `schemas/_zod/rbac`. The two have to agree
 * exactly — a compose and a parse that disagree turn a valid grant into a
 * lookup miss — so a round-trip test holds them together.
 */
export function parsePermissionSlug(slug: string): {
  action: string;
  resource: string;
} {
  const idx = slug.indexOf("-");
  if (idx === -1) return { action: slug, resource: "" };
  return { action: slug.slice(0, idx), resource: slug.slice(idx + 1) };
}
