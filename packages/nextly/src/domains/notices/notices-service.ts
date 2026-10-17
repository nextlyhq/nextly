/**
 * A person's own notices: writing them once per occurrence, and reading,
 * counting and marking them read for the one person they are addressed to.
 *
 * ## Once per occurrence
 *
 * A notice is identified by who it is for, its kind, what it is about and
 * WHICH occurrence — a release that stops twice gives two notices; one stop
 * seen by two passes, or retried, gives one. That identity is stored as a
 * digest under a unique index, and written with an insert that leaves an
 * existing row alone rather than failing: a writer runs inside the change it
 * reports, and on PostgreSQL a unique violation would abort that whole
 * transaction. The answer says whether this call created the notice, so a
 * caller that also sends an email sends it for the first only.
 *
 * ## Before `nextly migrate`
 *
 * The table arrives through `nextly migrate`, so an installation can run code
 * that writes notices before it has the table. Reads then answer with nothing,
 * and a write is skipped with a warning naming the table and the command —
 * never failing the change it rides on. Presence is probed outside any
 * transaction, because a statement against a missing table would abort it.
 *
 * @module domains/notices/notices-service
 * @experimental Until the notices feature is complete.
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";
import { NOTICES_TABLE } from "../../schemas/notices/table-name";
import { uuidV7 } from "../../utils/uuid-v7";
import type { VersionsWhere, VersionsWhereCondition } from "../versions/db-api";

import {
  registeredNoticeKind,
  NOTICE_REFERENCE_MAX,
  registeredNoticeKinds,
  type NoticeKind,
} from "./notice-kinds";

/**
 * The order a person's notices page in: newest first. The id is time-ordered,
 * so it breaks ties on the creation time in the order the notices were made.
 * Each inbox index ends in these columns, so a page is read in index order
 * rather than sorted.
 */
export const NOTICE_PAGE_ORDER = [
  { column: "createdAt", direction: "desc" },
  { column: "id", direction: "desc" },
] as const;

/** The insert-or-keep a write needs: the adapter's, or its transaction's. */
export interface NoticesWriter {
  upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: { conflictColumns: string[]; updateColumns?: string[] }
  ): Promise<T>;
}

/** The database surface the notices service reads and writes through. */
export interface NoticesDb extends NoticesWriter {
  readonly dialect: SupportedDialect;
  tableExists(table: string): Promise<boolean>;
  select<T = unknown>(
    table: string,
    options?: {
      where?: VersionsWhere;
      columns?: string[];
      orderBy?: { column: string; direction?: "asc" | "desc" }[];
      limit?: number;
      offset?: number;
    }
  ): Promise<T[]>;
  count(table: string, options?: { where?: VersionsWhere }): Promise<number>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: VersionsWhere
  ): Promise<number>;
  delete(table: string, where: VersionsWhere): Promise<number>;
}

/** Where warnings go. */
export interface NoticesLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/** One notice to write. @experimental */
export interface RecordNoticeInput<TData> {
  /** The registered kind; its schema types and validates `data`. */
  kind: NoticeKind<TData>;
  /** The one person it is for. */
  userId: string;
  /** What it is about, of the kind's subject type. */
  subjectId: string;
  /**
   * Which occurrence: the same value again is the same notice. Chosen by the
   * kind's writer, such as the revision at which a release stopped.
   */
  occurrence: string;
  /** The kind's snapshot of the subject. */
  data: TData;
}

/** What a write did. @experimental */
export interface RecordNoticeResult {
  /** True only for the call that created the notice. */
  created: boolean;
  /** The notice's id, or `null` when the write was skipped. */
  id: string | null;
}

/** One notice as its person sees it. @experimental */
export interface NoticeView {
  id: string;
  kind: string;
  title: string;
  body?: string;
  subject: {
    type: string;
    id: string;
    /** Where it is in the admin; `null` when it has none or is gone. */
    link: string | null;
    /** The subject no longer exists. */
    gone: boolean;
  };
  createdAt: Date;
  readAt: Date | null;
}

/** A page of a person's notices. @experimental */
export interface NoticePage {
  rows: NoticeView[];
  total: number;
  page: number;
  limit: number;
}

/** Notices per page when the caller asks for none, and the most it may. */
export const DEFAULT_NOTICE_PAGE_SIZE = 20;
export const MAX_NOTICE_PAGE_SIZE = 100;

