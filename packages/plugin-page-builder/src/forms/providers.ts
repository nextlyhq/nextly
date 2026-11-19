/**
 * The form providers a site has: the registry the receiver reads, and the
 * cross-plugin `forms` service another plugin registers its provider through.
 *
 * Follows the blocks service (`blocks/registration-service.ts`): the service
 * is resolved from `init`, so plugin order does not matter, and its factory
 * runs once per boot, which is where the previous boot's providers are
 * forgotten. The page builder resolves it from its own `init` too, so that
 * reset happens on a boot where no plugin registers anything.
 *
 * Narrow on purpose: another plugin may add a provider and nothing else. It
 * cannot list, replace or remove one, so what a block's stored reference
 * reaches never depends on the order plugins load in.
 *
 * @module forms/providers
 */
import type {
  FormProvider,
  FormProviderService,
} from "@nextlyhq/plugin-sdk/blocks";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** The service name the page builder offers form providers under. */
export const FORM_SERVICE = "forms";

/**
 * The page builder's own provider, which a block without a picked form uses:
 * its fields are the block's own. Reserved, so a block's stored reference
 * to it can never reach another plugin's.
 */
export const SIMPLE_FORM_PROVIDER = "simple";

/** A provider id: lower case letters, digits and `-`, 1 to 64 characters. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The providers one page builder holds, for the boot that is running. */
export interface FormProviders {
  /** The provider registered under `id` this boot, if any. */
  get(id: string): FormProvider | undefined;
  /** Every provider registered this boot, in the order they registered. */
  all(): readonly FormProvider[];
  /**
   * Start a boot: forget every provider registered before, and answer the
   * service other plugins register through until the next start.
   */
  start(): FormProviderService;
}

/** A fresh, empty set of providers, one per page builder definition. */
export function createFormProviders(): FormProviders {
  let current = new Map<string, FormProvider>();
  return {
    get: id => current.get(id),
    all: () => [...current.values()],
    start() {
      const registered = new Map<string, FormProvider>();
      current = registered;
      return {
        register(provider) {
          const problem = providerProblem(provider);
          if (problem !== null) {
            throw new Error(`[page-builder] A form provider ${problem}.`);
          }
          if (registered.has(provider.id)) {
            throw new Error(
              `[page-builder] Two form providers use the id "${provider.id}". ` +
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
 * provider stops the boot that named it rather than failing a visitor's post.
 */
function providerProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "must be an object";
  const provider = value as Record<string, unknown>;
  const id = provider.id;
  if (typeof id !== "string" || !PROVIDER_ID.test(id)) {
    return "needs an id of 1 to 64 lower case letters, digits and dashes";
  }
  if (id === SIMPLE_FORM_PROVIDER) {
    return `cannot use the id "${SIMPLE_FORM_PROVIDER}", which is the page builder's own`;
  }
  if (typeof provider.label !== "string" || provider.label.trim() === "") {
    return `("${id}") needs a label`;
  }
  for (const method of ["list", "describe", "accept"]) {
    if (typeof provider[method] !== "function") {
      return `("${id}") needs a ${method} function`;
    }
  }
  return null;
}

/**
 * Resolve this site's `forms` service from the page builder's own `init`,
 * which is what starts the boot (see the module note). Resolution is
 * memoized per boot, so a provider plugin whose `init` ran first keeps what
 * it registered.
 */
export function startFormProviders(services: {
  readonly plugins: Readonly<Record<string, Record<string, unknown>>>;
}): void {
  void services.plugins[PAGE_BUILDER_PLUGIN_NAME]?.[FORM_SERVICE];
}
