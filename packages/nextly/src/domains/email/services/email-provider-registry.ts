/**
 * The set of mail providers this install can use.
 *
 * Holds definitions rather than bare factories, so everything that used to
 * hardcode the three built-in names can ask the registry instead: the REST
 * layer for which types are valid, the service for how to validate a stored
 * configuration, and the admin for how to render a form. A plugin provider
 * becomes reachable by all three at once rather than dispatchable by only one.
 *
 * `globalThis`-pinned and rebuilt per boot (clear-and-reseed, like the route and
 * service registries) so HMR re-registration neither accumulates nor collides.
 *
 * @module domains/email/services/email-provider-registry
 */

import { NextlyError } from "../../../errors/nextly-error";
import {
  MAX_EMAIL_PROVIDER_TYPE_LENGTH,
  containProviderCallbacks,
  emailProviderTypeTooLong,
  type RegisteredEmailProvider,
} from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

import { BUILT_IN_EMAIL_PROVIDERS } from "./providers/built-in-definitions";

class EmailProviderRegistry {
  private providers = new Map<string, RegisteredEmailProvider>();

  constructor() {
    this.seedBuiltIns();
  }

  private seedBuiltIns(): void {
    for (const provider of BUILT_IN_EMAIL_PROVIDERS) {
      // Callbacks are contained HERE as well as in the authoring helper, for the
      // reason stated above: this is the boundary every provider crosses, and a
      // hand-built one arrives with its own `createAdapterFrom`. Without this, a
      // provider that throws `Error(config.apiKey)` or returns it as a
      // `messageId` puts a credential in a log line and a database column.
      this.providers.set(provider.type, containProviderCallbacks(provider));
    }
  }

  /** Register a provider type. Throws if the type is already registered. */
  register(provider: RegisteredEmailProvider): void {
    // Enforced here as well as in defineEmailProvider, because this is the
    // boundary every provider actually crosses: RegisteredEmailProvider is a
    // structural type, so a JavaScript plugin or a hand-built object reaches
    // registration without passing through the authoring helper.
    // An empty id is indistinguishable from an unselected value in a
    // descriptor-driven picker, and the Direct API would persist a row carrying
    // it even though the REST schema rejects the same value.
    if (provider.type.trim() === "") {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: "An email provider type id cannot be empty.",
        logContext: { reason: "email-provider-type-empty" },
      });
    }
    if (provider.type.length > MAX_EMAIL_PROVIDER_TYPE_LENGTH) {
      throw emailProviderTypeTooLong(provider.type);
    }
    if (this.providers.has(provider.type)) {
      throw new Error(
        `NEXTLY_EMAIL_PROVIDER_COLLISION: email provider type "${provider.type}" is already registered (built-in or another plugin).`
      );
    }
    // Callbacks are contained HERE as well as in the authoring helper, for the
    // reason stated above: this is the boundary every provider crosses, and a
    // hand-built one arrives with its own `createAdapterFrom`. Without this, a
    // provider that throws `Error(config.apiKey)` or returns it as a
    // `messageId` puts a credential in a log line and a database column.
    this.providers.set(provider.type, containProviderCallbacks(provider));
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  /** Every registered provider, for listing and for building descriptors. */
  list(): ReadonlyArray<RegisteredEmailProvider> {
    return [...this.providers.values()];
  }

  /**
   * Look up a provider, or throw the error a caller should surface.
   *
   * The type goes to `logContext` rather than the public sentence: it can come
   * from a stored row or a request body, and neither is trusted to be repeated
   * back verbatim.
   */
  get(type: string): RegisteredEmailProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "Unsupported email provider type. Install the plugin that provides it, or choose a configured provider.",
        statusCode: 422,
        logContext: { type },
      });
    }
    return provider;
  }

  /**
   * Build an adapter for a provider type from its stored configuration.
   *
   * Validation is not optional here: the registered provider parses before it
   * builds, so a row written before its provider declared a required field
   * fails where an operator can act on it rather than at send time.
   */
  create(type: string, config: Record<string, unknown>): EmailProviderAdapter {
    return this.get(type).createAdapterFrom(config);
  }

  /** Drop all registrations and re-seed the built-ins (per-boot reset / HMR). */
  reset(): void {
    this.providers.clear();
    this.seedBuiltIns();
  }
}

const globalForEmailProviders = globalThis as unknown as {
  __nextly_emailProviderRegistry?: EmailProviderRegistry;
};

export function getEmailProviderRegistry(): EmailProviderRegistry {
  if (!globalForEmailProviders.__nextly_emailProviderRegistry) {
    globalForEmailProviders.__nextly_emailProviderRegistry =
      new EmailProviderRegistry();
  }
  return globalForEmailProviders.__nextly_emailProviderRegistry;
}

/** Reset the registry to just the built-ins (per-boot reset / HMR / tests). */
export function resetEmailProviderRegistry(): void {
  getEmailProviderRegistry().reset();
}
