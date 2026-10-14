import type { AccountsEmail, AccountsMail } from "../flows/mail";

/** The plugin's mail, kept in memory: every email a flow queued, in order. */
export class FakeAccountsMail implements AccountsMail {
  readonly queued: AccountsEmail[] = [];

  queue(email: AccountsEmail): Promise<void> {
    this.queued.push(email);
    return Promise.resolve();
  }

  /** The emails of one kind, typed by it. */
  ofKind<K extends AccountsEmail["kind"]>(
    kind: K
  ): Extract<AccountsEmail, { kind: K }>[] {
    return this.queued.filter(
      (email): email is Extract<AccountsEmail, { kind: K }> =>
        email.kind === kind
    );
  }
}
