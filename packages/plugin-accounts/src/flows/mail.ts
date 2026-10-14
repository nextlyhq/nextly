import type { FlowDeps } from "./deps";

/**
 * The emails the accounts plugin sends, as the flows ask for them. A flow
 * queues an email rather than sending it, so the time an answer takes never
 * depends on a mail server, and a free address and a taken one answer alike.
 */
export type AccountsEmail =
  | {
      /**
       * A new account's verification: a link, a code to type, and a link to
       * remove it. The address is not verified yet, so it carries nothing a
       * visitor typed, not even the name: anyone may sign up with any address.
       */
      kind: "verify-address";
      accountId: string;
      to: string;
      link: string;
      code: string;
      notMeLink: string;
    }
  | {
      /** A sign-up named an address that already has an account. */
      kind: "sign-up-taken";
      accountId: string;
      to: string;
      /** A deactivated account is told to contact the site instead. */
      deactivated: boolean;
      signInLink: string;
      resetLink: string;
    }
  | {
      /** A reset link, asked for by someone who named the address. */
      kind: "reset-password";
      accountId: string;
      to: string;
      link: string;
    }
  | {
      /** Too many wrong passwords in a row: only a reset, or a known browser, signs it in now. */
      kind: "reset-required";
      accountId: string;
      to: string;
      link: string;
    }
  | {
      /** To the old address: a change of address was asked for, with a link that cancels it. */
      kind: "address-change-asked";
      accountId: string;
      to: string;
      newAddress: string;
      cancelLink: string;
    }
  | {
      /** To a free new address: its link and code, which confirm the change inside the holder's session. */
      kind: "confirm-new-address";
      accountId: string;
      to: string;
      link: string;
      code: string;
    }
  | {
      /** To a new address that is another account's: someone tried to use it. */
      kind: "address-in-use";
      accountId: string;
      to: string;
    }
  | {
      /** To the old address: the account's address changed. */
      kind: "address-changed";
      accountId: string;
      to: string;
      newAddress: string;
    }
  | {
      /** The holder deleted the account. */
      kind: "account-deleted";
      accountId: string;
      to: string;
    }
  | {
      /** The account's password changed, by a reset or by its holder. */
      kind: "password-changed";
      accountId: string;
      to: string;
    };

export interface AccountsMail {
  queue(email: AccountsEmail): Promise<void>;
}

/**
 * Queues the email that tells an account's holder of a change that has
 * already committed: a deleted account, a changed password or address. The
 * change stands whether or not the email goes, so a queue that does not
 * answer is logged for operators and never turned into a failure of what
 * was done: a holder whose account is gone could not even retry.
 */
export async function queueNotice(
  deps: Pick<FlowDeps, "mail" | "logger">,
  email: AccountsEmail
): Promise<void> {
  try {
    await deps.mail.queue(email);
  } catch (error) {
    deps.logger.warn(
      "[accounts] the notice of a committed change was not queued",
      {
        kind: email.kind,
        accountId: email.accountId,
        cause: error instanceof Error ? error.message : String(error),
      }
    );
  }
}
