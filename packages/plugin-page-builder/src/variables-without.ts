/**
 * A stored tokens section without some variables: the one reading the remove
 * routes write by, and the editor records a clean-up's step by, so the two
 * halves of that step are what the route stored.
 *
 * @module variables-without
 */
import type { VariableTaken } from "./library-contract";
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

/**
 * What {@link withoutVariables} takes out of `section` for `gone`: each entry
 * as stored, with its place in the list and in the colour order, so it can
 * be put back exactly where it was.
 */
export function takenFrom(
  section: Record<string, unknown>,
  gone: ReadonlySet<string>
): VariableTaken[] {
  const entries: unknown[] = Array.isArray(section.tokens)
    ? section.tokens
    : [];
  const order: unknown[] = Array.isArray(section.order) ? section.order : [];
  return entries.flatMap((entry, at) => {
    const id = storedVariableIdentity(entry);
    if (id === undefined || !gone.has(id)) return [];
    const orderAt = order.indexOf(id);
    return [{ id, entry, at, orderAt: orderAt === -1 ? null : orderAt }];
  });
}

/**
 * The section with what removals took put back where it was, the latest
 * removal first, so removals made one after another undo exactly. A
 * variable the section holds again is left as it is.
 */
export function withTakenBack(
  section: Record<string, unknown>,
  taken: readonly VariableTaken[]
): Record<string, unknown> {
  const tokens: unknown[] = Array.isArray(section.tokens)
    ? [...section.tokens]
    : [];
  const order: unknown[] | undefined = Array.isArray(section.order)
    ? [...section.order]
    : undefined;
  for (const back of [...taken].reverse()) {
    if (tokens.some(entry => storedVariableIdentity(entry) === back.id)) {
      continue;
    }
    tokens.splice(Math.min(back.at, tokens.length), 0, back.entry);
    if (order !== undefined && back.orderAt !== null) {
      order.splice(Math.min(back.orderAt, order.length), 0, back.id);
    }
  }
  return { ...section, tokens, ...(order === undefined ? {} : { order }) };
}
