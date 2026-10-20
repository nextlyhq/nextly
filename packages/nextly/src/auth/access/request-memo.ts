/**
 * The access lookups one request has already made, kept for the rest of it.
 *
 * A request can ask about the same caller many times: a collection gate, a
 * route gate, a rule's context, and the field rules on every row of a list.
 * Each asked the database again, so a list of N rows with field rules cost a
 * role and permission lookup per row. Within one request the answer cannot
 * change unless the request itself changes a role, so each lookup is made once
 * and its result reused, and any role or permission write in the request
 * forgets everything kept so far.
 *
 * Only lookups on the pool are kept. A lookup handed a transaction reads that
 * transaction's own uncommitted rows, which may differ from the pool's and
 * from each other, so it is never kept or served.
 *
 * Outside a request nothing is kept: work with no request, such as a job or a
 * script, looks every answer up as it always has.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const lookups = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/**
 * Runs `operation` with a memo for the request. A memo already open is kept,
 * so a route reached inside another request's handling shares its lookups.
 */
export function runWithAccessMemo<T>(operation: () => T): T {
  if (lookups.getStore()) return operation();
  return lookups.run(new Map(), operation);
}

/**
 * The result of `load` under `key`, looked up once per request. A lookup that
 * fails is not kept, so the next ask tries again rather than repeating the
 * failure for the rest of the request.
 */
export function rememberForRequest<T>(
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const memo = lookups.getStore();
  if (!memo) return load();
  const known = memo.get(key) as Promise<T> | undefined;
  if (known) return known;
  const made = load();
  memo.set(key, made);
  made.catch(() => {
    if (memo.get(key) === made) memo.delete(key);
  });
  return made;
}

/**
 * Forgets every lookup the request has kept. Called when the request writes a
 * role, a permission or a role assignment, so a later ask sees the change.
 */
export function forgetRequestAccess(): void {
  lookups.getStore()?.clear();
}
