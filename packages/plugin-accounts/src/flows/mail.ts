/**
 * The emails the accounts plugin sends, as the flows ask for them. A flow
 * queues an email rather than sending it, so the time an answer takes never
 * depends on a mail server, and a free address and a taken one answer alike.
 */
export type AccountsEmail =
  | {
      /** A new account's verification: a link, a code to type, and a link to remove it. */
      kind: "verify-address";
      accountId: string;
      to: string;
      name: string;
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
    };

export interface AccountsMail {
  queue(email: AccountsEmail): Promise<void>;
}
