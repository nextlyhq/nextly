/**
 * Access control: always allow.
 *
 * Required as a function (not a literal `true` boolean) because Nextly's
 * runtime collection-config validator rejects boolean values on the
 * `access.read` / `access.create` etc. fields - despite the TypeScript
 * type (`AccessControlFunction | boolean`) accepting them. Using a named
 * function also makes the public-read intent grep-able.
 */
import type { AccessControlFunction } from "@revnixhq/nextly";

export const anyone: AccessControlFunction = () => true;
