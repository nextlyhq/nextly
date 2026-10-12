import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext } from "../../plugins/plugin-context";

import { MUST_CHANGE_PASSWORD_CHALLENGE } from "./pending-token";
import type { ChallengeDefinition } from "./types";

/**
 * @experimental Registry of challenge definitions a plugin can resolve (e.g. TOTP).
 * Keyed by challenge id; duplicate ids are a registration error (D71).
 */
export class ChallengeRegistry {
  #defs = new Map<string, ChallengeDefinition>();

  add(def: ChallengeDefinition): void {
    // Core's own continuation id is reserved. The set-initial-password step
    // accepts any pending token carrying it, so a plugin challenge registered
    // under the same id would hand its holders that step without ever
    // answering the plugin's factor.
    if (def.id === MUST_CHANGE_PASSWORD_CHALLENGE) {
      throw NextlyError.validation({
        errors: [
          {
            path: "id",
            code: "RESERVED",
            message: `The challenge id "${MUST_CHANGE_PASSWORD_CHALLENGE}" is reserved by core.`,
          },
        ],
      });
    }
    if (this.#defs.has(def.id)) {
      throw new Error(`Duplicate challenge id: ${def.id}`);
    }
    this.#defs.set(def.id, def);
  }

  has(id: string): boolean {
    return this.#defs.has(id);
  }

  async resolve(
    id: string,
    args: { userId: string; response: Record<string, unknown> },
    ctx: PluginContext
  ): Promise<{ ok: true } | { ok: false; reason?: string }> {
    const def = this.#defs.get(id);
    if (!def) throw new Error(`Unknown challenge: ${id}`);
    return def.resolve(args, ctx);
  }
}
