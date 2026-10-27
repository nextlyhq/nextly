/**
 * The access lookups one request has already made, kept for the rest of it.
 *
 * A request can ask about the same caller many times: a collection gate, a
 * route gate, a rule's context, and the field rules on every row of a list.
 * Each asked the database again, so a list of N rows with field rules cost a
 * role and permission lookup per row. Within one request the answer changes
 * only when a role or permission is written, here or anywhere else, or a role
 * assignment expires. So each lookup is made once and its result reused, and
 * what is kept is served only under the revision of the role and permission
 * rows it was read under, which any write anywhere moves, and only until a role
 * assignment it came from expires.
 *
 * Only lookups on the pool are kept. A lookup handed a transaction reads that
 * transaction's own uncommitted rows, which may differ from the pool's and
 * from each other, so it is never kept or served.
 *
 * Outside a request nothing is kept: work with no request, such as a job or a
 * script, looks every answer up as it always has.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What a request has looked up about one user, the revision of the role and
 * permission rows it was read under, and the moment it stops holding: the
 * soonest expiry of a role assignment any of it came from.
 */
type KeptForUser = {
  revision: string;
  until: number | undefined;
  answers: Map<string, Promise<unknown>>;
};

const lookups = new AsyncLocalStorage<Map<string, KeptForUser>>();

/**
 * Runs `operation` with a memo for the request. A memo already open is kept,
 * so a route reached inside another request's handling shares its lookups.
 */
export function runWithAccessMemo<T>(operation: () => T): T {
  if (lookups.getStore()) return operation();
  return lookups.run(new Map(), operation);
}

/**
 * The answer to `question` about `userId`, looked up once per request while
 * the rows it is read from stay at `revision`. Asked under another revision,
 * everything kept about the user is forgotten and looked up again. A lookup
 * that fails is not kept, so the next ask tries again rather than repeating
 * the failure for the rest of the request.
 */
export function rememberForRequest<T>(
  userId: string,
  question: string,
  revision: string,
  load: () => Promise<T>
): Promise<T> {
  const memo = lookups.getStore();
  if (!memo) return load();
  const { answers } = keptFor(memo, userId, revision);
  const known = answers.get(question) as Promise<T> | undefined;
  if (known) return known;
  const made = load();
  answers.set(question, made);
  made.catch(() => {
    if (answers.get(question) === made) answers.delete(question);
  });
  return made;
}

/**
 * Records that what the request knows about `userId` stops holding at
 * `moment` (epoch milliseconds), when a role assignment it came from expires.
 * Every answer about the user is forgotten then, so none outlives the role,
 * however long the request runs. Called wherever an answer is read: a role
 * walk, and each cache that serves one.
 */
export function answersHoldUntil(
  userId: string,
  moment: number | undefined
): void {
  const memo = lookups.getStore();
  if (!memo || moment === undefined) return;
  const kept = memo.get(userId);
  if (!kept) return;
  kept.until = kept.until === undefined ? moment : Math.min(kept.until, moment);
}

/**
 * What the request still holds about `userId` at `revision`; nothing once the
 * revision has moved or a role behind it has lapsed.
 */
function keptFor(
  memo: Map<string, KeptForUser>,
  userId: string,
  revision: string
): KeptForUser {
  const kept = memo.get(userId);
  if (
    kept &&
    kept.revision === revision &&
    (kept.until === undefined || Date.now() < kept.until)
  ) {
    return kept;
  }
  const fresh: KeptForUser = { revision, until: undefined, answers: new Map() };
  memo.set(userId, fresh);
  return fresh;
}

/**
 * What each request has answered about an object, such as a key's scope, kept
 * beside its per-user lookups and dropped with the request.
 */
const keptAboutObjects = new WeakMap<
  Map<string, KeptForUser>,
  WeakMap<object, unknown>
>();

/**
 * The answer `ask` gives about `subject`, asked once per request and given
 * again to every later question about it there, so the doors one operation
 * passes agree even when the answer would change partway through it. A later
 * request asks again. Outside a request it is asked every time.
 */
export function onceForRequest<T>(subject: object, ask: () => T): T {
  const memo = lookups.getStore();
  if (!memo) return ask();
  let kept = keptAboutObjects.get(memo);
  if (!kept) {
    kept = new WeakMap();
    keptAboutObjects.set(memo, kept);
  }
  if (kept.has(subject)) return kept.get(subject) as T;
  const answer = ask();
  kept.set(subject, answer);
  return answer;
}

/**
 * Forgets every lookup the request has kept. Called when the request writes a
 * role, a permission or a role assignment, so a later ask sees the change.
 */
export function forgetRequestAccess(): void {
  lookups.getStore()?.clear();
}
