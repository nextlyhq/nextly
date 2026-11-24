/**
 * Whether an id a database row holds is the user id a caller asked about, compared as the
 * database compares ids.
 *
 * A read that asks for several users' rows in one statement sorts the rows to each user in code,
 * and that sort must agree with the statement's own match. MySQL compares ids without regard to
 * case under its case-insensitive collation, so a row spelling a user's id in another case is that
 * user's row: an exact sort would drop a row the statement matched, and with it what the row
 * grants. PostgreSQL and SQLite compare ids exactly, and so does the sort there.
 *
 * @module services/lib/user-id-match
 */

/** A comparison of a row's user id with a requested one, as `dialect` compares them. */
export type UserIdMatch = (rowUserId: string, userId: string) => boolean;

/** How `dialect` compares two user ids: without regard to case on MySQL, exactly elsewhere. */
export function userIdMatchFor(dialect: string | undefined): UserIdMatch {
  return dialect === "mysql"
    ? (rowUserId, userId) => rowUserId.toLowerCase() === userId.toLowerCase()
    : (rowUserId, userId) => rowUserId === userId;
}
