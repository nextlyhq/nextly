import type { ProviderKey } from "../config";

/**
 * What a provider tells us about the person who just signed in, reduced to the
 * fields the linking rules actually consult.
 *
 * Deliberately narrow. Everything a provider returns beyond this is either
 * unused or unsafe to key on — the adapters resolve the provider-specific shape
 * into these fields precisely so `linking.ts` never has to know which provider
 * it is dealing with.
 */
export interface ExternalProfile {
  /**
   * The provider's permanent identifier for this person.
   *
   * Must be stable across a rename and unique within the provider. It is `sub`
   * for a standard OIDC provider, `oid:tid` for Entra (whose `sub` is pairwise
   * per application), and the numeric `id` for GitHub (whose `login` is
   * renameable and re-registerable, so keying on it would be a takeover path).
   * Never an email address, which changes.
   */
  providerAccountId: string;
  email: string | null;
  /**
   * Whether the PROVIDER asserts it verified this address.
   *
   * This single flag gates account linking. An unverified assertion means the
   * provider is repeating what the user typed, so treating it as proof of
   * ownership lets anyone who can register that address elsewhere take over the
   * local account holding it.
   *
   * INVARIANT: false whenever `email` is null. Build profiles with
   * {@link makeProfile} rather than by hand, which is what enforces it.
   */
  emailVerified: boolean;
  name: string | null;
  image: string | null;
}

/**
 * Build an {@link ExternalProfile}, holding the verified-implies-present
 * invariant.
 *
 * A provider can assert `email_verified: true` while sending no address at all
 * — Google does, on a token requested without the `email` scope. Carried
 * through naively that is a profile claiming a verified null, and every caller
 * that checks the flag before the value then has to remember the combination is
 * possible. One constructor is cheaper than that memory, and it is why the
 * adapters do not assemble the object literal themselves.
 */
export function makeProfile(input: {
  providerAccountId: string;
  email: string | null | undefined;
  emailVerified: boolean;
  name?: string | null;
  image?: string | null;
}): ExternalProfile {
  const email =
    typeof input.email === "string" && input.email.length > 0
      ? input.email
      : null;
  return {
    providerAccountId: input.providerAccountId,
    email,
    emailVerified: email !== null && input.emailVerified,
    name: input.name ?? null,
    image: input.image ?? null,
  };
}

/** What a token endpoint returned. Only the fields any adapter reads. */
export interface TokenSet {
  accessToken: string;
  idToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
}

/** What an adapter needs to build an authorization request. */
export interface AuthorizeArgs {
  state: string;
  nonce: string;
  /** The PKCE `S256` code challenge. */
  challenge: string;
  redirectUri: string;
}

/** What an adapter needs to redeem an authorization code. */
export interface ExchangeArgs {
  code: string;
  /** The PKCE code verifier the challenge was derived from. */
  verifier: string;
  /** Must be byte-identical to the value sent on the authorize request. */
  redirectUri: string;
}

/**
 * One identity provider.
 *
 * The three OIDC providers share a single implementation driven by discovery;
 * GitHub has its own. Only {@link ProviderAdapter.toProfile} genuinely differs
 * between them — an OIDC adapter reads verified claims out of a signed ID
 * token, GitHub makes two authenticated API calls because it issues none.
 */
export interface ProviderAdapter {
  key: ProviderKey;
  /** Scopes requested at the authorization endpoint. */
  readonly scopes: readonly string[];
  buildAuthorizeUrl(args: AuthorizeArgs): Promise<string>;
  exchange(args: ExchangeArgs): Promise<TokenSet>;
  /**
   * Turn a token response into a verified profile.
   *
   * `nonce` is the value minted for this transaction; an OIDC adapter compares
   * it against the ID token's claim to reject a token issued for a different
   * authorization request. An adapter whose provider issues no ID token ignores
   * it — the parameter stays in the signature so the caller has no per-provider
   * branch.
   */
  toProfile(
    tokens: TokenSet,
    args: { nonce: string }
  ): Promise<ExternalProfile>;
}
