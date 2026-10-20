/**
 * The physical names of the releases tables.
 *
 * In a module of their own, importing nothing, so a reader outside the
 * repository (the stopped notice's link, which runs when a person reads their
 * notices) names the same table without pulling the repository in behind a
 * constant.
 *
 * @module domains/releases/release-tables
 */

/** Releases. */
export const RELEASES_TABLE = "nextly_releases";

/** The documents each release holds. */
export const RELEASE_MEMBERS_TABLE = "nextly_release_members";
