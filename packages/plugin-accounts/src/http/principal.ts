import type {
  PrincipalKindDefinition,
  PrincipalRecord,
} from "@nextlyhq/plugin-sdk";

import type { FlowDeps } from "../flows/deps";
import { sessionAccount } from "../flows/sessions";
import { accountById } from "../storage/accounts";

import { cookieName, readCookie } from "./cookies";

/** What core is told about a signed-in account: whether its address is verified. */
type AccountAttributes = { verified: boolean };

/** The kind's name; core makes it `<plugin>:account`. */
export const ACCOUNT_KIND = "account";

/**
 * The plugin's kind of signed-in person, as core asks for it wherever a
 * route or server code names it: the account the request's session cookie
 * names, or nobody. `deps` is read per request, so it always reaches the
 * started plugin.
 */
export function accountKind(
  deps: () => FlowDeps
): PrincipalKindDefinition<AccountAttributes> {
  return {
    name: ACCOUNT_KIND,
    attributes: { verified: "boolean" },
    async resolve(request) {
      const flow = deps();
      const sessionToken = readCookie(
        request,
        cookieName(flow.settings, "session")
      );
      if (sessionToken === undefined) return null;
      const account = await sessionAccount(flow, { sessionToken });

      return account === null ? null : record(account.id, account.verified);
    },
    async lookup(id) {
      const account = await accountById(deps().db, id);

      return account === null || account.deactivatedAt !== null
        ? null
        : record(account.id, account.verifiedAt !== null);
    },
  };
}

function record(
  id: string,
  verified: boolean
): PrincipalRecord<AccountAttributes> {
  return { id, attributes: { verified } };
}
