/**
 * Schema journal REST handler. One read-only endpoint that powers the admin
 * NotificationBell + Dropdown:
 *
 *   GET /api/schema/journal?limit=20&before=<ISO> -> list of
 *     recent applies in the `nextly_migration_journal` table, newest
 *     first, paginated by `started_at` cursor.
 *
 * Auth: super-admin only. Schema applies are admin-level operations;
 * their audit log is gated the same way.
 *
 * Wire shape: `respondData` with body `{ rows, hasMore }`. Pagination is
 * cursor-style (caller passes `before=<ISO>` to "load more"); there is no
 * total count, no page index, and no totalPages, so the canonical
 * `respondList` meta shape would either need sentinel values (`total: -1`,
 * `totalPages: -1`) or be filled in with synthetic data the underlying
 * query never produced. `respondData` matches the cursor semantics; the
 * caller keys off the `hasMore` flag rather than meta.
 *
 * Caching: `private, no-store` so the response never leaks across user
 * sessions in shared caches. `Vary: Cookie` reinforces this for any
 * cooperating intermediary.
 *
 * @module api/schema-journal
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { getCachedNextly } from "../init";
import { readJournal } from "../domains/schema/journal/read-journal";
import { NextlyError } from "../errors/nextly-error";
import { isSuperAdmin } from "../services/lib/permissions";

import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

interface AdapterLike {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
}

async function getAdapter(): Promise<AdapterLike> {
  await getCachedNextly();
  return container.get<AdapterLike>("adapter");
}

/**
 * GET /api/schema/journal
 *
 * Query params:
 *   - limit: number (default 20, clamped to [1, 100]); page size.
 *   - before: ISO 8601 timestamp; returns rows whose `startedAt` is
 *     strictly older than this value. Used for "load more".
 *
 * Response: `{ rows: JournalRow[], hasMore: boolean }` (bare body via
 * `respondData`; cursor semantics, no pagination meta).
 *
 * Errors:
 *   - 400 NEXTLY_VALIDATION when `limit` or `before` is malformed.
 *   - 401 unauthorized when no session cookie is present.
 *   - 403 NEXTLY_FORBIDDEN when the caller is not a super-admin.
 *   - 500 NEXTLY_INTERNAL when the DB query fails.
 */
export const getSchemaJournal = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  if (!(await isSuperAdmin(auth.userId))) {
    // Generic forbidden message; the operator detail goes to logs.
    throw NextlyError.forbidden({
      logContext: { reason: "schema-journal-super-admin-required" },
    });
  }

  const { searchParams } = new URL(req.url);

  const limitParam = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      throw NextlyError.validation({
        errors: [
          {
            path: "limit",
            code: "out_of_range",
            message: `limit must be a number between ${MIN_LIMIT} and ${MAX_LIMIT}`,
          },
        ],
      });
    }
    limit = Math.floor(parsed);
  }

  const beforeParam = searchParams.get("before");
  let before: string | undefined;
  if (beforeParam !== null) {
    const parsed = new Date(beforeParam);
    if (Number.isNaN(parsed.getTime())) {
      throw NextlyError.validation({
        errors: [
          {
            path: "before",
            code: "invalid_date",
            message: "before must be a valid ISO 8601 timestamp",
          },
        ],
      });
    }
    before = beforeParam;
  }

  const adapter = await getAdapter();
  const db = adapter.getDrizzle();

  const result = await readJournal({
    db,
    dialect: adapter.dialect,
    limit,
    before,
  });

  // Bare cursor read, no envelope. Spread into a fresh literal so the named
  // result type satisfies the respondData generic constraint.
  return respondData({ ...result }, { headers: PRIVATE_NO_STORE_HEADERS });
});
