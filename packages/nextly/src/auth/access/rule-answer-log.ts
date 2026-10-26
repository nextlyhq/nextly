/**
 * The release-long notice for a request a rule no longer lets through.
 *
 * A code rule now allows only by answering exactly `true`. An app whose rule
 * answered `null`, `undefined` or a truthy value that is not `true` was let
 * in before and is refused now, and the rule reads as though it allows, so the
 * refusal is hard to place from the response alone. Each such refusal is
 * named once here, with what to change.
 *
 * Once per collection or Single, action and kind of caller, rather than once
 * per request: a rule that refuses on every request would otherwise fill the
 * log with one line per call, and the three together are what identifies the
 * rule to fix. The notice goes for the release that removes the behaviour it
 * describes.
 */
import { consoleLogger } from "../../shared/types";

/** What was refused, already named, so each is logged once per process. */
const named = new Set<string>();

/**
 * How a rule's answer reads in the notice: its kind, never its content. A
 * rule may hand back anything, a token included, and the notice needs only
 * to say that the answer was not `true`; reading the value could also throw,
 * which would fail the request the rule meant to refuse.
 */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  // `typeof` alone, which reads nothing of the value and so cannot throw,
  // even on a revoked proxy.
  const kind = typeof value;
  return kind === "object" ? "an object" : `a ${kind}`;
}

/**
 * Names a refusal a rule's answer would have allowed before, once.
 *
 * `caller` is the kind of caller, not the caller: a notice is for whoever
 * maintains the rule, and naming the person or the key would put an identity
 * in the log without telling them anything more about the rule.
 */
export function noticeRuleNoLongerAllows(
  slug: string,
  action: string,
  caller: string,
  value: unknown
): void {
  const key = `${slug}:${action}:${caller}`;
  if (named.has(key)) return;
  named.add(key);
  consoleLogger.warn(
    `[rbac] The ${action} rule of "${slug}" answered ${describe(value)}, ` +
      `so a ${caller} is now refused where it was allowed before. ` +
      `A code access rule allows only by returning true; return true to allow, ` +
      `false to refuse.`
  );
}

/** Forgets what has been named, so a test can watch the first notice again. */
export function clearRuleAnswerNotices(): void {
  named.clear();
}
