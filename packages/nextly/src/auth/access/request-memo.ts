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

import type { RuleFilter } from "./rule-answer";

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
 * What a collection's read rule answered in this request, by the question it
 * was asked: the target, who asked, and in which language. Kept only where a
 * read that applies the rule's filter asks it, so the reads of one request
 * that apply it, a list and its count, run the rule once.
 */
const ruleOutcomes = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/**
 * A route's verdict on an action it let its caller through on: every entry,
 * or the entries a read rule's filter matches.
 */
export type RouteVerdict =
  | { readonly all: true }
  | { readonly filter: RuleFilter };

/**
 * The verdicts the routes of this request gave, for the reads they authorized
 * to apply: by caller, target and action, and within those by the language
 * the route's rules were told. Kept apart from the lookups and rule outcomes
 * above, which a write in the request clears: the route's verdict is what
 * lets the read run, so it stands for the whole request, as the route's allow
 * does.
 */
const routeVerdicts = new AsyncLocalStorage<
  Map<string, Map<string, RouteVerdict>>
>();

/** Which caller a route judged, on which target and action, in which language. */
export interface RouteVerdictQuestion {
  readonly userId: string;
  readonly slug: string;
  readonly action: string;
  /** The rule language, as `ruleLanguageKey` names it. */
  readonly language: string;
}

const routeVerdictKey = (q: RouteVerdictQuestion): string =>
  JSON.stringify([q.userId, q.slug, q.action]);

/**
 * Runs `operation` with a memo for the request. A memo already open is kept,
 * so a route reached inside another request's handling shares its lookups.
 */
export function runWithAccessMemo<T>(operation: () => T): T {
  if (lookups.getStore()) return operation();
  return lookups.run(new Map(), () =>
    ruleOutcomes.run(new Map(), () => routeVerdicts.run(new Map(), operation))
  );
}

/**
 * Keeps a route's verdict, for the read it authorized. `false` outside a
 * request, where nothing can carry it to that read, so a route letting its
 * caller through on a filter refuses rather than let the read run unfiltered.
 */
export function rememberRouteVerdict(
  question: RouteVerdictQuestion,
  verdict: RouteVerdict
): boolean {
  const kept = routeVerdicts.getStore();
  if (!kept) return false;
  const key = routeVerdictKey(question);
  const byLanguage = kept.get(key) ?? new Map<string, RouteVerdict>();
  byLanguage.set(question.language, verdict);
  kept.set(key, byLanguage);
  return true;
}

/**
 * The verdict a route in this request gave on `question`: the verdict kept in
 * its language; `"other-language"` where the route judged this caller,
 * target and action only in other languages, whose verdicts say nothing of
 * this one; `undefined` where no route in the request judged them.
 */
export function routeVerdictFor(
  question: RouteVerdictQuestion
): RouteVerdict | "other-language" | undefined {
  const byLanguage = routeVerdicts.getStore()?.get(routeVerdictKey(question));
  if (!byLanguage) return undefined;
  return byLanguage.get(question.language) ?? "other-language";
}

/**
 * A read rule's outcome for `question`, asked once per request. Outside a
 * request it is asked every time. An ask that fails is not kept, so the next
 * one asks again. `question` must name everything the rule is told: the
 * target, the caller and the language.
 */
export function rememberRuleOutcome<T>(
  question: string,
  ask: () => Promise<T>
): Promise<T> {
  const kept = ruleOutcomes.getStore();
  if (!kept) return ask();
  const known = kept.get(question) as Promise<T> | undefined;
  if (known) return known;
  const made = ask();
  kept.set(question, made);
  made.catch(() => {
    if (kept.get(question) === made) kept.delete(question);
  });
  return made;
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
 * Forgets every lookup the request has kept. Called when the request writes a
 * role, a permission or a role assignment, so a later ask sees the change.
 */
export function forgetRequestAccess(): void {
  lookups.getStore()?.clear();
  // A rule is told the caller's roles and permissions, so what it answered
  // goes with them.
  ruleOutcomes.getStore()?.clear();
}