interface NoticeRow {
  id: string;
  userId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  occurrence: string;
  data: unknown;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * The identity of a notice, as one digest: who, which kind, what about, which
 * occurrence. Each part is encoded before joining, so no value can carry a
 * separator into its neighbour and collide with a different notice.
 */
export function noticeDedupeKey(input: {
  userId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  occurrence: string;
}): string {
  const joined = [
    input.userId,
    input.kind,
    input.subjectType,
    input.subjectId,
    input.occurrence,
  ]
    .map(encodeURIComponent)
    .join(":");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

export class NoticesService {
  /** Once seen, the table stays; absence is probed again on each call. */
  private tableKnownPresent = false;
  private warnedMissing = false;

  constructor(
    private readonly deps: { db: NoticesDb; logger?: NoticesLogger }
  ) {}

  /**
   * Write a notice, once per occurrence.
   *
   * Pass the caller's transaction as `tx` so the notice stands or falls with
   * the change it reports.
   */
  async record<TData>(
    input: RecordNoticeInput<TData>,
    tx?: NoticesWriter
  ): Promise<RecordNoticeResult> {
    // A kind must be registered to be written, so nothing is stored that the
    // reader could not show.
    if (registeredNoticeKind(input.kind.key) !== input.kind) {
      throw NextlyError.internal({
        logContext: {
          detail: `Notice kind "${input.kind.key}" is not registered. Register it with registerNoticeKind() from its feature's DI registration.`,
          reason: "notice-kind-unregistered",
          kind: input.kind.key,
        },
      });
    }
    const parsed = input.kind.data.safeParse(input.data);
    if (!parsed.success) {
      throw NextlyError.internal({
        logContext: {
          detail: `Notice data does not match kind "${input.kind.key}".`,
          reason: "notice-data-invalid",
          kind: input.kind.key,
          issues: parsed.error.issues.map(issue => issue.path.join(".")),
        },
      });
    }
    assertReferencesFit(input.kind.key, input.subjectId, input.occurrence);
    const data = jsonSnapshot(input.kind, parsed.data);
    if (!(await this.tablePresent())) return { created: false, id: null };

    const row = {
      id: uuidV7(),
      userId: input.userId,
      kind: input.kind.key,
      subjectType: input.kind.subjectType,
      subjectId: input.subjectId,
      occurrence: input.occurrence,
      dedupeKey: noticeDedupeKey({
        userId: input.userId,
        kind: input.kind.key,
        subjectType: input.kind.subjectType,
        subjectId: input.subjectId,
        occurrence: input.occurrence,
      }),
      data,
      createdAt: new Date(),
      readAt: null,
    };
    // Insert, or keep the row already there: an upsert that names nothing
    // to update keeps the existing row on every dialect and answers with the
    // row that stands, without raising on the repeat. Its id says whether it
    // is the one just made.
    const stored = await (tx ?? this.deps.db).upsert<{ id?: string } | null>(
      NOTICES_TABLE,
      row,
      { conflictColumns: ["dedupeKey"], updateColumns: [] }
    );
    // Created only when the row that stands is the one just made. No row at all
    // means a kept row vanished between the conflict and its read-back (its
    // person deleted, or retention ran): nothing was created, and answering
    // with the id generated here would claim a notice that was never stored.
    if (stored === null || stored === undefined) {
      return { created: false, id: null };
    }
    return { created: stored.id === row.id, id: stored.id ?? null };
  }

  /** A page of this person's notices, newest first. */
  async find(query: {
    userId: string;
    unread?: boolean;
    page?: number;
    limit?: number;
  }): Promise<NoticePage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_NOTICE_PAGE_SIZE;
    assertPaging(page, limit);
    const where = await this.whereFor(query.userId, query.unread);
    if (where === null) return { rows: [], total: 0, page, limit };

    const [rows, total] = await Promise.all([
      this.deps.db.select<NoticeRow>(NOTICES_TABLE, {
        where,
        orderBy: [...NOTICE_PAGE_ORDER],
        offset: (page - 1) * limit,
        limit,
      }),
      this.deps.db.count(NOTICES_TABLE, { where }),
    ]);
    return { rows: await this.viewsOf(rows), total, page, limit };
  }

  /** How many notices this person has, or how many are unread. */
  async count(query: { userId: string; unread?: boolean }): Promise<number> {
    const where = await this.whereFor(query.userId, query.unread);
    return where === null ? 0 : this.deps.db.count(NOTICES_TABLE, { where });
  }

  /**
   * Mark this person's notices read: the ones named, or all of them.
   *
   * Only the person's own rows, and only unread ones, so a notice keeps the
   * time it was first read, and an id that belongs to someone else changes
   * nothing and says nothing about whether it exists.
   *
   * @returns how many notices this call marked.
   */
  async markRead(
    input: { userId: string } & ({ ids: string[] } | { all: true })
  ): Promise<number> {
    if (!(await this.tablePresent())) return 0;
    // Only notices the person may see now, by the rule `find` and `count`
    // apply: one hidden by its kind is not marked read unseen.
    const kinds = await visibleKinds(input.userId);
    if (kinds.length === 0) return 0;
    const conditions: VersionsWhereCondition[] = [
      { column: "userId", op: "=", value: input.userId },
      { column: "kind", op: "IN", value: kinds },
      { column: "readAt", op: "IS NULL" },
    ];
    if ("ids" in input) {
      if (input.ids.length === 0) return 0;
      conditions.push({
        column: "id",
        op: "IN",
        value: [...new Set(input.ids)],
      });
    }
    return this.deps.db.updateCount(
      NOTICES_TABLE,
      { readAt: new Date() },
      { and: conditions }
    );
  }

  /**
   * Delete notices older than an instant, at most `limit` of them.
   *
   * Bounded so a retention pass over a large backlog takes it in turns.
   *
   * @returns how many were deleted.
   */
  async pruneOlderThan(before: Date, limit: number): Promise<number> {
    if (!(await this.tablePresent())) return 0;
    return deleteNoticesOlderThan(this.deps.db, before, limit);
  }

  /**
   * This person's notices that they may see: their own, of a registered kind
   * whose `visible` says yes. Decided in the query, so the total, the page and
   * the count agree. `null` when there is nothing they can see.
   */
  private async whereFor(
    userId: string,
    unread?: boolean
  ): Promise<VersionsWhere | null> {
    if (!(await this.tablePresent())) return null;
    const kinds = await visibleKinds(userId);
    if (kinds.length === 0) return null;
    const conditions: VersionsWhereCondition[] = [
      { column: "userId", op: "=", value: userId },
      { column: "kind", op: "IN", value: kinds },
    ];
    if (unread === true) conditions.push({ column: "readAt", op: "IS NULL" });
    return { and: conditions };
  }

  /** Render a page: each kind's text, and its links resolved once per kind. */
  private async viewsOf(rows: NoticeRow[]): Promise<NoticeView[]> {
    const links = new Map<string, ReadonlyMap<string, string> | null>();
    for (const kindKey of new Set(rows.map(row => row.kind))) {
      const kind = registeredNoticeKind(kindKey);
      if (kind?.link === undefined) {
        links.set(kindKey, null);
        continue;
      }
      const ids = rows
        .filter(row => row.kind === kindKey)
        .map(r => r.subjectId);
      links.set(kindKey, await kind.link([...new Set(ids)]));
    }
    return rows.flatMap(row => {
      const kind = registeredNoticeKind(row.kind);
      // Filtered in the query; a kind unregistered since is skipped, not shown
      // half-rendered.
      if (kind === undefined) return [];
      const known = links.get(row.kind) ?? null;
      const link = known?.get(row.subjectId) ?? null;
      const gone = known !== null && link === null;
      const parsed = kind.data.safeParse(row.data);
      const text = parsed.success
        ? kind.render(parsed.data, { subjectGone: gone })
        : // A snapshot written before its kind's schema changed. Shown
          // plainly rather than dropped, so the count and the list agree.
          { title: "This notice can no longer be shown." };
      return [
        {
          id: row.id,
          kind: row.kind,
          title: text.title,
          ...(text.body === undefined ? {} : { body: text.body }),
          subject: { type: row.subjectType, id: row.subjectId, link, gone },
          createdAt: row.createdAt,
          readAt: row.readAt,
        },
      ];
    });
  }

  /** Whether the table exists yet, warning once when it does not. */
  private async tablePresent(): Promise<boolean> {
    if (this.tableKnownPresent) return true;
    let present: boolean;
    try {
      present = await this.deps.db.tableExists(NOTICES_TABLE);
    } catch {
      // An unanswerable probe is treated as present: the statement that
      // follows then reports the real problem rather than this hiding it.
      present = true;
    }
    if (present) {
      this.tableKnownPresent = true;
      return true;
    }
    if (!this.warnedMissing) {
      this.warnedMissing = true;
      this.deps.logger?.warn(
        `Notices are not being recorded or shown: the "${NOTICES_TABLE}" table does not exist yet. Run \`nextly migrate\` to create it.`,
        { table: NOTICES_TABLE }
      );
    }
    return false;
  }
}

/** The registered kinds a person may see now: each kind's `visible`, or all. */
async function visibleKinds(userId: string): Promise<string[]> {
  const kinds: string[] = [];
  for (const kind of registeredNoticeKinds()) {
    if (kind.visible === undefined || (await kind.visible(userId))) {
      kinds.push(kind.key);
    }
  }
  return kinds;
}

/**
 * Refuse a subject id or occurrence longer than its column holds on MySQL,
 * on every dialect, so one cannot store what another truncates.
 */
function assertReferencesFit(
  kind: string,
  subjectId: string,
  occurrence: string
): void {
  if (
    subjectId.length <= NOTICE_REFERENCE_MAX &&
    occurrence.length <= NOTICE_REFERENCE_MAX
  ) {
    return;
  }
  throw NextlyError.internal({
    logContext: {
      detail: `A notice's subject id and occurrence must be at most ${NOTICE_REFERENCE_MAX} characters.`,
      reason: "notice-reference-too-long",
      kind,
    },
  });
}

/** What a stored snapshot must survive: JSON, exactly as written. */
const UNSTORABLE = Symbol("unstorable");

/**
 * The kind's data as it will be stored and read back. It must survive JSON
 * storage and still satisfy the kind's schema, or a snapshot that passes now —
 * a `bigint`, a `Date` — would fail the insert, or fail the same schema when
 * the notice is read.
 */
function jsonSnapshot(
  kind: {
    key: string;
    data: { safeParse(value: unknown): { success: boolean } };
  },
  data: unknown
): unknown {
  let stored: unknown;
  try {
    // `undefined` (and a function) has no JSON form at all: stringify
    // answers undefined, which is as unstorable as a bigint.
    const text: string | undefined = JSON.stringify(data);
    stored = text === undefined ? UNSTORABLE : JSON.parse(text);
  } catch {
    stored = UNSTORABLE;
  }
  if (stored !== UNSTORABLE && kind.data.safeParse(stored).success) {
    return stored;
  }
  throw NextlyError.internal({
    logContext: {
      detail: `Notice data for kind "${kind.key}" does not survive JSON storage: use only JSON values (no bigint or Date).`,
      reason: "notice-data-not-json",
      kind: kind.key,
    },
  });
}

/**
 * The part of the database pruning needs: reading the oldest ids and deleting
 * them. Narrower than {@link NoticesDb} so the retention pass, which prunes
 * several areas through one adapter, does not have to offer the notices
 * service's whole surface. `tableExists`, when offered, lets a database from
 * before notices be passed over quietly.
 */
export interface NoticesPruneDb {
  select<T = unknown>(
    table: string,
    options: {
      columns: string[];
      where: { and: VersionsWhereCondition[] };
      orderBy: { column: string; direction: "asc" | "desc" }[];
      limit: number;
    }
  ): Promise<T[]>;
  delete(
    table: string,
    where: { and: VersionsWhereCondition[] }
  ): Promise<number>;
  tableExists?(table: string): Promise<boolean>;
}

/** Remove up to `limit` notices created before `before`, oldest first. */
export async function deleteNoticesOlderThan(
  db: NoticesPruneDb,
  before: Date,
  limit: number
): Promise<number> {
  const old = await db.select<{ id: string }>(NOTICES_TABLE, {
    // The ids alone: every row also carries its snapshot, which a delete
    // by id never needs to read.
    columns: ["id"],
    where: { and: [{ column: "createdAt", op: "<", value: before }] },
    orderBy: [{ column: "createdAt", direction: "asc" }],
    limit,
  });
  if (old.length === 0) return 0;
  return db.delete(NOTICES_TABLE, {
    and: [{ column: "id", op: "IN", value: old.map(row => row.id) }],
  });
}

/** Refuse a page or size that is not a safe whole number in range. */
function assertPaging(page: number, limit: number): void {
  const offset = (page - 1) * limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_NOTICE_PAGE_SIZE ||
    !Number.isSafeInteger(offset)
  ) {
    throw NextlyError.invalidInput({
      message: `\`page\` must be a whole number from 1, and \`limit\` from 1 to ${MAX_NOTICE_PAGE_SIZE}.`,
      logContext: { reason: "invalid-notice-paging", page, limit },
    });
  }
}
