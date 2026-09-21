/**
 * Building one plugin's `ctx.fetch`.
 *
 * Present only for a plugin whose manifest declares the hosts it calls, so a
 * plugin that never asked for the network does not have a way to reach it.
 *
 * @module plugins/plugin-fetch-provider
 * @since 1.0.0
 */
import { resolve4, resolve6 } from "node:dns/promises";

import { env } from "../lib/env";

import type { PluginDefinition } from "./plugin-context";
import { createPluginFetch, type ResolvedAddress } from "./runtime/fetch";
import { sendVetted } from "./runtime/transport";

/**
 * Every A and AAAA answer for a name.
 *
 * Both families, because refusing on one while the transport could use the
 * other would leave the check answering about an address nothing connects to.
 * A family with no records is not an error — most names have only one.
 */
async function resolveBoth(hostname: string): Promise<ResolvedAddress[]> {
  const [v4, v6] = await Promise.all([
    resolve4(hostname).catch(() => [] as string[]),
    resolve6(hostname).catch(() => [] as string[]),
  ]);
  return [
    ...v4.map(address => ({ address, family: 4 as const })),
    ...v6.map(address => ({ address, family: 6 as const })),
  ];
}

/** The fetch this plugin gets, or undefined when it declared no hosts. */
export function createPluginFetchFor(
  plugin: PluginDefinition
):
  | ((input: string | URL, init?: RequestInit) => Promise<Response>)
  | undefined {
  const allowlist = plugin.capabilities?.net?.outbound;
  if (!allowlist || allowlist.length === 0) return undefined;

  return createPluginFetch({
    allowlist,
    resolve: resolveBoth,
    send: sendVetted,
    // A fake provider in a test suite runs on localhost without a
    // certificate. Allowing that in production would re-open the loopback
    // every other rule here exists to close.
    allowLoopback: env.NODE_ENV !== "production",
  });
}
