/**
 * No two Singles at one public address.
 *
 * A Single is one page at one fixed address, so two Singles declaring the same
 * address are a clash the configuration states by itself, and nothing a person
 * later saves can settle it: the configuration stops, naming both. Collections
 * are not compared here. Each of their entries has its own address, so two
 * collections may share a pattern (pages and posts both at `"/{slug}"`), and
 * only two entries can clash, which a save is asked about.
 *
 * `defineConfig` asks this of the site's own configuration, and the boot asks
 * it again once plugins' types have joined, through the same function, so a
 * plugin cannot take a page the site already declares. The boot also judges
 * each plugin type's address by the template rule here, since a plugin's types
 * never pass through `defineCollection` or `defineSingle`.
 *
 * @module domains/public-addresses/distinct-public-addresses
 */
import { NextlyError } from "../../errors/nextly-error";

import {
  declaredPublicAddressProblem,
  type PublicAddressKind,
} from "./public-address-template";

/** A Single as this check reads it: its slug and its declared address. */
interface AddressedSingle {
  slug: string;
  publicAddress?: string;
}

/** One address declared by more than one Single, and those Singles in order. */
export interface PublicAddressClash {
  address: string;
  singles: string[];
}

/**
 * Every address two or more Singles declare, in the order first declared.
 *
 * Addresses are compared as written: the template rule has already held each
 * to its one spelling, so equal text is the same address and different text
 * another (paths are case-sensitive, so `/About` is not `/about`).
 */
export function publicAddressClashes(config: {
  singles?: readonly AddressedSingle[];
}): PublicAddressClash[] {
  const holders = new Map<string, string[]>();
  for (const single of config.singles ?? []) {
    if (typeof single.publicAddress !== "string") continue;
    const held = holders.get(single.publicAddress);
    if (held) held.push(single.slug);
    else holders.set(single.publicAddress, [single.slug]);
  }
  return [...holders]
    .filter(([, singles]) => singles.length > 1)
    .map(([address, singles]) => ({ address, singles }));
}

/** The sentence naming one clash, for a developer to act on. */
function clashSentence(clash: PublicAddressClash): string {
  const names = clash.singles.map(slug => `"${slug}"`);
  const listed = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const all = names.length === 2 ? "both" : "all";
  return `Singles ${listed} are ${all} at "${clash.address}".`;
}

/** A type as the configuration holds it, for {@link assertConfiguredPublicAddresses}. */
interface ConfiguredType {
  slug: string;
  fields?: readonly unknown[];
  publicAddress?: unknown;
}

/**
 * Throw where a public address in `config` breaks the template rule, or where
 * two Singles declare one, naming each.
 *
 * Every type is judged, not only the site's own: a plugin's collections and
 * Singles reach the configuration without passing through `defineCollection`
 * or `defineSingle`, so the boot is the first place their addresses are seen.
 * A type the site defined was judged already when defined, by the same rule,
 * so it is never refused here for something it was not refused for there.
 *
 * @throws NextlyError (INVALID_INPUT) naming every problem, with the remedy.
 */
export function assertConfiguredPublicAddresses(config: {
  collections?: readonly ConfiguredType[];
  singles?: readonly ConfiguredType[];
}): void {
  const problems: string[] = [];
  const judge = (types: readonly ConfiguredType[], kind: PublicAddressKind) => {
    for (const type of types) {
      const problem = declaredPublicAddressProblem(
        type.publicAddress,
        kind,
        type.fields ?? []
      );
      if (problem !== null) {
        problems.push(`The ${kind} "${type.slug}": ${problem}`);
      }
    }
  };
  judge(config.collections ?? [], "collection");
  judge(config.singles ?? [], "single");
  if (problems.length > 0) {
    throw NextlyError.invalidInput({
      message: `${problems.join(" ")} Fix its \`publicAddress\`, or remove it until the type is public.`,
      logContext: { problems },
    });
  }

  // Only declarations that passed the rule are compared, so a clash names
  // two addresses that are each a real page.
  const singles = (config.singles ?? []).filter(
    (single): single is AddressedSingle =>
      typeof single.publicAddress === "string"
  );
  const clashes = publicAddressClashes({ singles });
  if (clashes.length === 0) return;
  throw NextlyError.invalidInput({
    message:
      `${clashes.map(clashSentence).join(" ")} ` +
      "A page has one address: give each Single its own `publicAddress`, or remove it from all but one.",
    logContext: { clashes },
  });
}
