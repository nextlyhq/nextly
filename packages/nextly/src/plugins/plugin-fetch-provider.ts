/**
 * Building one plugin's `ctx.fetch`.
 *
 * Present only for a plugin whose manifest declares the hosts it calls, so a
 * plugin that never asked for the network does not have a way to reach it.
 *
 * @module plugins/plugin-fetch-provider
 * @since 1.0.0
 */
import { lookup } from "node:dns/promises";

import { NextlyError } from "../errors/nextly-error";

import type { PluginDefinition } from "./plugin-context";
import { createPluginFetch, type ResolvedAddress } from "./runtime/fetch";
import { sendVetted } from "./runtime/transport";

/** Resolver errors that mean the name has no address, not that asking failed. */
const NO_SUCH_NAME = new Set(["ENOTFOUND", "ENODATA", "EAI_NONAME"]);

/**
 * Every address the system resolver gives for a name, in both families.
 *
 * Through the OS resolver (`getaddrinfo`), as the rest of the process
 * resolves: querying DNS directly skipped `/etc/hosts`, Docker `extra_hosts`
 * and Kubernetes `hostAliases`, so a name the deployment had pinned resolved
 * to something else here. Every answer is returned, so the vetting judges
 * each one.
 *
 * A name with no address answers with none, which the vetting refuses as
 * unresolved. Any other failure — a timeout, an unreachable resolver — is
 * refused as what it is, rather than reported as a name that does not exist.
 */
async function resolveAll(hostname: string): Promise<ResolvedAddress[]> {
  try {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.flatMap(answer =>
      answer.family === 4 || answer.family === 6
        ? [{ address: answer.address, family: answer.family }]
        : []
    );
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && NO_SUCH_NAME.has(code)) return [];
    throw NextlyError.forbidden({
      logContext: {
        reason: "outbound-dns-failed",
        host: hostname,
        code: typeof code === "string" ? code : null,
      },
    });
  }
}

/**
 * Whether this process may reach a loopback address for a fake provider.
 *
 * Only when `NODE_ENV` says development or test OUTRIGHT. Core reads an unset
 * `NODE_ENV` as development, and a deployment that never set it would then
 * let a published plugin that left `localhost` in its manifest reach local
 * ports; the raw value is what an operator actually chose.
 */
function loopbackAllowed(): boolean {
  const mode = process.env.NODE_ENV;
  return mode === "development" || mode === "test";
}

/** The fetch this plugin gets, or undefined when it declared no hosts. */
export function createPluginFetchFor(
  plugin: PluginDefinition
):
  | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>)
  | undefined {
  const allowlist = plugin.capabilities?.net?.outbound;
  if (!allowlist || allowlist.length === 0) return undefined;

  return createPluginFetch({
    allowlist,
    resolve: resolveAll,
    send: sendVetted,
    // A fake provider in a test suite runs on localhost without a
    // certificate. Allowing that in production would re-open the loopback
    // every other rule here exists to close.
    allowLoopback: loopbackAllowed(),
    userAgent: `nextly-plugin/${plugin.name}`,
  });
}
