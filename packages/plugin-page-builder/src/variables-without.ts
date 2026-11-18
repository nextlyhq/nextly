/**
 * A stored tokens section without some variables: the one reading the remove
 * routes write by, and the editor records a clean-up's step by, so the two
 * halves of that step are what the route stored.
 *
 * @module variables-without
 */
import { storedVariableIdentity } from "./site-style-storage";

/**
 * The section without the entries whose identity is among `gone`, and with
 * their places in the colour order, as the panel's own removal leaves it: a
 * later colour given a removed one's free name is not listed where it was.
 */
export function withoutVariables(
  section: Record<string, unknown>,
  gone: ReadonlySet<string>
): Record<string, unknown> {
  const entries = Array.isArray(section.tokens) ? section.tokens : [];
  // Each entry judged on its own by the token rules, so one they cannot read
  // is kept exactly as stored rather than dropped by a removal of another.
  return {
    ...section,
    tokens: entries.filter(entry => {
      const id = storedVariableIdentity(entry);
      return id === undefined || !gone.has(id);
    }),
    ...(Array.isArray(section.order)
      ? {
          order: section.order.filter(
            (id: unknown) => typeof id !== "string" || !gone.has(id)
          ),
        }
      : {}),
  };
}
