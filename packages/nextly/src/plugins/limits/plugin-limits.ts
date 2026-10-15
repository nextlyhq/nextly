/**
 * Building `ctx.limits` for one plugin.
 *
 * The limiter reaches the selected limit store, the adapter and the
 * configuration through the container's own resolver, never the plugin-facing
 * one, so a plugin can reach the store only through its own namespaced
 * limiter. They are resolved on first use: a plugin's context is built while
 * the services are registered, before anything reserves.
 *
 * @module plugins/limits/plugin-limits
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";
import type { LimitRule } from "../../domains/limits/limit-rules";
import type { LimitStore } from "../../domains/limits/limit-store";
import {
  createPluginLimiter,
  type PluginLimiter,
} from "../../domains/limits/plugin-limiter";
import { env } from "../../lib/env";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { readProxyTrustSettings } from "../../utils/proxy-trust";
import type { PluginDefinition } from "../plugin-context";
import { rateLimitClient } from "../routes/route-options";

/** The configuration this reads, as far as limits go. */
interface LimitsConfig {
  rateLimit?: { singleInstance?: boolean };
}

/**
 * The limiter for `plugin`, or undefined when it declares no limit rules.
 * Its first call resolves what it needs; the same limiter is kept after.
 */
export function createPluginLimits(
  plugin: PluginDefinition
): PluginLimiter | undefined {
  const declared = plugin.contributes?.limits;
  if (declared === undefined || Object.keys(declared).length === 0) {
    return undefined;
  }
  const rules = new Map<string, LimitRule>(Object.entries(declared));
  let built: PluginLimiter | undefined;
  const limiter = (): PluginLimiter => {
    built ??= createPluginLimiter({
      plugin: plugin.name,
      rules,
      store: container.get<LimitStore>("limitStore"),
      secret: env.NEXTLY_SECRET,
      singleInstance:
        container.get<LimitsConfig>("config").rateLimit?.singleInstance ===
        true,
      transactions: container.get<DrizzleAdapter>("adapter"),
      clientAddress: request =>
        getTrustedClientIp(
          request,
          readProxyTrustSettings(() => container.get("config"))
        ),
      clientOf: rateLimitClient,
    });
    return built;
  };
  return {
    reserve: entries => limiter().reserve(entries),
    release: (reservation, options) => limiter().release(reservation, options),
    reset: target => limiter().reset(target),
    check: targets => limiter().check(targets),
    clientKey: request => limiter().clientKey(request),
    get store() {
      return limiter().store;
    },
  };
}
