import type { FormNotification } from "../../../types";
import { parseFieldRef } from "../../../utils/field-references";

/**
 * Deliberately loose email shape check (something@something.tld): the goal is
 * catching typos before they fail at delivery, not RFC 5322 conformance.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

// Re-exported rather than re-implemented. Whether a value is a field reference
// is the SEND path's question — a value the editor treats as one and delivery
// does not goes out with its braces intact — so both read the same parser.
export { parseFieldRef };

/** The address fields a notification can get wrong. */
export type AddressField = "senderEmail" | "to" | "replyTo";

export type AddressErrors = Partial<Record<AddressField, string>>;

const MESSAGE = "Enter a valid email address.";

/**
 * Whether ONE address is unusable, by the single rule the whole feature uses.
 *
 * A blank address is not an error — every one of these is optional or has an
 * inherited default — and a `{{field}}` reference is not an address at all: it
 * resolves against each submission at send time, so it cannot be checked now.
 */
export function addressError(
  field: AddressField,
  value: string | undefined
): string | undefined {
  if (field === "replyTo" && parseFieldRef(value) !== null) return undefined;
  if (!value?.trim()) return undefined;
  return isValidEmail(value) ? undefined : MESSAGE;
}

/**
 * Every unusable address in a notification.
 *
 * The editor asks this about one field as it is left; the page asks it about
 * every rule before it saves. The same function answers both, because the
 * alternative is a field that rejects an address and a save that accepts it —
 * which is what happened while the editor held the only copy of the answer.
 *
 * `to` is checked only when the recipient is a literal address: a `field`
 * recipient names a form field, which is not an address to validate.
 */
export function addressErrorsIn(notification: FormNotification): AddressErrors {
  const errors: AddressErrors = {};

  const sender = addressError("senderEmail", notification.senderEmail);
  if (sender) errors.senderEmail = sender;

  if (notification.recipientType === "static") {
    const to = addressError("to", notification.to);
    if (to) errors.to = to;
  }

  const replyTo = addressError("replyTo", notification.replyTo);
  if (replyTo) errors.replyTo = replyTo;

  return errors;
}

/** The rules a save must refuse, named so the message can say which. */
export function notificationsWithBadAddresses(
  notifications: readonly FormNotification[]
): string[] {
  return notifications
    .filter(n => Object.keys(addressErrorsIn(n)).length > 0)
    .map(n => n.name.trim() || "Untitled notification");
}

/**
 * What to tell an author who pressed Save with a malformed address, or `null`
 * when there is nothing to tell them.
 *
 * The wording lives beside the rule that produces it so the caller has one
 * question to ask and one branch to write — a save path that composed this
 * itself would be a second place deciding what counts as wrong.
 */
export function badAddressMessage(
  notifications: readonly FormNotification[]
): string | null {
  const names = notificationsWithBadAddresses(notifications);
  if (names.length === 0) return null;
  return names.length === 1
    ? `${names[0]} has an invalid email address`
    : `${names.length} notifications have invalid email addresses`;
}

/**
 * The one reason a save must refuse the notifications, or `null`.
 *
 * A single question so the save has a single branch. Naming comes first: an
 * address complaint that says "Untitled notification" twice cannot be acted on,
 * whereas a named rule can then be pointed at.
 */
export function notificationsBlockingSave(
  notifications: readonly FormNotification[]
): string | null {
  const unnamed = unnamedNotificationCount(notifications);
  if (unnamed > 0) {
    return unnamed === 1
      ? "A notification needs a name"
      : `${unnamed} notifications need a name`;
  }
  return badAddressMessage(notifications);
}

/**
 * Rules a save must refuse for having no name.
 *
 * The sheet this editor replaced disabled its own commit while the name was
 * blank. There is no commit here any more — the page's action bar is the only
 * one — so the precondition moves to it rather than disappearing with the
 * button that used to carry it. A nameless rule leaves its summary and its
 * menu labelled with nothing.
 */
export function unnamedNotificationCount(
  notifications: readonly FormNotification[]
): number {
  return notifications.filter(n => !n.name.trim()).length;
}
