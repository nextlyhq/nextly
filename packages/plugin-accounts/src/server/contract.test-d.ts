/**
 * The typed server functions' signatures, as a site's server code calls
 * them.
 *
 * A type test, because what it pins is only observable to the compiler: that
 * the functions take the visitor's cookies as input and never write one,
 * that a link's function takes its token and no session, and that the
 * service another plugin is handed is checked for every function it is
 * promised. The assertions are assignments the checker evaluates, so a
 * signature that drifts fails `tsc --noEmit` here rather than passing
 * quietly.
 *
 * @module server/contract.test-d
 */
import type { SignedInAccount } from "../flows/sessions";

import type {
  AccountCookieChange,
  AccountOutcome,
  AccountsServer,
  AccountVisitor,
} from "./contract";
import type { accountsServer, accountsServices } from "./installed";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const serverAnswers: Equal<
  Awaited<ReturnType<typeof accountsServer>>,
  AccountsServer
> = true;
const servicesAnswer: Equal<
  ReturnType<typeof accountsServices>,
  AccountsServer
> = true;

// What the caller writes after a function: a set with a value and an end,
// or a clear, and never the CSRF cookie.
const changes: Equal<AccountCookieChange["action"], "set" | "clear"> = true;
const cookies: Equal<
  AccountCookieChange["cookie"],
  "session" | "knownBrowsers" | "signUp"
> = true;
const outcome: Equal<
  AccountOutcome,
  {
    readonly message: string;
    readonly cookies: readonly AccountCookieChange[];
  }
> = true;

// A link's own function is found by its token alone, with no session.
const cancelTakes: Equal<
  Parameters<AccountsServer["cancelAddressChange"]>[0],
  { readonly token: string }
> = true;
const signInTakes: Equal<
  Parameters<AccountsServer["signIn"]>[0],
  { readonly visitor: AccountVisitor } & {
    readonly address: string;
    readonly password: string;
  }
> = true;
const currentAnswers: Equal<
  Awaited<ReturnType<AccountsServer["currentAccount"]>>,
  SignedInAccount | null
> = true;
const verifyAnswers: Equal<
  Awaited<ReturnType<AccountsServer["verifyAddress"]>>,
  AccountOutcome & { readonly signedIn: boolean }
> = true;

export const assertions: true[] = [
  serverAnswers,
  servicesAnswer,
  changes,
  cookies,
  outcome,
  cancelTakes,
  signInTakes,
  currentAnswers,
  verifyAnswers,
];
