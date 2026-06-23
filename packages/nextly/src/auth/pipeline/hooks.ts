import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";

import type { AuthHooks, AuthInput, Challenge } from "./types";

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

  async runAfterAuthenticate(
    user: AuthUser,
    ctx: PluginContext
  ): Promise<AuthUser | { challenge: Challenge }> {
    let current = user;
    for (const h of this.#hooks) {
      if (!h.afterAuthenticate) continue;
      const res = await h.afterAuthenticate(current, ctx);
      if (res && typeof res === "object" && "challenge" in res) return res;
      current = res;
    }
    return current;
  }

  async runAfterLogin(user: AuthUser, ctx: PluginContext): Promise<void> {
    for (const h of this.#hooks) await h.afterLogin?.(user, ctx);
  }

  async runCustomizeClaims(
    claims: Record<string, unknown>,
    user: AuthUser,
    ctx: PluginContext
  ): Promise<Record<string, unknown>> {
    let current = claims;
    for (const h of this.#hooks) {
      if (h.customizeClaims)
        current = await h.customizeClaims(current, user, ctx);
    }
    return current;
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
