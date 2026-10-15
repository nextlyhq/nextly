/**
 * Recognising a person of a plugin's kind on a request.
 *
 * Core calls a kind's resolver only where an entry point asks for that kind,
 * and at most once per request: the handler, its rules and its Direct API
 * calls must all see one person, and a resolver that reads a database must
 * not be paid for again by every one of them. The answer is checked against
 * what the kind declared before anyone sees it, so a resolver that answers
 * badly makes nobody signed in rather than a person with an unusable id.
 *
 * @module plugins/principals/recognise
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import {
  carriesBearerToken,
  isUnsafeMethod,
  validateOrigin,
} from "../../auth/csrf/validate";
import {
  markCrossSiteRefused,
  markSessionConsulted,
} from "../../auth/plugin-auth-api";
import { NextlyError } from "../../errors/nextly-error";
import { env } from "../../lib/env";
import { getNextlyLogger } from "../../observability/logger";

import { makePrincipal } from "./principal";
import { getPrincipalKind, type RegisteredPrincipalKind } from "./registry";
import type {
  Principal,
  PrincipalAttributeType,
  PrincipalAttributes,
} from "./types";

/** The longest id a resolver may answer with. */
export const MAX_PRINCIPAL_ID_LENGTH = 128;

type Answer = Promise<Principal | null>;

/**
 * The answers for the plugin route invocation running now.
 *
 * Per INVOCATION as well as per `Request` object, for the reason a route's
 * session consultation is: a handler that passes `req.clone()`, or any other
 * copy of its request, would otherwise miss the answer the route already has
 * and call the resolver a second time for the same request. Keyed by what
 * the resolver sees of each request (see {@link answerKey}), so a copy shares
 * the routed request's answer and a different request, carrying someone
 * else's session, gets its own.
 */
const invocationAnswers = new AsyncLocalStorage<Map<string, Answer>>();

/** The answers for each request seen outside a route invocation. */
const requestAnswers = new WeakMap<Request, Map<string, Answer>>();

/**
 * The key an answer is kept under: the kind, and everything the kind's
 * resolver can see of the request.
 *
 * A resolver is handed the method, the address and the headers, and nothing
 * else ({@link withoutBody}), so two requests alike in all three are the same
 * question and get the same answer, and requests that differ in any of them
 * are asked apart. Hashed, so the map holds no session cookie or token.
 */
function answerKey(request: Request, kind: string): string {
  const hash = createHash("sha256");
  hash.update(`${kind}\0${request.method}\0${request.url}`);
  for (const [name, value] of request.headers) {
    hash.update(`\0${name}:${value}`);
  }
  return hash.digest("base64url");
}

function answersFor(request: Request): Map<string, Answer> {
  const pinned = invocationAnswers.getStore();
  if (pinned) return pinned;
  let answers = requestAnswers.get(request);
  if (!answers) {
    answers = new Map();
    requestAnswers.set(request, answers);
  }
  return answers;
}

/**
 * Run `operation` with `request`'s answers pinned, so every entry point inside
 * it shares them when handed the request or any copy of it. A different
 * request asked about inside it is still asked about on its own.
 */
export function runWithPrincipalAnswers<T>(
  request: Request,
  operation: () => T
): T {
  return invocationAnswers.run(answersFor(request), operation);
}

/** Whether `value` is one an attribute declared as `type` may hold. */
function isAttributeValue(
  value: unknown,
  type: PrincipalAttributeType
): boolean {
  if (value === null) return true;
  if (type === "number") {
    // Finite only: an infinity or NaN cannot travel as JSON, so a rule given
    // one would see a value no stored copy of it could hold.
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === type;
}

/** Whether `value` is an object a field can be read from, and not an array. */
function isObjectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether `id` is one a person may have: a string of 1 to 128 characters. */
function isPrincipalId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= MAX_PRINCIPAL_ID_LENGTH
  );
}

