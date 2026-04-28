/**
 * Email Provider Service
 *
 * CRUD operations for managing email providers stored in the
 * `email_providers` table. Supports SMTP, Resend, and SendLayer
 * providers with default provider management and test sending.
 *
 * Configuration JSON is encrypted at rest using AES-256-GCM.
 * Public-facing methods return masked configuration; internal
 * methods provide decrypted access for email sending.
 *
 * @module services/email/email-provider-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq, desc } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { env } from "../../../lib/env";
import { emailProvidersMysql } from "../../../schemas/email-providers/mysql";
import { emailProvidersPg } from "../../../schemas/email-providers/postgres";
import { emailProvidersSqlite } from "../../../schemas/email-providers/sqlite";
import type {
  EmailProviderInsert,
  EmailProviderRecord,
} from "../../../schemas/email-providers/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { encrypt, decrypt } from "../../../utils/encryption";
// Pull adapter type into a normal `import type` declaration so the return
// signature on createAdapterFromProvider satisfies consistent-type-imports.
import type { EmailProviderAdapter } from "../types";

import { createResendProvider } from "./providers/resend-provider";
import { createSendLayerProvider } from "./providers/sendlayer-provider";
import { createSmtpProvider } from "./providers/smtp-provider";

const MASKED_VALUE = "••••••••";

const SENSITIVE_CONFIG_KEYS = [
  "apikey",
  "api_key",
  "password",
  "pass",
  "secret",
  "token",
  "clientsecret",
  "client_secret",
];

// ============================================================
// Input Types
// ============================================================

/**
 * Input for creating a new email provider.
 * Extends EmailProviderInsert (all required + optional fields).
 */
export type CreateEmailProviderInput = EmailProviderInsert;

/**
 * Input for updating an existing email provider.
 * All fields are optional — only provided fields are updated.
 * Note: `type` cannot be changed after creation.
 */
export interface UpdateEmailProviderInput {
  name?: string;
  type?: "smtp" | "resend" | "sendlayer";
  fromEmail?: string;
  fromName?: string | null;
  configuration?: Record<string, unknown>;
  isDefault?: boolean;
  isActive?: boolean;
}

// ============================================================
// Email Provider Service
// ============================================================

/** Raw DB row before decryption — configuration may be an encrypted string. */
interface RawEmailProviderRow
  extends Omit<EmailProviderRecord, "configuration"> {
  configuration: Record<string, unknown> | string;
}

/** Union of all dialect-specific email_providers table definitions. */
type EmailProvidersTable =
  | typeof emailProvidersPg
  | typeof emailProvidersMysql
  | typeof emailProvidersSqlite;

export class EmailProviderService extends BaseService {
  private emailProviders: EmailProvidersTable;
  private encryptionSecret: string | undefined;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    this.encryptionSecret = env.NEXTLY_SECRET_RESOLVED;

