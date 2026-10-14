/**
 * Making the `Principal` core hands out, and telling one apart from a copy.
 *
 * A person is who an access rule, a hook and a Direct API call act for, so a
 * value that only LOOKS like one must not pass for it: plugin or app code that
 * builds `{ type: "principal", kind, id }` by hand would otherwise act as
 * anyone it can name. Core remembers each person it made, by identity, and
 * accepts only those.
 *
 * @module plugins/principals/principal
 */
import type { Principal, PrincipalAttributes } from "./types";

/**
 * Every person core made, held weakly so a request's person is collected with
 * the request. A set keyed by identity rather than a symbol on the object: a
 * symbol can be copied onto a hand-built value, and identity cannot.
 */
const madeByCore = new WeakSet<object>();

/**
 * A person of `kind`, frozen, so nothing downstream can change who it names
 * after core recognised them.
 */
export function makePrincipal<A extends PrincipalAttributes>(
  kind: string,
  id: string,
  attributes: A
): Principal<A> {
  const principal: Principal<A> = Object.freeze({
    type: "principal" as const,
    kind,
    id,
    attributes: Object.freeze({ ...attributes }),
  });
  madeByCore.add(principal);
  return principal;
}

/** Whether `value` is a person core made, rather than one built by hand. */
export function isCorePrincipal(value: unknown): value is Principal {
  return typeof value === "object" && value !== null && madeByCore.has(value);
}
