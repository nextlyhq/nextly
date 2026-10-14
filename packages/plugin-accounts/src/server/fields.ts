import type {
  AccountOutcome,
  AccountsServer,
  AccountVisitor,
} from "./contract";
import type { ACCOUNT_MESSAGES } from "./service";

/** An action a visitor takes on their account, by its server function's name. */
export type AccountAction = keyof typeof ACCOUNT_MESSAGES;

/**
 * One named field of what a visitor sent, as a string: a REST body's or a
 * form's. Absent, or not text, reads as the empty string, which every flow
 * refuses where it needs a value.
 */
export type FieldReader = (name: string) => string;

/** What an action answers, with whether it signed the visitor in where it can. */
export type FieldOutcome = AccountOutcome & { readonly signedIn?: boolean };

type FieldCall = (
  server: AccountsServer,
  visitor: AccountVisitor,
  read: FieldReader
) => Promise<FieldOutcome>;

/**
 * Each action's server function, called with the fields a visitor sent. A
 * REST body and a form name the fields alike, so the two entry points read
 * them here, once.
 */
const FIELD_CALLS: Record<AccountAction, FieldCall> = {
  signUp: (server, visitor, read) =>
    server.signUp({
      visitor,
      name: read("name"),
      address: read("address"),
      password: read("password"),
    }),
  // By link (`token`) or by code (`address`, `code`); with `password`, in a
  // browser other than the one that signed up.
  verifyAddress: (server, visitor, read) => {
    const token = read("token");
    const password = read("password");
    return server.verifyAddress(
      token !== ""
        ? { visitor, password, token }
        : { visitor, password, address: read("address"), code: read("code") }
    );
  },
  resendVerification: (server, visitor, read) =>
    server.resendVerification({ visitor, address: read("address") }),
  removeUnverifiedAccount: (server, _visitor, read) =>
    server.removeUnverifiedAccount({ token: read("token") }),
  signIn: (server, visitor, read) =>
    server.signIn({
      visitor,
      address: read("address"),
      password: read("password"),
    }),
  signOut: (server, visitor) => server.signOut({ visitor }),
  signOutEverywhere: (server, visitor) => server.signOutEverywhere({ visitor }),
  requestPasswordReset: (server, visitor, read) =>
    server.requestPasswordReset({ visitor, address: read("address") }),
  resetPassword: (server, visitor, read) =>
    server.resetPassword({
      visitor,
      token: read("token"),
      password: read("password"),
    }),
  changePassword: (server, visitor, read) =>
    server.changePassword({
      visitor,
      currentPassword: read("currentPassword"),
      newPassword: read("newPassword"),
    }),
  changeAddress: (server, visitor, read) =>
    server.changeAddress({
      visitor,
      currentPassword: read("currentPassword"),
      newAddress: read("newAddress"),
    }),
  // By link (`token`) or by its code, inside the session that asked.
  confirmAddressChange: (server, visitor, read) => {
    const token = read("token");
    return server.confirmAddressChange(
      token !== "" ? { visitor, token } : { visitor, code: read("code") }
    );
  },
  cancelAddressChange: (server, _visitor, read) =>
    server.cancelAddressChange({ token: read("token") }),
  deleteAccount: (server, visitor, read) =>
    server.deleteAccount({
      visitor,
      currentPassword: read("currentPassword"),
    }),
};

/** Runs `action`'s server function with the fields a visitor sent. */
export function callWithFields(
  action: AccountAction,
  server: AccountsServer,
  visitor: AccountVisitor,
  read: FieldReader
): Promise<FieldOutcome> {
  return FIELD_CALLS[action](server, visitor, read);
}
