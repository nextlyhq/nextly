import { DAY, type FlowDeps } from "../flows/deps";
import type { AccountOutcome, AccountsServer } from "../server/contract";
import {
  callWithFields,
  type AccountAction,
  type FieldOutcome,
  type FieldReader,
} from "../server/fields";
import { accountsService } from "../server/service";

import { answer, bodyOf, field } from "./answers";
import { cookieName, readCookie, serializeCookie, setCookie } from "./cookies";
import { assertSameSiteWrite } from "./guard";

/** An endpoint: the flows' deps and the request in, the answer out; a refusal is thrown. */
export type Endpoint = (deps: FlowDeps, request: Request) => Promise<Response>;

/**
 * What every write reads, once the guard passes: its body, the server
 * functions, and the visitor they act for.
 */
async function write(deps: FlowDeps, request: Request) {
  assertSameSiteWrite(request, deps.settings, deps.core);
  const server = accountsService(() => deps);

  return {
    body: await bodyOf(request),
    server,
    visitor: server.visitorFrom(request),
  };
}

/** A server function's outcome as the endpoint's answer, its cookie changes as `Set-Cookie` headers. */
function reply(
  server: AccountsServer,
  outcome: AccountOutcome,
  result: Record<string, unknown> = {}
): Response {
  return answer(
    outcome.message,
    result,
    outcome.cookies.map(change => serializeCookie(server.cookieWrite(change)))
  );
}

/** Gives a browser the plugin's CSRF token, keeping the one it holds; never cached, and readable by no other site. */
export const csrf: Endpoint = (deps, request) => {
  const held = readCookie(request, cookieName(deps.settings, "csrf"));
  const token = held ?? deps.core.opaque.create().secret;
  const now = deps.now();

  return Promise.resolve(
    answer("CSRF token.", { csrfToken: token }, [
      setCookie(
        deps.settings,
        "csrf",
        token,
        new Date(now.getTime() + DAY),
        now
      ),
    ])
  );
};

/**
 * A write endpoint for one action: its server function called with the
 * body's fields, answered with the function's message and cookies, and with
 * what `extra` adds to the answer.
 */
function endpoint(
  action: AccountAction,
  extra?: (
    outcome: FieldOutcome,
    read: FieldReader,
    server: AccountsServer
  ) => Record<string, unknown>
): Endpoint {
  return async (deps, request) => {
    const { body, server, visitor } = await write(deps, request);
    const read: FieldReader = name => field(body, name);
    const outcome = await callWithFields(action, server, visitor, read);

    return reply(server, outcome, extra?.(outcome, read, server));
  };
}

export const signUpEndpoint: Endpoint = endpoint("signUp");

/** Verifies by link or by code, and says whether it signed the visitor in. */
export const verifyEndpoint: Endpoint = endpoint("verifyAddress", outcome => ({
  signedIn: outcome.signedIn === true,
}));

export const resendEndpoint: Endpoint = endpoint("resendVerification");

export const notMeEndpoint: Endpoint = endpoint("removeUnverifiedAccount");

/** Signs in, and says where to go next: a path on the site only. */
export const signInEndpoint: Endpoint = endpoint(
  "signIn",
  (_outcome, read, server) => ({
    redirectTo: server.returnPath(read("next") || undefined),
  })
);

export const signOutEndpoint: Endpoint = endpoint("signOut");

export const signOutEverywhereEndpoint: Endpoint =
  endpoint("signOutEverywhere");

export const resetRequestEndpoint: Endpoint = endpoint("requestPasswordReset");

export const resetEndpoint: Endpoint = endpoint("resetPassword");

export const changePasswordEndpoint: Endpoint = endpoint("changePassword");

export const changeAddressEndpoint: Endpoint = endpoint("changeAddress");

export const confirmAddressEndpoint: Endpoint = endpoint(
  "confirmAddressChange"
);

export const cancelAddressEndpoint: Endpoint = endpoint("cancelAddressChange");

export const deleteAccountEndpoint: Endpoint = endpoint("deleteAccount");

/** The signed-in account, or null; never cached. */
export const meEndpoint: Endpoint = async (deps, request) => {
  const server = accountsService(() => deps);
  const account = await server.currentAccount({
    visitor: server.visitorFrom(request),
  });

  return answer("The signed-in account.", { account });
};