/**
 * The declared attributes' values from what a resolver answered, or why
 * they cannot be used.
 *
 * Walks the DECLARATION rather than the answer, so only declared attributes
 * are kept: the declaration is what a rule may rely on, and a value the
 * plugin did not declare never reaches one.
 */
function declaredValues(
  declared: RegisteredPrincipalKind["attributes"],
  given: Record<string, unknown>
): PrincipalAttributes | string {
  const kept: PrincipalAttributes = {};
  for (const [name, type] of Object.entries(declared)) {
    if (!Object.hasOwn(given, name)) return `attribute "${name}" is missing`;
    const value = given[name];
    if (!isAttributeValue(value, type)) {
      return `attribute "${name}" must be a ${type} or null`;
    }
    kept[name] = value as PrincipalAttributes[string];
  }
  return kept;
}

/**
 * The person a resolver's answer names, `null` for nobody, or why the answer
 * cannot be used.
 */
function checkedAnswer(
  registered: RegisteredPrincipalKind,
  answer: unknown
): Principal | null | string {
  if (answer === null || answer === undefined) return null;
  if (!isObjectValue(answer)) {
    return "the answer must be { id, attributes } or null";
  }
  const { id, attributes } = answer;
  if (!isPrincipalId(id)) {
    return `id must be a string of 1 to ${MAX_PRINCIPAL_ID_LENGTH} characters`;
  }
  if (!isObjectValue(attributes)) return "attributes must be an object";
  const kept = declaredValues(registered.attributes, attributes);
  return typeof kept === "string"
    ? kept
    : makePrincipal(registered.kind, id, kept);
}

/**
 * The request as a resolver is handed it: the same method, address and
 * headers, without the body.
 *
 * A resolver reads who is signed in from headers and cookies. Handed the
 * request itself, one that read the body would take it from the handler,
 * which would then find it already consumed.
 */
function withoutBody(request: Request): Request {
  return new Request(request.url, {
    method: request.method,
    headers: new Headers(request.headers),
  });
}

/** Which of a kind's functions answered. Both are checked the same way. */
type AnswerSource = "resolver" | "lookup";

/** Log why a kind's answer was taken for nobody. */
function warnInvalidAnswer(
  registered: RegisteredPrincipalKind,
  source: AnswerSource,
  problem: string
): void {
  getNextlyLogger().warn({
    kind: "principal-answer-invalid",
    source,
    principalKind: registered.kind,
    plugin: registered.plugin,
    problem,
  });
}

/**
 * Ask one of a kind's functions who someone is, and check the answer.
 *
 * One path for the resolver and the lookup, so a person found by id is held
 * to exactly the bounds of one found on a request: an answer either could
 * give, the other cannot get past.
 */
