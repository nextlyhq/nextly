/**
 * The page check providers a site has: the registry the provided-checks
 * route runs, and the cross-plugin `pageChecks` service another plugin
 * registers its provider through.
 *
 * Follows the form providers (`forms/providers.ts`): the service is resolved
 * from `init`, so plugin order does not matter, and its factory runs once
 * per boot, which is where the previous boot's providers are forgotten. The
 * page builder resolves it from its own `init` too, so that reset happens on
 * a boot where no plugin registers anything.
 *
 * Narrow on purpose: another plugin may add a provider and nothing else.
 * What a provider checks stays inside that plugin; the page builder only
 * runs it and lists what it finds.
 *
 * @module page-check-providers
 */
import type {
  PageCheckProvider,
  PageCheckProviderService,
} from "@nextlyhq/plugin-sdk/blocks";

import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";

/** The service name the page builder offers page check providers under. */
export const PAGE_CHECKS_SERVICE = "pageChecks";

/** A provider id: lower case letters, digits and `-`, 1 to 64 characters. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The groups of the Page checks list a provider may report in. */
const GROUPS: ReadonlySet<string> = new Set([
  "accessibility",
  "content",
  "publishing",
  "search",
]);

/** The providers one page builder holds, for the boot that is running. */
export interface PageCheckProviders {
  /** Every provider registered this boot, in the order they registered. */
  all(): readonly PageCheckProvider[];
  /**
   * Start a boot: forget every provider registered before, and answer the
   * service other plugins register through until the next start.
   */
  start(): PageCheckProviderService;
}

/** A fresh, empty set of providers, one per page builder definition. */
export function createPageCheckProviders(): PageCheckProviders {
  let current = new Map<string, PageCheckProvider>();
  return {
    all: () => [...current.values()],
    start() {
      const registered = new Map<string, PageCheckProvider>();
      current = registered;
      return {
        register(provider) {
          const problem = providerProblem(provider);
          if (problem !== null) {
            throw new Error(`[page-builder] A page check provider ${problem}.`);
          }
          if (registered.has(provider.id)) {
            throw new Error(
              `[page-builder] Two page check providers use the id "${provider.id}". ` +
                `Each provider's id must be its own.`
            );
          }
          registered.set(provider.id, provider);
        },
      };
    },
  };
}

/**
 * Why `value` cannot be registered as a provider, or `null` when it can.
 * Judged at registration, in the registering plugin's `init`, so a malformed
 * provider stops the boot that named it rather than failing an author's list.
 */
function providerProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "must be an object";
  const provider = value as Record<string, unknown>;
  const id = provider.id;
  if (typeof id !== "string" || !PROVIDER_ID.test(id)) {
    return "needs an id of 1 to 64 lower case letters, digits and dashes";
  }
  if (typeof provider.group !== "string" || !GROUPS.has(provider.group)) {
    return `("${id}") needs a group: accessibility, content, publishing or search`;
  }
  if (typeof provider.check !== "function") {
    return `("${id}") needs a check function`;
  }
  return null;
}

/**
 * Resolve this site's `pageChecks` service from the page builder's own
 * `init`, which is what starts the boot (see the module note). Resolution is
 * memoized per boot, so a provider plugin whose `init` ran first keeps what
 * it registered.
 */
export function startPageCheckProviders(services: {
  readonly plugins: Readonly<Record<string, Record<string, unknown>>>;
}): void {
  void services.plugins[PAGE_BUILDER_PLUGIN_NAME]?.[PAGE_CHECKS_SERVICE];
}