    switch (this.dialect) {
      case "postgresql":
        this.emailProviders = emailProvidersPg;
        break;
      case "mysql":
        this.emailProviders = emailProvidersMysql;
        break;
      case "sqlite":
        this.emailProviders = emailProvidersSqlite;
        break;
      default:
        // `this.dialect` is narrowed to `never` after the exhaustive switch;
        // String() coercion satisfies @typescript-eslint/restrict-template-expressions.
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  // ============================================================
  // Encryption Helpers
  // ============================================================

  /**
   * Encrypt a configuration JSON object for storage.
   * Returns the encrypted string, or the original object if no secret is configured.
   */
  private encryptConfiguration(
    config: Record<string, unknown>
  ): Record<string, unknown> | string {
    if (!this.encryptionSecret) {
      return config;
    }
    return encrypt(JSON.stringify(config), this.encryptionSecret);
  }

  /**
   * Decrypt a stored configuration value back to a JSON object.
   */
  private decryptConfiguration(
    stored: Record<string, unknown> | string
  ): Record<string, unknown> {
    if (!this.encryptionSecret || typeof stored !== "string") {
      return stored as Record<string, unknown>;
    }
    try {
      return JSON.parse(decrypt(stored, this.encryptionSecret));
    } catch {
      this.logger.warn(
        "Failed to decrypt provider configuration — returning empty object"
      );
      return {};
    }
  }

  /**
   * Mask a configuration object, replacing all values with `"••••••••"`.
   * Returns a flat object with the same keys but masked values.
   */
  private maskConfiguration(
    config: Record<string, unknown>
  ): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const key of Object.keys(config)) {
      const value = config[key];
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        masked[key] = this.maskConfiguration(value as Record<string, unknown>);
      } else {
        masked[key] = this.isSensitiveConfigKey(key) ? MASKED_VALUE : value;
      }
    }
    return masked;
  }

  private isSensitiveConfigKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[\s-]/g, "");
    return SENSITIVE_CONFIG_KEYS.some(sensitive =>
      normalized.includes(sensitive.replace(/[_-]/g, ""))
    );
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private stripMaskedConfigValues(
    config: Record<string, unknown>
  ): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (value === MASKED_VALUE) {
        continue;
      }

      if (this.isPlainObject(value)) {
        cleaned[key] = this.stripMaskedConfigValues(value);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  private deepMergeConfig(
    base: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(incoming)) {
      if (value === undefined) continue;

      if (this.isPlainObject(value) && this.isPlainObject(merged[key])) {
        merged[key] = this.deepMergeConfig(merged[key], value);
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  /**
   * Read a raw row from the database and return it with masked configuration.
   */
  private toMaskedRecord(row: RawEmailProviderRow): EmailProviderRecord {
    const config = this.decryptConfiguration(row.configuration);
    return {
      ...row,
      configuration: this.maskConfiguration(config),
    };
  }

  /**
   * Read a raw row from the database and return it with decrypted configuration.
   */
  private toDecryptedRecord(row: RawEmailProviderRow): EmailProviderRecord {
    return {
      ...row,
      configuration: this.decryptConfiguration(row.configuration),
    };
  }

  // ============================================================
  // CRUD Methods (public — return masked configuration)
  // ============================================================

  /**
   * Create a new email provider.
   *
   * Configuration is encrypted before storage.
   * If `isDefault` is true, unsets the previous default provider
   * in a transaction to ensure only one default exists.
   */
  async createProvider(
    data: CreateEmailProviderInput
  ): Promise<EmailProviderRecord> {
    const id = randomUUID();
    const now = new Date();

    const values = {
      id,
      name: data.name,
      type: data.type,
      fromEmail: data.fromEmail,
      fromName: data.fromName ?? null,
      configuration: this.encryptConfiguration(data.configuration),
      isDefault: data.isDefault ?? false,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      if (values.isDefault) {
        // Unset any existing default first, then insert the new default provider

        await this.db
          .update(this.emailProviders)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(this.emailProviders.isDefault, true));

        await this.db.insert(this.emailProviders).values(values);
      } else {
        await this.db.insert(this.emailProviders).values(values);
      }
    } catch (error) {
      // Drizzle surfaces the driver's raw error here, so normalise it through
      // toDbError(dialect) first; otherwise NextlyError.fromDatabaseError would
      // see a non-DbError and fall back to the generic INTERNAL_ERROR shape.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return this.getProvider(id);
  }

  /**
   * Get a single email provider by ID.
   * Returns masked configuration — use `getProviderDecrypted()` for internal access.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async getProvider(id: string): Promise<EmailProviderRecord> {
    const row = await this.getRawProvider(id);
    return this.toMaskedRecord(row);
  }

  /**
   * List all email providers, ordered by creation date (newest first).
   * Returns masked configuration for all providers.
   */
  async listProviders(): Promise<EmailProviderRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .orderBy(desc(this.emailProviders.createdAt));

    return (results as RawEmailProviderRow[]).map(row =>
      this.toMaskedRecord(row)
    );
  }

  /**
   * Update an existing email provider.
   * Configuration is encrypted before storage.
   *
   * Provider `type` cannot be changed after creation.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async updateProvider(
    id: string,
    data: UpdateEmailProviderInput
  ): Promise<EmailProviderRecord> {
    const currentRow = await this.getRawProvider(id);

    const now = new Date();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.fromEmail !== undefined) updateData.fromEmail = data.fromEmail;
    if (data.fromName !== undefined) updateData.fromName = data.fromName;
    if (data.configuration !== undefined) {
      const existingConfig = this.decryptConfiguration(
        currentRow.configuration
      );
      const incomingConfig = this.stripMaskedConfigValues(data.configuration);
      const mergedConfig = this.deepMergeConfig(existingConfig, incomingConfig);
      updateData.configuration = this.encryptConfiguration(mergedConfig);
    }
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    try {
      if (data.isDefault === true) {
        // Unset any existing default first, then apply all updates to this provider

        await this.db
          .update(this.emailProviders)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(this.emailProviders.isDefault, true));

        await this.db
          .update(this.emailProviders)
          .set(updateData)
          .where(eq(this.emailProviders.id, id));
      } else {
        await this.db
          .update(this.emailProviders)
          .set(updateData)
          .where(eq(this.emailProviders.id, id));
      }
    } catch (error) {
      // DbError → NextlyError; spec §13.8 keeps the public message generic and
      // tucks the dialect-specific code into logContext via fromDatabaseError.
      throw NextlyError.fromDatabaseError(error);
    }

    return this.getProvider(id);
  }

  /**
   * Delete an email provider.
   *
   * Cannot delete the default provider — set another provider
   * as default first.
   * Idempotent — returns successfully if provider doesn't exist.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if provider is the default
   */
  async deleteProvider(id: string): Promise<void> {
    let row;
    try {
      row = await this.getRawProvider(id);
    } catch (error) {
      // If provider doesn't exist, consider it already deleted (idempotent).
      // Use the structural NextlyError.isCode guard so this still works when
      // the thrown error came through `withDbErrors` or any cross-boundary path.
      if (NextlyError.isCode(error, "NOT_FOUND")) {
        this.logger.info(
          `Provider ${id} not found during delete — already deleted`,
          { id }
        );
        return;
      }
      throw error;
    }

    if (row.isDefault) {
      // Identifier (`id`) belongs in logContext per spec §13.8; the public
      // sentence stays generic and free of identifiers.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "Cannot delete the default email provider. Set another provider as default first.",
        statusCode: 422,
        logContext: { id },
      });
    }

    await this.db
      .delete(this.emailProviders)
      .where(eq(this.emailProviders.id, id));
  }

  /**
   * Set a provider as the default.
   *
   * Unsets the previous default in a transaction to ensure
   * only one default provider exists at any time.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async setDefault(id: string): Promise<EmailProviderRecord> {
    await this.getRawProvider(id);

    const now = new Date();

    // Unset any existing default first, then set the new one

    await this.db
      .update(this.emailProviders)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(this.emailProviders.isDefault, true));

    await this.db
      .update(this.emailProviders)
      .set({ isDefault: true, updatedAt: now })
      .where(eq(this.emailProviders.id, id));

    return this.getProvider(id);
  }

  /**
   * Get the default email provider with masked configuration.
   *
   * Returns `null` if no default is configured.
   */
  async getDefaultProvider(): Promise<EmailProviderRecord | null> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .where(eq(this.emailProviders.isDefault, true))
      .limit(1);

    if (!results[0]) return null;
    return this.toMaskedRecord(results[0]);
  }

  /**
   * Test an email provider by sending a test email.
   *
   * Validates that the provider exists and is active, then creates a
   * temporary adapter from the provider's decrypted configuration and
   * sends a test email directly (avoids circular dependency with EmailService).
   */
  async testProvider(
    id: string,
    testEmail?: string
  ): Promise<{ success: boolean; error?: string }> {
    const provider = await this.getProviderDecrypted(id);

    if (!provider.isActive) {
      return {
        success: false,
        error: "Provider is inactive. Activate it before testing.",
      };
    }

    try {
      const adapter = this.createAdapterFromProvider(provider);
      const from = provider.fromName
        ? `${provider.fromName} <${provider.fromEmail}>`
        : provider.fromEmail;

      // Fall back to the provider's own fromEmail when no test address is given
      const to = testEmail || provider.fromEmail;

      const result = await adapter.send({
        to,
        from,
        subject: "Nextly — Test Email",
        html: `<p>This is a test email from your <strong>${provider.name}</strong> email provider.</p><p>If you received this, your provider is configured correctly.</p>`,
      });

      return {
        success: result.success,
        error: result.success ? undefined : "Send returned unsuccessful",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a provider adapter from a decrypted provider record.
   */
  private createAdapterFromProvider(
    provider: EmailProviderRecord
  ): EmailProviderAdapter {
    const config = provider.configuration;

    switch (provider.type) {
      case "smtp":
        return createSmtpProvider(
          config as {
            host: string;
            port: number;
            secure?: boolean;
            auth: { user: string; pass: string };
          }
        );
      case "resend":
        return createResendProvider(config as { apiKey: string });
      case "sendlayer":
        return createSendLayerProvider(config as { apiKey: string });
      default:
        // Unknown provider type — generic public sentence; the offending type
        // string goes to logContext to avoid echoing untrusted identifiers.
        throw new NextlyError({
          code: "BUSINESS_RULE_VIOLATION",
          publicMessage: "Unsupported email provider type.",
          statusCode: 422,
          logContext: { type: provider.type },
        });
    }
  }

  // ============================================================
  // Internal Methods (decrypted — for email adapters only)
  // ============================================================

  /**
   * Get a single email provider with decrypted configuration.
   * **Internal use only** — for email sending adapters that need real credentials.
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  async getProviderDecrypted(id: string): Promise<EmailProviderRecord> {
    const row = await this.getRawProvider(id);
    return this.toDecryptedRecord(row);
  }

  /**
   * Get the default email provider with decrypted configuration.
   * **Internal use only** — for email sending adapters that need real credentials.
   *
   * Returns `null` if no default is configured.
   */
  async getDefaultProviderDecrypted(): Promise<EmailProviderRecord | null> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .where(eq(this.emailProviders.isDefault, true))
      .limit(1);

    if (!results[0]) return null;
    return this.toDecryptedRecord(results[0]);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Fetch a raw provider row from the database (no decryption or masking).
   *
   * @throws NextlyError NOT_FOUND if provider doesn't exist
   */
  private async getRawProvider(id: string): Promise<RawEmailProviderRow> {
    const results = await this.db
      .select()
      .from(this.emailProviders)
      .where(eq(this.emailProviders.id, id))
      .limit(1);

    if (results.length === 0) {
      // Identifier `id` is for operators only — not echoed to the public message
      // per spec §13.8. The 404 factory uses the canonical "Not found." sentence.
      throw NextlyError.notFound({ logContext: { id } });
    }

    return results[0];
  }
}
