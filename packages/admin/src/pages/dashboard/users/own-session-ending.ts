/**
 * Whether saving an edit to a user ends the signed-in user's own sessions.
 *
 * The server ends every session an account holds when an administrator sets
 * its password or deactivates it, in the same write. When the account being
 * edited is the signed-in one, that includes the session doing the editing:
 * its refresh token is gone, and the tab would fail silently once its access
 * token expired. The edit page signs the user out at once instead, saying why.
 */
import { USER_MESSAGES } from "@admin/constants/messages";

/**
 * The sign-out message when saving `updates` to `editedUserId` ends the
 * sessions of `signedInUserId`; null when it does not.
 */
export function ownSessionEndingMessage(args: {
  editedUserId: string;
  signedInUserId: string | undefined;
  updates: { password?: string; isActive?: boolean };
}): string | null {
  if (!args.signedInUserId || args.editedUserId !== args.signedInUserId) {
    return null;
  }
  if (args.updates.isActive === false) {
    return USER_MESSAGES.OWN_ACCOUNT_DEACTIVATED;
  }
  if (args.updates.password !== undefined) {
    return USER_MESSAGES.OWN_PASSWORD_CHANGED;
  }
  return null;
}
