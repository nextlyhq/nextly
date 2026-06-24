/**
 * Email provider registry (C2/D65).
 *
 * Replaces the hardcoded `switch (provider.type)` with a registry so plugins can
 * contribute custom email providers via `contributes.emailProviders`. Seeded with
 * the built-ins (smtp/resend/sendlayer); plugin providers register additional
 * types at boot. `globalThis`-pinned + reset-per-boot (clear-and-rebuild, like the
 * route/service registries) so HMR re-registration never accumulates or collides.
 *
 * @module domains/email/services/email-provider-registry
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { EmailProviderAdapter } from "../types";

import { createResendProvider } from "./providers/resend-provider";
import { createSendLayerProvider } from "./providers/sendlayer-provider";
import { createSmtpProvider } from "./providers/smtp-provider";

/** A factory that builds a provider adapter from its (decrypted) config. */
export type EmailProviderFactory = (
  config: Record<string, unknown>
) => EmailProviderAdapter;

const BUILT_INS: Record<string, EmailProviderFactory> = {
  smtp: config =>
    createSmtpProvider(
      config as {
        host: string;
        port: number;
        secure?: boolean;
        auth: { user: string; pass: string };
      }
    ),
  resend: config => createResendProvider(config as { apiKey: string }),
  sendlayer: config => createSendLayerProvider(config as { apiKey: string }),
};

class EmailProviderRegistry {
  private factories = new Map<string, EmailProviderFactory>();

  constructor() {
    this.seedBuiltIns();
  }

  private seedBuiltIns(): void {
    for (const [type, factory] of Object.entries(BUILT_INS)) {
      this.factories.set(type, factory);
    }
  }

  /** Register a provider type. Throws if the type is already registered. */
  register(type: string, factory: EmailProviderFactory): void {
    if (this.factories.has(type)) {
      throw new Error(
        `NEXTLY_EMAIL_PROVIDER_COLLISION: email provider type "${type}" is already registered (built-in or another plugin).`
      );
    }
    this.factories.set(type, factory);
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }

  /** Build an adapter for a provider type, or throw if unsupported. */
  create(type: string, config: Record<string, unknown>): EmailProviderAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      // Generic public sentence; the offending type goes to logContext only.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: "Unsupported email provider type.",
        statusCode: 422,
        logContext: { type },
      });
    }
    return factory(config);
  }

  /** Drop all registrations and re-seed the built-ins (per-boot reset / HMR). */
  reset(): void {
    this.factories.clear();
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