async function askKind(
  registered: RegisteredPrincipalKind,
  source: AnswerSource,
  ask: () => Promise<unknown>
): Answer {
  let answer: unknown;
  try {
    answer = await ask();
  } catch (error) {
    // The error's name only. Its message may quote the token or cookie the
    // plugin failed to read, and the log is no place for a credential.
    getNextlyLogger().warn({
      kind: `principal-${source}-failed`,
      principalKind: registered.kind,
      plugin: registered.plugin,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
  let checked: Principal | null | string;
  try {
    checked = checkedAnswer(registered, answer);
  } catch (error) {
    // An answer with a getter or a proxy that throws while it is read is as
    // unusable as one of the wrong shape, and is nobody like it. Inside the
    // guard, so a route serves its usual refusal rather than a 500.
    checked = `reading the answer threw ${error instanceof Error ? error.name : typeof error}`;
  }
  if (typeof checked === "string") {
    warnInvalidAnswer(registered, source, checked);
    return null;
  }
  return checked;
}

/** Call the kind's resolver once, and check what it answers. */
function resolveOnce(
  registered: RegisteredPrincipalKind,
  request: Request
): Answer {
  return askKind(registered, "resolver", () =>
    registered.definition.resolve(withoutBody(request))
  );
}

/**
 * The registered kind named `kind`, or the error a caller asking for a kind
 * nobody registered is owed. An unknown kind is a mistake in the calling
 * code, and answering nobody would hide it as a person who never signs in.
 */
export function requirePrincipalKind(kind: string): RegisteredPrincipalKind {
  const registered = getPrincipalKind(kind);
  if (!registered) {
    throw NextlyError.invalidInput({
      message: `No kind of signed-in person named ${JSON.stringify(kind)} is registered.`,
      logContext: { principalKind: kind },
    });
  }
  return registered;
}

/**
 * The person of `kind` on `request`, or `null`, calling the kind's resolver
 * at most once for the request whoever asks.
 *
 * Applies no cross-site rule: a plugin route asking for the kind applies its
 * own, which the route's `csrf` option chooses. Server code asking directly
 * goes through {@link principalFromRequest}.
 */
export function recognisePrincipal(request: Request, kind: string): Answer {
  const registered = requirePrincipalKind(kind);
  const answers = answersFor(request);
  const key = answerKey(request, kind);
  const known = answers.get(key);
  if (known) return known;
  const answer = resolveOnce(registered, request);
  answers.set(key, answer);
  return answer;
}

/**
 * The person of `kind` with this id, found through the kind's `lookup`, or
 * `null` when the plugin returns nobody for it.
 *
 * For running as a person without a request. A kind with no lookup cannot be
 * asked, and that is refused rather than answered with nobody: the caller
 * would read it as a person who does not exist. An id no person can have is
 * nobody without asking the plugin, and an answer naming someone other than
 * the person asked for is taken for nobody, as a resolver's bad answer is.
 */
export async function lookupPrincipal(
  kind: string,
  id: string
): Promise<Principal | null> {
  const registered = requirePrincipalKind(kind);
  const { definition } = registered;
  if (typeof definition.lookup !== "function") {
    throw NextlyError.invalidInput({
      message: `The kind of signed-in person ${JSON.stringify(kind)} has no lookup, so no person of it can be found by id.`,
      logContext: { principalKind: kind },
    });
  }
  if (!isPrincipalId(id)) return null;
  // Called as a method, so a class-based kind keeps its `this`.
  const principal = await askKind(registered, "lookup", async () =>
    definition.lookup ? definition.lookup(id) : null
  );
  if (principal !== null && principal.id !== id) {
    warnInvalidAnswer(
      registered,
      "lookup",
      "the lookup answered for a different id from the one asked for"
    );
    return null;
  }
  return principal;
}

/**
 * Whether `request` is a write another site could have made with the
 * browser's cookies: an unsafe method, from an origin that is neither this
 * site nor an allowed one, with no `Bearer` token to show otherwise.
 */
function isCrossSiteWrite(request: Request): boolean {
  return (
    isUnsafeMethod(request.method) &&
    !carriesBearerToken(request) &&
    !validateOrigin(request, env.NEXTLY_ALLOWED_ORIGINS_PARSED ?? [])
  );
}

/**
 * The person of `kind` on `request`, for server code that asks, or `null`.
 *
 * A write from another site gets nobody, as `ctx.auth.currentUser` gives it no
 * user: the plugin's session cookie travels with any request the browser
 * makes, so code acting on the person it reads would otherwise act for
 * whichever page posted to it. Inside a plugin route, the attempt is recorded
 * as the route's own cross-site refusals are.
 */
export async function principalFromRequest(
  request: Request,
  kind: string
): Promise<Principal | null> {
  // Before the answer, as `currentUser` records it: the response differs
  // between a signed-in and an anonymous caller either way, so it is personal
  // whoever turns out to be signed in.
  markSessionConsulted();
  const principal = await recognisePrincipal(request, kind);
  if (principal === null) return null;
  if (isCrossSiteWrite(request)) {
    markCrossSiteRefused();
    return null;
  }
  return principal;
}
