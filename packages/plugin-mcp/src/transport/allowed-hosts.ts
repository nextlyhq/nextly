/**
 * The hostnames this endpoint answers on.
 *
 * One list serves two checks. `Host` decides whether a request reached the
 * name an operator published, and `Origin` decides whether a browser page was
 * entitled to send it. Both are answered against hostnames, both are
 * port-agnostic, and holding them apart would let an install accept a name for
 * one purpose and refuse it for the other.
 *
 * @module transport/allowed-hosts
 */
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";

/**
 * The hostname inside anything an operator is likely to paste.
 *
 * A published address is copied from a browser bar, an env file or a
 * deployment dashboard, so it arrives as a full URL as often as a bare name.
 * Taking only the hostname means those all mean the same thing, which is also
 * what the checks compare: both are port-agnostic, so `example.com:3000` and
 * `example.com` are one entry rather than two, and an entry that kept its port
 * would match nothing at all.
 *
 * A bare `host:port` is the case that has to be handled deliberately. It parses
 * as a URL whose SCHEME is the host, leaving the hostname empty, so a value
 * without `://` is given one before it is parsed rather than after it fails.
 *
 * IPv6 needs its brackets (`[::1]`), which is the convention the underlying
 * checks use for their own allowlists.
 */
function hostnameOf(value: string): string | undefined {
  const text = value.trim();
  if (text === "") return undefined;

  const withScheme = text.includes("://") ? text : `http://${text}`;
  try {
    const { hostname } = new URL(withScheme);
    return hostname === "" ? undefined : hostname;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the allowlist from the one source that applies.
 *
 * Exactly one source decides, and the order is explicit, then derived, then
 * localhost. They are not merged: an install that named its own hostnames has
 * said which names are legitimate, and quietly adding `localhost` to that list
 * would widen a decision the operator made narrowly. The same argument runs the
 * other way, so a derived list does not gain localhost either.
 *
 * An explicit list that resolves to nothing refuses every request rather than
 * falling back. Falling back would turn a typo into a silently wider endpoint,
 * which is the direction that goes unnoticed; refusing everything is visible on
 * the first call and says what to fix.
 *
 * The derived source is `NEXT_PUBLIC_APP_URL`, which is the address a Nextly
 * install already states about itself and the same variable the preview and
 * email surfaces resolve their absolute links from.
 */
export function resolveAllowedHosts(configured?: readonly string[]): string[] {
  if (configured !== undefined) {
    return dedupe(
      configured
        .map(hostnameOf)
        .filter((name): name is string => name !== undefined)
    );
  }

  const published = process.env.NEXT_PUBLIC_APP_URL;
  const derived = published === undefined ? undefined : hostnameOf(published);
  if (derived !== undefined) return [derived];

  return localhostAllowedHostnames();
}

function dedupe(names: readonly string[]): string[] {
  return Array.from(new Set(names));
}
