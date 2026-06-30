import type { PluginContext } from "../../plugins/plugin-context";

import type { ChallengeDefinition } from "./types";

/**
 * @experimental Registry of challenge definitions a plugin can resolve (e.g. TOTP).
 * Keyed by challenge id; duplicate ids are a registration error (D71).
 */
export class ChallengeRegistry {
  #defs = new Map<string, ChallengeDefinition>();

  add(def: ChallengeDefinition): void {
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
