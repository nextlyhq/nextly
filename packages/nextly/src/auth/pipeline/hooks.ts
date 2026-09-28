import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";
import { JWT_INTERNAL_CLAIMS } from "../jwt/claims";

import type { AuthHooks, AuthInput, Challenge } from "./types";

/**
 * The claims no `customizeClaims` hook may change: the ones the session reader
 * turns into the signed-in user, and the ones token verification owns. A hook
 * that replaced `sub` or `roleIds` would sign a session for an account, or
 * with roles, that the account-state gate never saw.
 */
const RESERVED_CLAIMS: readonly string[] = [
  ...JWT_INTERNAL_CLAIMS,
  "email",
  "name",
  "image",
  "roleIds",
];

/**
 * `customized` with every reserved claim put back as `core` had it: restored
 * where `core` set it, and removed where it did not.
 */
function withCoreClaims(
  customized: Record<string, unknown>,
  core: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...customized };
  for (const key of RESERVED_CLAIMS) {
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
function assertSameAccount(authenticated: AuthUser, returnedId: unknown): void {
  if (String(returnedId) === String(authenticated.id)) return;
  throw NextlyError.internal({
    logContext: {
      hook: "afterAuthenticate",
      authenticatedUserId: authenticated.id,
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

  add(hooks: AuthHooks): void {
    this.#hooks.push(hooks);
  }

  /** True when no hooks are registered — lets the handler take the legacy fast path. */
  get isEmpty(): boolean {
    return this.#hooks.length === 0;
  }

  async runBeforeLogin(input: AuthInput, ctx: PluginContext): Promise<void> {
    for (const h of this.#hooks) await h.beforeLogin?.(input, ctx);
  }

  /**
   * Thread the authenticated user through every `afterAuthenticate` hook.
   *
   * A hook may change the user's details, or pause the login with a
   * challenge, but only for the account that authenticated: what it returns
   * is what the session or the pending token is issued for, so a different
   * id would sign someone in as an account that never proved who it was. A
   * hook that returns another account, or no user at all, fails the login.
   */
  async runAfterAuthenticate(
    user: AuthUser,
    ctx: PluginContext
  ): Promise<AuthUser | { challenge: Challenge }> {
    let current = user;
    for (const h of this.#hooks) {
      if (!h.afterAuthenticate) continue;
      const res = await h.afterAuthenticate(current, ctx);
      if (res && typeof res === "object" && "challenge" in res) {
        assertSameAccount(user, res.challenge?.userId);
        return res;
      }
      assertSameAccount(user, res?.id);
      current = res;
    }
    return current;
  }

  async runAfterLogin(user: AuthUser, ctx: PluginContext): Promise<void> {
    for (const h of this.#hooks) await h.afterLogin?.(user, ctx);
  }

  /**
   * Thread the claims through every `customizeClaims` hook. Hooks may add
   * claims; the reserved ones come back as core built them, whatever a hook
   * returned or changed in place, because the snapshot is a deep copy taken
   * before any hook runs.
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
    return withCoreClaims(current, core);
  }

  async runDetermineUser(
    request: Request,
    ctx: PluginContext
  ): Promise<AuthUser | null> {
    for (const h of this.#hooks) {
      const u = await h.determineUser?.(request, ctx);
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
