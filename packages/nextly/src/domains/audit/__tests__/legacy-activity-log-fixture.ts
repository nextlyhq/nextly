/**
 * The `activity_log` shape as it stood BEFORE identity erasure, for the suites
 * that have to reproduce a database an upgrade has not reached.
 *
 * Hand-written on purpose, and the one place it is allowed to be. Fixtures
 * normally reuse the production DDL helpers so they cannot drift from the
 * schema — but this fixture's whole job is to differ from it. Deriving it from
 * today's definition would assert nothing, because the properties under test
 * are precisely the ones that changed: the cascading key that destroyed the
 * trail with its author, the NOT NULL identity columns that could not be
 * erased, and the absent erasure stamp.
 *
 * It is shared rather than copied so the suites that reproduce this state
 * cannot disagree about what it was. Freeze it: this is a historical artifact,
 * so a future schema change must not be reflected here.
 *
 * @module domains/audit/__tests__/legacy-activity-log-fixture
 */

/** `activity_log` before the erasure work, on SQLite. */
export const LEGACY_ACTIVITY_LOG_SQLITE = `
  CREATE TABLE "activity_log" (
    "id" TEXT PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "user_name" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "entry_id" TEXT,
    "entry_title" TEXT,
    "metadata" TEXT,
    "created_at" INTEGER NOT NULL
  )`;

/**
 * The columns the erasure needs and this shape lacks.
 *
 * Named here so a suite asserting the fixture's premise checks the same thing
 * the production guard checks.
 */
export const ERASURE_COLUMNS = ["identity_erased_at"] as const;
