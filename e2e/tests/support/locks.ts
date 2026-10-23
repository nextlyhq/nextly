/**
 * The named locks that keep specs sharing one piece of state off each other.
 *
 * The suite runs on one dev server, one SQLite database and one signed-in user.
 * In CI it runs on two workers: two spec FILES at once (`fullyParallel` is off,
 * so a file's own tests stay in order on one worker). Two specs may run side by
 * side only when neither can change what the other reads. A spec that writes a
 * piece of state listed here, or reads it as a whole (a full list, a count, an
 * exact tree), takes that piece's lock:
 *
 *   test.describe.configure({ lock: [LOCK.dashboard] });
 *
 * at the top of the file. Playwright never runs two files holding the same lock
 * name at once, across workers. A lock taken anywhere in a file holds for the
 * whole file, its hooks included.
 *
 * A READER needs the lock as much as a writer does: a spec asserting the
 * dashboard's exact cards fails when another resets the layout mid-test, and
 * nothing in that failure names the other spec. When a new spec touches one of
 * these, give it the lock. When it touches shared state not listed here, add a
 * name rather than leaving it unguarded.
 *
 * Data a test creates under a unique name and reads back only by that name
 * needs no lock.
 */
export const LOCK = {
  /**
   * The signed-in user's one dashboard layout. Writes are versioned, so a
   * concurrent write turns the next one into a conflict. The layout's scope
   * token also changes when a collection is created, because every collection
   * brings its own cards, so the specs that create collections take this too.
   */
  dashboard: "dashboard",
  /**
   * The homepage single: its layout, its edit lock and its autosave recovery
   * point. The builder and canvas specs reseed it and assert its exact tree.
   */
  homepage: "homepage",
  /**
   * The schema: collections created at runtime, which also write migration
   * files into the playground, and readers of the whole collection set.
   */
  schema: "schema",
  /** Users, roles and the user schema, and readers of the roles list. */
  usersRoles: "users-roles",
  /** Email templates, including core's Welcome email, and counts of them. */
  email: "email",
  /**
   * Releases. Publish now runs the release runner, which runs every overdue
   * release it finds, whichever spec left it there.
   */
  releases: "releases",
  /** The `related-links` single, written and read back exactly. */
  relatedLinks: "related-links",
  /**
   * A second `next dev` of the playground, with the files it snapshots and
   * restores in the playground root.
   */
  ownServer: "own-server",
  /**
   * Not a piece of state: a spec that measures time or a request budget, or
   * one that boots a second dev server. Holding it keeps a stopwatch from
   * running beside a boot, and the session's request budget from being spent
   * by two such specs at once.
   */
  heavy: "heavy",
} as const;
