/**
 * Whether an address typed into a written email can be saved: a link's
 * destination or an image's address, fixed or as a variable's fallback.
 *
 * The server checks the same on every save and refuses the rest; this says so
 * while the person is still typing, rather than at the save.
 *
 * @module components/features/settings/EmailTemplateForm/written/addresses
 */

/** What an address is for: a link may also open a mail client. */
export type AddressKind = "link" | "image";

/** The scheme, then a host straight after the slashes. */
const WEB = /^https?:\/\/[^\s/?#]/i;
/** The scheme, then a recipient. */
const MAIL = /^mailto:[^\s?]/i;

function parses(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Why `value` cannot be saved as a `kind` address, or null when it can. */
export function addressProblem(
  value: string,
  kind: AddressKind
): string | null {
  const url = value.trim();
  if (WEB.test(url) && parses(url)) return null;
  if (kind === "link" && MAIL.test(url) && parses(url)) return null;
  return kind === "link"
    ? "Use a complete https, http or mailto address."
    : "Use a complete https or http image address.";
}
