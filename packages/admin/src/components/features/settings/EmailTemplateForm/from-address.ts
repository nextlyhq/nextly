/**
 * The one rule From has beyond parsing: only the name may use variables.
 *
 * The server renders a From override's display name and sends its address as
 * written, so it refuses a save whose address uses a variable
 * (`VARIABLE_ADDRESS`). Checked here as the author types, so the field says so
 * before a save is refused for it. The split mirrors the server's
 * `displayNameAndMailbox`: the address is what sits in the last `<...>`
 * outside quotes, or the whole value when there are no brackets.
 *
 * @module components/features/settings/EmailTemplateForm/from-address
 */

/** What the server says when a From address uses a variable. */
export const VARIABLE_ADDRESS_MESSAGE: string =
  "The From address can't use variables; only the name before it can, as in {{ shopName }} <shop@example.com>.";

function usesVariables(value: string): boolean {
  return value.includes("{{") || value.includes("{%");
}

/** `value` with each quoted string blanked, so a quoted `<` isn't a bracket. */
function unquoted(value: string): string {
  return value.replace(/"(?:[^"\\]|\\.)*"/g, match => " ".repeat(match.length));
}

/** The address part of a From value. */
export function fromMailbox(value: string): string {
  const trimmed = value.trim();
  const blanked = unquoted(trimmed);
  const open = blanked.lastIndexOf("<");
  if (open === -1 || !blanked.endsWith(">")) return trimmed;
  return trimmed.slice(open + 1, -1).trim();
}

/** Why the server would refuse this From value's address, or null. */
export function fromAddressProblem(value: string): string | null {
  return usesVariables(fromMailbox(value)) ? VARIABLE_ADDRESS_MESSAGE : null;
}
