/**
 * Whether an address typed into a written email can be saved: a link's
 * destination or an image's address, fixed or as a variable's fallback.
 *
 * Asked of the server's own rule, the one every save applies, so the editor
 * says while the person types exactly what the save would refuse.
 *
 * @module components/features/settings/EmailTemplateForm/written/addresses
 */
import {
  allowedUrl,
  type UrlKind,
} from "nextly/api/email-template-preview-types";

/** What an address is for: a link may also open a mail client. */
export type AddressKind = UrlKind;

/** Why `value` cannot be saved as a `kind` address, or null when it can. */
export function addressProblem(
  value: string,
  kind: AddressKind
): string | null {
  if (allowedUrl(value, kind)) return null;
  return kind === "link"
    ? "Use a complete https, http or mailto address."
    : "Use a complete https or http image address.";
}
