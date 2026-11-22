/**
 * Collections closed to super-admin: which collections refuse their entries
 * to every caller holding super-admin authority, and the one question every
 * way in asks before letting such a caller past the collection's rules.
 *
 * A super-admin passes every collection rule, so without this no collection
 * can keep its data from the most powerful accounts. A collection marked
 * closed refuses its entries to a super-admin person, and to a full-access API
 * key carrying its maker's super-admin authority, whatever other permissions
 * either holds. Trusted server code (`overrideAccess: true`) is not a caller
 * and is unaffected.
 *
 * The mark is set in two places, and code wins:
 * - in code, `closedToSuperAdmin` on the collection's definition, registered
 *   at each start ({@link declareClosedToSuperAdmin});
 * - in the admin, for a collection whose code says nothing (one made in the
 *   Schema Builder, say), stored in `nextly_meta` and read through the reader
 *   the start registers ({@link useStoredClosedMarks}), at most every
 *   {@link STORED_MARKS_TTL_MS}, so a change made on one instance holds on the
 *   others within that time.
 *
 * Kept free of every other module, so the access decision can ask it
 * synchronously ({@link isClosedToSuperAdmin}); the asynchronous ways in ask
 * `superAdminRefusedOn` (`./closed-to-super-admin-refusal`), which reads the
 * stored marks first.
 *
 * @module auth/access/closed-to-super-admin
 */

/** How long the stored marks are trusted before they are read again. */
export const STORED_MARKS_TTL_MS = 5_000;

/** Where a collection's mark comes from, as the admin shows it. */
export type ClosedMarkSource = "code" | "admin";

/** A collection's mark, as the admin shows it. */
export interface ClosedToSuperAdminMark {
  closed: boolean;
  /** Where it is set; `null` where nothing sets it, so it is open. */
  setIn: ClosedMarkSource | null;
}

interface ClosedMarksState {
  /** By slug, what the code says, for each collection whose code says it. */
  declared: Map<string, boolean>;
  /** The collections the admin closed, as last read. */
  stored: Set<string>;
  /** When `stored` was read; 0 before the first read. */
  storedAt: number;
  /**
   * The read the start registered, absent where nothing was registered; on
   * the caller's transaction where one is handed in.
   */
  read?: (executor?: unknown) => Promise<readonly string[]>;
  /** A read in flight, joined by any caller that arrives meanwhile. */
  reading?: Promise<void>;
  /**
   * Counts this instance's own changes, so a read that began before one is
   * not taken over it.
   */
  changes: number;
}

/**
 * On `globalThis`, for the reason the rest of the access state is: Next.js
 * can evaluate this module in more than one server graph, and every copy must
 * answer the same.
 */
const holder = globalThis as unknown as {
  __nextly_closedToSuperAdmin?: ClosedMarksState;
};

function state(): ClosedMarksState {
  return (holder.__nextly_closedToSuperAdmin ??= {
    declared: new Map(),
    stored: new Set(),
    storedAt: 0,
    changes: 0,
  });
}

/**
 * Registers what the configuration's collections say: each one declaring
 * `closedToSuperAdmin` (`true` or `false`), replacing what an earlier start in
 * this process registered.
 */
export function declareClosedToSuperAdmin(
  collections: ReadonlyArray<{ slug: string; closedToSuperAdmin?: boolean }>
): void {
  const declared = new Map<string, boolean>();
  for (const { slug, closedToSuperAdmin } of collections) {
    if (typeof closedToSuperAdmin === "boolean" && !declared.has(slug)) {
      declared.set(slug, closedToSuperAdmin);
    }
  }
  state().declared = declared;
}

/**
 * Registers how the marks set in the admin are read, and forgets the last
 * read, so the next question reads them afresh.
 */
export function useStoredClosedMarks(
  read: (executor?: unknown) => Promise<readonly string[]>
): void {
  const s = state();
  s.read = read;
  s.storedAt = 0;
}

/**
 * Takes a change the admin just made on this instance at once, rather than
 * at the next read.
 */
export function noteStoredClosedMark(slug: string, closed: boolean): void {
  const s = state();
  s.changes += 1;
  if (closed) s.stored.add(slug);
  else s.stored.delete(slug);
}

/** A collection's mark from what is known now, without reading anything. */
export function closedMarkOf(slug: string): ClosedToSuperAdminMark {
  const s = state();
  const declared = s.declared.get(slug);
  if (declared !== undefined) {
    return { closed: declared, setIn: "code" };
  }
  return s.stored.has(slug)
    ? { closed: true, setIn: "admin" }
    : { closed: false, setIn: null };
}

/**
 * Whether `slug` is closed to super-admin, from what is known now: the
 * synchronous answer the access decision reads. Every asynchronous way in
 * reads the stored marks first (`superAdminRefusedOn`), so this answers
 * from marks no older than theirs.
 */
export function isClosedToSuperAdmin(slug: string): boolean {
  return closedMarkOf(slug).closed;
}

/**
 * Reads the stored marks where the last read is older than
 * {@link STORED_MARKS_TTL_MS}. A failed read throws, so the question fails
 * rather than answering from marks it could not read: a mark closing a
 * collection must not be read as absent.
 *
 * Asked inside a transaction, it reads on that transaction's `executor` and
 * joins no read in flight on the pool: waiting for a pooled connection the
 * transaction itself may be holding would never end.
 */
export async function refreshStoredClosedMarks(
  options: { now?: number; executor?: unknown } = {}
): Promise<void> {
  const s = state();
  const now = options.now ?? Date.now();
  if (s.read === undefined || now - s.storedAt < STORED_MARKS_TTL_MS) return;
  const read = s.read;
  const began = s.changes;
  // A read that began before this instance made a change of its own is
  // dropped, not taken: it may predate the change, and taking it would undo
  // the change here until the next read. The next question reads again.
  const take = (slugs: readonly string[]) => {
    if (s.changes !== began) return;
    s.stored = new Set(slugs);
    s.storedAt = Date.now();
  };
  if (options.executor !== undefined) {
    take(await read(options.executor));
    return;
  }
  s.reading ??= (async () => {
    try {
      take(await read());
    } finally {
      s.reading = undefined;
    }
  })();
  await s.reading;
}

/** Every collection the code or the admin closes, by slug, from what is known now. */
export function closedCollections(): string[] {
  const s = state();
  const slugs = new Set<string>();
  for (const [slug, closed] of s.declared) if (closed) slugs.add(slug);
  for (const slug of s.stored) {
    if (!s.declared.has(slug)) slugs.add(slug);
  }
  return [...slugs].sort();
}
