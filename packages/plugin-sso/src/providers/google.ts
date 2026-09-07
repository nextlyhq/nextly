import type { JWTPayload } from "jose";

import type { GoogleProviderOptions } from "../config";
import { SsoError } from "../errors";

import { createOidcAdapter, type DiscoveryCache } from "./oidc";
import {
  makeProfile,
  type ProviderAdapter,
  type ExternalProfile,
} from "./types";

/** Google's OpenID configuration document. */
const DISCOVERY_URL =
  "https://accounts.google.com/.well-known/openid-configuration";

/**
 * `openid` for the ID token, `email` and `profile` for the fields the linking
 * rules and the admin UI consult. Nothing more: every extra scope is a consent
 * screen the user has to accept and a permission we then hold.
 */
const SCOPES = ["openid", "email", "profile"] as const;

/**
 * Read the profile out of verified Google claims.
 *
 * `sub` is the subject rather than `email`, because Google account holders can
 * change their address and the row must survive that. `email_verified` is
 * carried through rather than assumed — a Workspace administrator can create an
 * account whose address Google has not confirmed, and the linking rules refuse
 * to attach an unverified address to an existing user.
 */
function claimsToProfile(claims: JWTPayload): ExternalProfile {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new SsoError("id-token-invalid", "no sub claim");
  }
  return makeProfile({
    providerAccountId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : null,
    image: typeof claims.picture === "string" ? claims.picture : null,
  });
}

/**
 * Build the Google adapter.
 *
 * `hostedDomains` restricts sign-in to named Google Workspace domains. It is
 * enforced on the verified `hd` CLAIM, not on the email's suffix: an address
 * ending in `@acme.com` proves nothing on its own, since a personal Google
 * account can hold one, whereas `hd` is Google's own assertion that the account
 * belongs to that Workspace. The same value is also sent as an authorization
 * parameter, which is a convenience — it preselects the account chooser — and
 * carries no security weight, since the request is client-supplied.
 */
export function createGoogleAdapter(
  options: GoogleProviderOptions,
  deps: { cache?: DiscoveryCache; fetchImpl?: typeof fetch } = {}
): ProviderAdapter {
  const allowed = options.hostedDomains ?? [];
  const scopes = [...SCOPES, ...(options.extraScopes ?? [])];

  const extraAuthorizeParams: Record<string, string> = {};
  // Only when a single domain is configured — the parameter takes one value,
  // and sending the first of several would silently narrow the others away.
  if (allowed.length === 1) extraAuthorizeParams.hd = allowed[0];

  return createOidcAdapter({
    key: "google",
    discoveryUrl: DISCOVERY_URL,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    scopes,
    extraAuthorizeParams,
    claimsToProfile,
    assertClaims(claims) {
      if (allowed.length === 0) return;
      const hd = typeof claims.hd === "string" ? claims.hd : null;
      if (hd === null || !allowed.includes(hd)) {
        throw new SsoError("domain-not-allowed", `hd=${hd ?? "absent"}`);
      }
    },
    ...(deps.cache ? { cache: deps.cache } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}
