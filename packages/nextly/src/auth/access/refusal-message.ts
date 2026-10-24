/**
 * What a refusal tells its caller about what was refused.
 *
 * @module auth/access/refusal-message
 */

/** Whether a refusal is about one entry, or about the collection as a whole. */
export type RefusalScope = "one" | "all";

/** The message a refusal of `action` on `resource` is answered with. */
export function refusalMessage(
  action: string,
  resource: string,
  _scope: RefusalScope = "all"
): string {
  return `You do not have permission to ${action} ${resource}`;
}
