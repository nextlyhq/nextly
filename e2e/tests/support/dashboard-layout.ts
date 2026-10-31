/**
 * Which requests are the dashboard's layout read, for a spec that passes it through changed.
 *
 * The admin sends the read the dashboard's width (`?width=`), for the server to judge each card
 * that hides while empty at the tier it is drawn at, so a glob naming the bare path no longer
 * matches it.
 */
export function isLayoutRead(url: URL): boolean {
  return (
    url.pathname.endsWith("/dashboard/layout") &&
    [...url.searchParams.keys()].every(key => key === "width")
  );
}
