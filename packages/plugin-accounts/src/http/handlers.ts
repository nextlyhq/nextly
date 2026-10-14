import { DAY, type FlowDeps } from "../flows/deps";
import type { AccountOutcome, AccountsServer } from "../server/contract";
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

export const signUpEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.signUp({
      visitor,
      name: field(body, "name"),
      address: field(body, "address"),
      password: field(body, "password"),
    })
  );
};

/**
 * Verifies by link (`token`) or by code (`address`, `code`); with `password`,
 * in a browser other than the one that signed up. A session it starts is
 * set as the session cookie, and the sign-up cookie goes.
 */
export const verifyEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);
  const token = field(body, "token");
  const password = field(body, "password");
  const outcome = await server.verifyAddress(
    token !== ""
      ? { visitor, password, token }
      : {
          visitor,
          password,
          address: field(body, "address"),
          code: field(body, "code"),
        }
  );

  return reply(server, outcome, { signedIn: outcome.signedIn });
};

export const resendEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.resendVerification({
      visitor,
      address: field(body, "address"),
    })
  );
};

export const notMeEndpoint: Endpoint = async (deps, request) => {
  const { body, server } = await write(deps, request);

  return reply(
    server,
    await server.removeUnverifiedAccount({ token: field(body, "token") })
  );
};

/** Signs in, setting the session and known-browser cookies, and says where to go next: a path on the site only. */
export const signInEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);
  const outcome = await server.signIn({
    visitor,
    address: field(body, "address"),
    password: field(body, "password"),
  });

  return reply(server, outcome, {
    redirectTo: server.returnPath(field(body, "next") || undefined),
  });
};

export const signOutEndpoint: Endpoint = async (deps, request) => {
  const { server, visitor } = await write(deps, request);

  return reply(server, await server.signOut({ visitor }));
};

export const signOutEverywhereEndpoint: Endpoint = async (deps, request) => {
  const { server, visitor } = await write(deps, request);

  return reply(server, await server.signOutEverywhere({ visitor }));
};

export const resetRequestEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.requestPasswordReset({
      visitor,
      address: field(body, "address"),
    })
  );
};

export const resetEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.resetPassword({
      visitor,
      token: field(body, "token"),
      password: field(body, "password"),
    })
  );
};

export const changePasswordEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.changePassword({
      visitor,
      currentPassword: field(body, "currentPassword"),
      newPassword: field(body, "newPassword"),
    })
  );
};

export const changeAddressEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.changeAddress({
      visitor,
      currentPassword: field(body, "currentPassword"),
      newAddress: field(body, "newAddress"),
    })
  );
};

/** Confirms an address change by its link (`token`) or its code, inside the session that asked. */
export const confirmAddressEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);
  const token = field(body, "token");

  return reply(
    server,
    await server.confirmAddressChange(
      token !== "" ? { visitor, token } : { visitor, code: field(body, "code") }
    )
  );
};

export const cancelAddressEndpoint: Endpoint = async (deps, request) => {
  const { body, server } = await write(deps, request);

  return reply(
    server,
    await server.cancelAddressChange({ token: field(body, "token") })
  );
};

export const deleteAccountEndpoint: Endpoint = async (deps, request) => {
  const { body, server, visitor } = await write(deps, request);

  return reply(
    server,
    await server.deleteAccount({
      visitor,
      currentPassword: field(body, "currentPassword"),
    })
  );
};

/** The signed-in account, or null; never cached. */
export const meEndpoint: Endpoint = async (deps, request) => {
  const server = accountsService(() => deps);
  const account = await server.currentAccount({
    visitor: server.visitorFrom(request),
  });

  return answer("The signed-in account.", { account });
};
