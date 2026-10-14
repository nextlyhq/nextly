import {
  confirmAddressChangeByCode,
  confirmAddressChangeByLink,
  cancelAddressChange,
  requestAddressChange,
} from "../flows/address-change";
import { changePassword } from "../flows/change-password";
import { deleteOwnAccount } from "../flows/delete-account";
import { DAY, type FlowDeps } from "../flows/deps";
import { removeUnverifiedAccount } from "../flows/not-me";
import { resendVerification } from "../flows/resend";
import { completePasswordReset } from "../flows/reset";
import { requestPasswordReset } from "../flows/reset-request";
import { sessionAccount, signOut, signOutEverywhere } from "../flows/sessions";
import { signIn } from "../flows/sign-in";
import { signUp } from "../flows/sign-up";
import {
  verifyByCode,
  verifyByCodeWithPassword,
  verifyByLink,
  verifyByLinkWithPassword,
} from "../flows/verify";

import { answer, bodyOf, field, refuse, unlessRefused } from "./answers";
import {
  clearCookie,
  cookieName,
  knownTokensOf,
  readCookie,
  setCookie,
  withKnownToken,
} from "./cookies";
import { assertSameSiteWrite, safeReturnPath } from "./guard";

/** An endpoint: the flows' deps and the request in, the answer out; a refusal is thrown. */
export type Endpoint = (deps: FlowDeps, request: Request) => Promise<Response>;

/** What every write reads: the guard passed, its body, its client, its cookies. */
async function write(deps: FlowDeps, request: Request) {
  assertSameSiteWrite(request, deps.settings, deps.core);
  return {
    body: await bodyOf(request),
    client: deps.core.limits.clientKey(request),
    knownTokens: knownTokensOf(deps.settings, request),
    sessionToken:
      readCookie(request, cookieName(deps.settings, "session")) ?? "",
    signUpToken: readCookie(request, cookieName(deps.settings, "signUp")),
  };
}

/** The cookie that marks this browser known, with `token` added as the newest. */
function knownCookie(
  deps: FlowDeps,
  held: readonly string[],
  token: string
): string {
  const now = deps.now();
  return setCookie(
    deps.settings,
    "knownBrowsers",
    withKnownToken(held, token),
    new Date(now.getTime() + deps.settings.knownBrowsers.days * DAY),
    now
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
  const { body, client, signUpToken } = await write(deps, request);
  const result = unlessRefused(
    await signUp(deps, {
      name: field(body, "name"),
      address: field(body, "address"),
      password: field(body, "password"),
      client,
      ...(signUpToken === undefined ? {} : { browserToken: signUpToken }),
    })
  );

  return answer("Check your email to confirm your address.", {}, [
    setCookie(
      deps.settings,
      "signUp",
      result.browserToken,
      result.browserTokenExpiresAt,
      deps.now()
    ),
  ]);
};

/**
 * Verifies by link (`token`) or by code (`address`, `code`); with `password`,
 * in a browser other than the one that signed up. A session it starts is
 * set as the session cookie, and the sign-up cookie goes.
 */
export const verifyEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens, signUpToken } = await write(deps, request);
  const password = field(body, "password");
  const token = field(body, "token");
  const browser =
    signUpToken === undefined ? {} : { browserToken: signUpToken };
  const raw =
    token !== ""
      ? password !== ""
        ? await verifyByLinkWithPassword(deps, {
            token,
            password,
            client,
            knownTokens,
          })
        : await verifyByLink(deps, { token, ...browser })
      : password !== ""
        ? await verifyByCodeWithPassword(deps, {
            address: field(body, "address"),
            code: field(body, "code"),
            password,
            client,
            knownTokens,
          })
        : await verifyByCode(deps, {
            address: field(body, "address"),
            code: field(body, "code"),
            ...browser,
          });
  const result = unlessRefused(raw);
  if (result.status === "sign-in-needed")
    refuse({ status: "refused", reason: "sign-in-needed" });

  const cookies = [clearCookie(deps.settings, "signUp")];
  if (result.session !== null) {
    cookies.push(
      setCookie(
        deps.settings,
        "session",
        result.session.token,
        result.session.expiresAt,
        deps.now()
      )
    );
  }

  return answer(
    "Your address is confirmed.",
    { signedIn: result.session !== null },
    cookies
  );
};

export const resendEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens } = await write(deps, request);
  unlessRefused(
    await resendVerification(deps, {
      address: field(body, "address"),
      client,
      knownTokens,
    })
  );

  return answer(
    "If that address needs confirming, we've sent the email again.",
    {}
  );
};

export const notMeEndpoint: Endpoint = async (deps, request) => {
  const { body } = await write(deps, request);
  unlessRefused(
    await removeUnverifiedAccount(deps, { token: field(body, "token") })
  );

  return answer("The account was removed.", {});
};

