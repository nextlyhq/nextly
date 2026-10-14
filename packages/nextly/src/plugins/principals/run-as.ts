/**
 * The checks a call made as a plugin-defined person passes before it runs.
 *
 * A person is always under access rules, and is never staff or an API key at
 * the same time. Each of these is refused rather than resolved one way or the
 * other: a call that asks to skip the rules as a person, or that names both a
 * person and a staff user, says two things at once, and either guess acts for
 * someone with reach the caller did not mean to give them.
 *
 * @module plugins/principals/run-as
 */
import { NextlyError } from "../../errors/nextly-error";

import { isCorePrincipal } from "./principal";
import type { Principal } from "./types";

/** What a call carries beside the person, as each entry point names it. */
export interface PersonCallOptions {
  /** A staff user, as the Direct API and the services take one. */
  user?: unknown;
  /** The staff user whose field rules decide, on the Direct API. */
  fieldAccessUser?: unknown;
  /** An API key's scope: the Direct API's `actor`. */
  actor?: unknown;
  /** An API key's scope, as a plugin service call takes one. */
  authenticatedScope?: unknown;
  /** The caller's OWN `overrideAccess`, not a default filled in for it. */
  overrideAccess?: boolean;
  /** A bounded override, which skips the rules for related collections. */
  trusted?: unknown;
  /** Who a plugin service call runs as: `user`, `system` or `public`. */
  as?: unknown;
  /**
   * The Direct API's word that a `where` was built by the framework, which
   * exempts it from the filterable-field check a caller's own `where` gets.
   */
  frameworkFilter?: unknown;
}

function refusal(message: string): NextlyError {
  return NextlyError.invalidInput({
    message,
    logContext: { reason: "principal-call-refused" },
  });
}

/**
 * Refuse a call made as `principal` unless it can run as that person: one
 * core made, under access rules, naming no staff user and no API key.
 * Throws before anything runs.
 */
export function assertRunnableAsPrincipal(
  principal: unknown,
  options: PersonCallOptions
): asserts principal is Principal {
  if (!isCorePrincipal(principal)) {
    throw refusal(
      "A call made as a signed-in person must name a person core made, from fromRequest or byId; anything else, a person built by hand or null included, is refused."
    );
  }
  if (options.overrideAccess === true || options.trusted !== undefined) {
    throw refusal(
      "A call made as a signed-in person always applies access rules; it cannot also skip them with overrideAccess or trusted."
    );
  }
  if (options.user !== undefined || options.fieldAccessUser !== undefined) {
    throw refusal(
      "A call made as a signed-in person cannot also name a staff user."
    );
  }
  if (options.actor !== undefined || options.authenticatedScope !== undefined) {
    throw refusal(
      "A call made as a signed-in person cannot also name an API key."
    );
  }
  // `system` skips the rules and `user` is staff, both refused above in
  // other words; `public` is nobody. A call made as a person is made as the
  // person, and naming anything else as well says two things at once.
  if (options.as !== undefined) {
    throw refusal(
      "A call made as a signed-in person cannot also set as: it is made as the person."
    );
  }
  // A person's `where` is the person's own, so it is held to the fields the
  // person may read: exempted, a filter on a field their rules withhold would
  // answer, row by row or as a count, what that field holds.
  if (options.frameworkFilter !== undefined) {
    throw refusal(
      "A call made as a signed-in person cannot set frameworkFilter: its where is checked like any caller's."
    );
  }
}
