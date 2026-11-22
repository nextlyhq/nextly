/**
 * Where the closed-to-super-admin marks are kept in the database.
 *
 * Two `nextly_meta` rows, each spelled only here:
 * - the collections a super-admin closed in the admin, `{ collections: [slug] }`,
 *   read by every instance (`auth/access/closed-to-super-admin`) and written by
 *   the admin's change, which locks the row so two changes at once never lose
 *   one;
 * - what the configuration said, `{ collections: { [slug]: boolean } }`, as
 *   the last `nextly migrate` or development start found it, so a change made
 *   in code is written to the audit log once, when it first takes effect.
 *
 * @module domains/meta/closed-to-super-admin-marks
 */

import type { MetaService } from "./services/meta-service";

/** The collections the admin closed to super-admin. */
const STORED_KEY = "collections-closed-to-super-admin";

/** What the configuration said about each collection, as last applied. */
const DECLARED_KEY = "collections-closed-to-super-admin-in-code";

/** A value's slugs, reading anything not of the shape as none. */
function slugsOf(raw: unknown): string[] {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (typeof value !== "object" || value === null) return [];
  const { collections } = value as Record<string, unknown>;
  return Array.isArray(collections)
    ? collections.filter((slug): slug is string => typeof slug === "string")
    : [];
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The collections the admin closed to super-admin. */
export async function readStoredClosedMarks(
  meta: Pick<MetaService, "getEntry">,
  executor?: unknown,
  options: { lock?: boolean } = {}
): Promise<string[]> {
  const entry = await meta.getEntry<unknown>(STORED_KEY, executor, options);
  return entry.present ? slugsOf(entry.value) : [];
}

/**
 * Sets one collection's mark on `executor`, the transaction the change and
 * its audit row commit in, reading the row locked first. Returns whether it
 * was closed before.
 */
export async function writeStoredClosedMark(
  meta: Pick<MetaService, "getEntry" | "set" | "insertIfAbsent">,
  executor: unknown,
  slug: string,
  closed: boolean
): Promise<boolean> {
  // The row is made first, so the locked read below always has a row to
  // lock: two first changes at once would otherwise both read none, and the
  // later write would drop the earlier one's mark.
  await meta.insertIfAbsent(STORED_KEY, { collections: [] }, executor);
  const slugs = new Set(
    await readStoredClosedMarks(meta, executor, { lock: true })
  );
  const before = slugs.has(slug);
  if (closed) slugs.add(slug);
  else slugs.delete(slug);
  await meta.set(STORED_KEY, { collections: [...slugs].sort() }, executor);
  return before;
}

/** What the configuration said, as last applied, by slug. */
async function readAppliedDeclaredMarks(
  meta: Pick<MetaService, "getEntry">,
  executor?: unknown,
  options: { lock?: boolean } = {}
): Promise<Map<string, boolean>> {
  const entry = await meta.getEntry<unknown>(DECLARED_KEY, executor, options);
  const marks = new Map<string, boolean>();
  if (!entry.present) return marks;
  const value =
    typeof entry.value === "string" ? safeParse(entry.value) : entry.value;
  if (typeof value !== "object" || value === null) return marks;
  const { collections } = value as Record<string, unknown>;
  if (typeof collections !== "object" || collections === null) return marks;
  for (const [slug, closed] of Object.entries(collections)) {
    if (typeof closed === "boolean") marks.set(slug, closed);
  }
  return marks;
}

/** Records what the configuration says now, on `executor`. */
async function recordAppliedDeclaredMarks(
  meta: Pick<MetaService, "set">,
  executor: unknown,
  marks: ReadonlyMap<string, boolean>
): Promise<void> {
  await meta.set(
    DECLARED_KEY,
    { collections: Object.fromEntries([...marks].sort()) },
    executor
  );
}

/** One change the configuration made to a collection's mark. */
export interface DeclaredClosedMarkChange {
  collection: string;
  before: boolean;
  after: boolean;
}

/** What {@link applyDeclaredClosedMarks} reads and writes through. */
export interface DeclaredClosedMarksDeps {
  meta: Pick<MetaService, "getEntry" | "set" | "insertIfAbsent">;
  /** Runs `work` in one transaction, handing it the transaction's executor. */
  transaction: (work: (executor: unknown) => Promise<void>) => Promise<void>;
}

/**
 * Records what the configuration says about each collection's mark, and
 * answers each collection whose mark that changes, with its value before and
 * after: the first `nextly migrate` or development start that applies a
 * change made in code, so the audit log records it once. A collection's value
 * is the code's where the code says it, and otherwise the admin's stored one,
 * both before and after. Read locked and written in one transaction, so two
 * runs at once report each change once.
 */
export async function applyDeclaredClosedMarks(
  deps: DeclaredClosedMarksDeps,
  collections: ReadonlyArray<{ slug: string; closedToSuperAdmin?: boolean }>
): Promise<DeclaredClosedMarkChange[]> {
  const declared = new Map<string, boolean>();
  for (const { slug, closedToSuperAdmin } of collections) {
    if (typeof closedToSuperAdmin === "boolean" && !declared.has(slug)) {
      declared.set(slug, closedToSuperAdmin);
    }
  }
  let changes: DeclaredClosedMarkChange[] = [];
  await deps.transaction(async executor => {
    // Started afresh by an attempt the adapter retries.
    changes = [];
    // Made first, so the locked read has a row to lock (as for the admin's
    // marks above): two first runs at once then report each change once.
    await deps.meta.insertIfAbsent(DECLARED_KEY, { collections: {} }, executor);
    const applied = await readAppliedDeclaredMarks(deps.meta, executor, {
      lock: true,
    });
    const stored = new Set(await readStoredClosedMarks(deps.meta, executor));
    const slugs = new Set([...applied.keys(), ...declared.keys()]);
    for (const collection of [...slugs].sort()) {
      const before = applied.get(collection) ?? stored.has(collection);
      const after = declared.get(collection) ?? stored.has(collection);
      if (before !== after) changes.push({ collection, before, after });
    }
    const same =
      applied.size === declared.size &&
      [...declared].every(([slug, closed]) => applied.get(slug) === closed);
    if (!same) await recordAppliedDeclaredMarks(deps.meta, executor, declared);
  });
  return changes;
}