/** Signs in, setting the session and known-browser cookies, and says where to go next: a path on the site only. */
export const signInEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens } = await write(deps, request);
  const result = unlessRefused(
    await signIn(deps, {
      address: field(body, "address"),
      password: field(body, "password"),
      client,
      knownTokens,
    })
  );

  return answer(
    "Signed in.",
    {
      redirectTo: safeReturnPath(
        deps.settings,
        field(body, "next") || undefined
      ),
    },
    [
      setCookie(
        deps.settings,
        "session",
        result.session.token,
        result.session.expiresAt,
        deps.now()
      ),
      knownCookie(deps, knownTokens, result.knownBrowserToken),
    ]
  );
};

export const signOutEndpoint: Endpoint = async (deps, request) => {
  const { sessionToken } = await write(deps, request);
  if (sessionToken !== "") await signOut(deps, { sessionToken });

  return answer("Signed out.", {}, [clearCookie(deps.settings, "session")]);
};

export const signOutEverywhereEndpoint: Endpoint = async (deps, request) => {
  const { sessionToken } = await write(deps, request);
  if (!(await signOutEverywhere(deps, { sessionToken })))
    refuse({ status: "refused", reason: "sign-in-needed" });

  return answer("Signed out everywhere.", {}, [
    clearCookie(deps.settings, "session"),
  ]);
};

export const resetRequestEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens } = await write(deps, request);
  unlessRefused(
    await requestPasswordReset(deps, {
      address: field(body, "address"),
      client,
      knownTokens,
    })
  );

  return answer(
    "If that address has an account, we've sent a link to reset its password.",
    {}
  );
};

export const resetEndpoint: Endpoint = async (deps, request) => {
  const { body, knownTokens } = await write(deps, request);
  const result = unlessRefused(
    await completePasswordReset(deps, {
      token: field(body, "token"),
      password: field(body, "password"),
      knownTokens,
    })
  );

  return answer("Your password is changed. Sign in with it.", {}, [
    knownCookie(deps, knownTokens, result.knownBrowserToken),
  ]);
};

export const changePasswordEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens, sessionToken } = await write(
    deps,
    request
  );
  const result = await changePassword(deps, {
    sessionToken,
    currentPassword: field(body, "currentPassword"),
    newPassword: field(body, "newPassword"),
    client,
    knownTokens,
  });
  if (result.status === "signed-out")
    refuse({ status: "refused", reason: "sign-in-needed" });
  unlessRefused(result);

  return answer("Your password is changed.", {});
};

export const changeAddressEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens, sessionToken } = await write(
    deps,
    request
  );
  const result = await requestAddressChange(deps, {
    sessionToken,
    currentPassword: field(body, "currentPassword"),
    newAddress: field(body, "newAddress"),
    client,
    knownTokens,
  });
  if (result.status === "signed-out")
    refuse({ status: "refused", reason: "sign-in-needed" });
  unlessRefused(result);

  return answer("Check the new address's email to confirm it.", {});
};

/** Confirms an address change by its link (`token`) or its code, inside the session that asked. */
export const confirmAddressEndpoint: Endpoint = async (deps, request) => {
  const { body, sessionToken } = await write(deps, request);
  const token = field(body, "token");
  const result =
    token !== ""
      ? await confirmAddressChangeByLink(deps, { sessionToken, token })
      : await confirmAddressChangeByCode(deps, {
          sessionToken,
          code: field(body, "code"),
        });
  if (result.status === "sign-in-needed")
    refuse({ status: "refused", reason: "sign-in-needed" });
  unlessRefused(result);

  return answer("Your email address is changed.", {});
};

export const cancelAddressEndpoint: Endpoint = async (deps, request) => {
  const { body } = await write(deps, request);
  unlessRefused(
    await cancelAddressChange(deps, { token: field(body, "token") })
  );

  return answer("The change of address is cancelled.", {});
};

export const deleteAccountEndpoint: Endpoint = async (deps, request) => {
  const { body, client, knownTokens, sessionToken } = await write(
    deps,
    request
  );
  const result = await deleteOwnAccount(deps, {
    sessionToken,
    currentPassword: field(body, "currentPassword"),
    client,
    knownTokens,
  });
  if (result.status === "signed-out")
    refuse({ status: "refused", reason: "sign-in-needed" });
  unlessRefused(result);

  return answer("Your account is deleted.", {}, [
    clearCookie(deps.settings, "session"),
  ]);
};

/** The signed-in account, or null; never cached. */
export const meEndpoint: Endpoint = async (deps, request) => {
  const sessionToken = readCookie(
    request,
    cookieName(deps.settings, "session")
  );
  const account =
    sessionToken === undefined
      ? null
      : await sessionAccount(deps, { sessionToken });

  return answer("The signed-in account.", { account });
};
