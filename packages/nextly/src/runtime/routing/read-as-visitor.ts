/**
 * Run a public read as no one: detached from the request being served, and
 * from any person the operation around it is made as.
 *
 * A published page is the same for every visitor, so what it reads must be
 * judged as the anonymous visitor whatever is running when it renders. Two
 * ambient identities could otherwise reach the read: the API key of a request
 * in flight, which the caller scope carries, and a plugin's person, which the
 * principal scope carries. Field rules are handed the person, and the
 * visitor's grants are replaced by a person's empty ones, so a rule written
 * for that person could show a field no visitor may read. Both are cleared
 * here, in one place, for every read the public reader and the binding
 * schema make.
 *
 * @module runtime/routing/read-as-visitor
 */
import { runDetachedFromRequest } from "../../auth/caller-scope";
import { runAsPrincipal } from "../../auth/principal-scope";

export function readAsVisitor<T>(operation: () => T): T {
  // `null` is a frame of its own, so it clears a person an enclosing
  // operation was made as rather than inheriting it.
  return runDetachedFromRequest(() => runAsPrincipal(null, operation));
}
