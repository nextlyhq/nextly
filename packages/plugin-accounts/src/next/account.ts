import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { SignedInAccount } from "../flows/sessions";
import { accountsServer } from "../server/installed";

/**
 * The signed-in account, or null, for a server component, a route handler
 * or a server action: read from the request's session cookie on every call,
 * so a session ended anywhere is refused at once.
 *
 * @experimental
 */
export async function currentAccount(): Promise<SignedInAccount | null> {
  const server = await accountsServer();

  return server.currentAccount({
    visitor: server.visitorFrom(await headers()),
  });
}

/**
 * The signed-in account, or the visitor sent to the site's sign-in page,
 * which brings them back to `returnTo` once signed in. Next.js gives a
 * server component no way to read its own address, so the page names
 * itself; a `returnTo` that is not a path on the site's own origin is
 * dropped, never followed.
 *
 * @experimental
 */
export async function requireAccount(
  options: { returnTo?: string } = {}
): Promise<SignedInAccount> {
  const server = await accountsServer();
  const account = await server.currentAccount({
    visitor: server.visitorFrom(await headers()),
  });
  if (account === null) redirect(server.signInPath(options.returnTo));

  return account;
}
