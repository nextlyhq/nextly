/**
 * Access control: any logged-in user, regardless of role.
 *
 * Returns `true` whenever the caller has an authenticated session.
 * Used for Posts.create (any author+ can draft) and other places where
 * authorship or content edits are gated behind login but not role.
 */
import type { AccessControlFunction } from "@revnixhq/nextly";

export const authenticated: AccessControlFunction = ({ user }) => Boolean(user);
