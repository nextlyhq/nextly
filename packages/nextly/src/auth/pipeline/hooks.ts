import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";
import { withoutRefreshCookie } from "../cookies/refresh-token-cookie";
import { JWT_INTERNAL_CLAIMS } from "../jwt/claims";

import type { AuthHooks, AuthInput, Challenge } from "./types";

/**
 * The claims no `customizeClaims` hook may set, even where core built none:
 * the ones the session reader turns into the signed-in user, and the ones
 * token verification owns. A hook that added `sub` or `roleIds` would sign a
 * session for an account, or with roles, that the account-state gate never
 * saw.
 */
const RESERVED_CLAIMS: readonly string[] = [
  ...JWT_INTERNAL_CLAIMS,
  "email",
  "name",
  "image",
  "roleIds",
];

/**
 * `customized` with every claim core built put back as core had it, and every
 * `reserved` claim core did not build removed.
 *
 * Every claim core built, not only the reserved ones: the claims built from a
 * user's custom fields reach `custom` access rules as the caller's identity —
 * a tenant id is identity in practice — so a hook replacing one would sign a
 * session that the rules judge as another tenant. A hook may still ADD claims,
 * but not under a configured custom field's name: where core built none for
 * it — the user has no value, or it could not be read — the token carries
 * none, rather than whatever a hook supplied.
 */
function withCoreClaims(
  customized: Record<string, unknown>,
  core: Record<string, unknown>,
  reserved: readonly string[]
): Record<string, unknown> {
  const out = { ...customized };
  for (const key of new Set([...reserved, ...Object.keys(core)])) {
    if (key in core) out[key] = core[key];
    else delete out[key];
  }
  return out;
}

/**
 * Throw unless `returnedId` names the account that authenticated. The detail
 * goes to the log only: the client sees the generic internal error, since the
 * fault is a plugin's, not the person's.
 */
function assertSameAccount(authenticatedId: string, returnedId: unknown): void {
  if (String(returnedId) === authenticatedId) return;
  throw NextlyError.internal({
    logContext: {
      hook: "afterAuthenticate",
      authenticatedUserId: authenticatedId,
      returnedUserId: returnedId ?? null,
    },
  });
}

/**
 * @experimental Registry that collects plugin-contributed {@link AuthHooks} and
 * runs each phase in registration order. Modify-style phases thread their value
 * through every hook; `afterAuthenticate` short-circuits the moment a hook
 * returns a `{ challenge }`; observe-style phases just fan out (D71).
 */
export class AuthHookRegistry {
  #hooks: AuthHooks[] = [];
  // The claims no `customizeClaims` hook may add or change.
  readonly #reserved: readonly string[];

  /**
   * @param options.userFieldClaims - The names of the configured custom user
   *   fields, which the claims carry under the same names. Reserved like the
   *   identity claims, whether or not core built a claim for one.
   */
  constructor(options: { userFieldClaims?: readonly string[] } = {}) {
    this.#reserved = [...RESERVED_CLAIMS, ...(options.userFieldClaims ?? [])];
  }

  add(hooks: AuthHooks): void {
    this.#hooks.push(hooks);
  }

  /** True when no hooks are registered — lets the handler take the legacy fast path. */
  get isEmpty(): boolean {
    return this.#hooks.length === 0;
  }

  /** The hooks receive the request without the refresh cookie. */
  async runBeforeLogin(input: AuthInput, ctx: PluginContext): Promise<void> {
    const hookInput = {
      ...input,
      request: withoutRefreshCookie(input.request),
    };
    for (const h of this.#hooks) await h.beforeLogin?.(hookInput, ctx);
  }

  /**
   * Thread the authenticated user through every `afterAuthenticate` hook.
   *
   * A hook may change the user's details, or pause the login with a
   * challenge, but only for the account that authenticated: what it returns
   * is what the session or the pending token is issued for, so a different
   * id would sign someone in as an account that never proved who it was. A
   * hook that returns another account, or no user at all, fails the login.
   *
   * The id is captured BEFORE the first hook, and the first hook receives a
   * copy: comparing against the object handed to the hooks let a hook change
   * `id` in place — `Object.assign(user, profile)` — and pass a check that
   * then compared the new id with itself. What comes back carries the
   * captured id, so a hook holding on to an object it returned cannot change
   * the account afterwards either.
   */
  async runAfterAuthenticate(
    user: AuthUser,
    ctx: PluginContext
  ): Promise<AuthUser | { challenge: Challenge }> {
    const authenticatedId = String(user.id);
    let current: AuthUser = { ...user };
    for (const h of this.#hooks) {
      if (!h.afterAuthenticate) continue;
      const res = await h.afterAuthenticate(current, ctx);
      if (res && typeof res === "object" && "challenge" in res) {
        assertSameAccount(authenticatedId, res.challenge?.userId);
        return { challenge: { ...res.challenge, userId: authenticatedId } };
      }
      assertSameAccount(authenticatedId, res?.id);
      current = res;
    }
    return { ...current, id: user.id };
  }

  async runAfterLogin(user: AuthUser, ctx: PluginContext): Promise<void> {
    for (const h of this.#hooks) await h.afterLogin?.(user, ctx);
  }

  /**
   * Thread the claims through every `customizeClaims` hook. Hooks may add
   * claims; every claim core built comes back as core built it, and the
   * reserved ones a hook added — identity claims, and the configured custom
   * fields' — are removed, whatever a hook returned or changed in place,
   * because the snapshot is a deep copy taken before any hook runs.
   */
  async runCustomizeClaims(
    claims: Record<string, unknown>,
    user: AuthUser,
    ctx: PluginContext
  ): Promise<Record<string, unknown>> {
    const core = structuredClone(claims);
    let current = structuredClone(claims);
    for (const h of this.#hooks) {
      if (h.customizeClaims)
        current = await h.customizeClaims(current, user, ctx);
    }
    return withCoreClaims(current, core, this.#reserved);
  }

  /** The hooks receive the request without the refresh cookie. */
  async runDetermineUser(
    request: Request,
    ctx: PluginContext
  ): Promise<AuthUser | null> {
    const hookRequest = withoutRefreshCookie(request);
    for (const h of this.#hooks) {
      const u = await h.determineUser?.(hookRequest, ctx);
      if (u) return u;
    }
    return null;
  }

  async runBeforeRegister(
    data: Record<string, unknown>,
    ctx: PluginContext
  ): Promise<Record<string, unknown>> {
    let current = data;
    for (const h of this.#hooks) {
      if (h.beforeRegister) current = await h.beforeRegister(current, ctx);
    }
    return current;
  }

  async runAfterRegister(user: AuthUser, ctx: PluginContext): Promise<void> {
    for (const h of this.#hooks) await h.afterRegister?.(user, ctx);
  }

  async runBeforeLogout(
    user: AuthUser | null,
    ctx: PluginContext
  ): Promise<void> {
    for (const h of this.#hooks) await h.beforeLogout?.(user, ctx);
  }

  async runAfterLogout(ctx: PluginContext): Promise<void> {
    for (const h of this.#hooks) await h.afterLogout?.(ctx);
  }
}
