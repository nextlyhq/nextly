/**
 * Which collections and Singles the dashboard's cards leave out.
 *
 * The admin's half of the dashboard rule the server applies to every widget source, count and
 * condition: an entity hidden from the admin's navigation -- `internal: true` is stored as
 * `admin.hidden: true`, so internal ones are caught by the same flag -- is never offered or
 * counted on the dashboard, for any reader. The cards that list content from the general list
 * endpoints (`/collections`, `/singles`) rather than from a dashboard endpoint ask this, so they
 * agree with the cards the server already narrows.
 *
 * Not the sidebar's section rules: those also decide WHERE an entity is listed, which is a
 * different question from whether the dashboard shows it at all.
 *
 * @module components/features/dashboard/kept-off-dashboard
 */

/** Whether a collection or Single is kept off the dashboard's cards. */
export function keptOffDashboard(entity: {
  admin?: { hidden?: boolean } | null;
}): boolean {
  return entity.admin?.hidden === true;
}
