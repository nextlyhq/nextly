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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
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
  EmailProviderType,
} from "../../../schemas/email-providers/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { encrypt, decrypt } from "../../../utils/encryption";
// Pull adapter type into a normal `import type` declaration so the return
// signature on createAdapterFromProvider satisfies consistent-type-imports.
import type { EmailProviderAdapter } from "../types";

import { getEmailProviderRegistry } from "./email-provider-registry";

const MASKED_VALUE = "••••••••";

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
 * Note: `type` may be changed; the admin supports switching provider on
 * edit. A change re-validates the stored configuration against the new
 * provider, because the rules that accepted it belonged to the old one.
 */
export interface UpdateEmailProviderInput {
  name?: string;
  type?: EmailProviderType;
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

    this.encryptionSecret = env.NEXTLY_SECRET;

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
   *
   * Refuses rather than degrading. A provider's configuration holds SMTP
   * passwords and API keys, so with no secret to encrypt them under the only
   * alternative is to write the credential readable to anyone with database
   * access. `domains/webhooks/secret.ts` already refuses for the same threat;
   * this keeps the two consistent instead of leaving the higher-value
   * credential on the weaker policy.
   *
   * The message names the variable because the operator is one environment
   * setting away from working, and a variable name is not itself a secret.
   */
  private encryptConfiguration(config: Record<string, unknown>): string {
    if (!this.encryptionSecret) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "Email provider credentials cannot be saved because NEXTLY_SECRET is not set. " +
          "Set it in the environment and restart — provider passwords and API keys are " +
          "encrypted under it, and without it they would be stored readable.",
        statusCode: 422,
        logContext: { reason: "email-provider-no-encryption-key" },
      });
    }
    return encrypt(JSON.stringify(config), this.encryptionSecret);
  }

  /**
   * Decrypt a stored configuration value back to a JSON object.
   *
   * Deliberately more permissive than its write counterpart: it still accepts a
   * non-string stored value, which is what an install that wrote configuration
   * before the write path refused would have. Refusing to read those rows would
   * turn a credential stored in the clear into a provider nobody can open,
   * rotate, or delete — hiding exactly the records an operator needs to find.
   * The public read path masks them like any other, so tightening this would
   * cost recoverability and buy no confidentiality.
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
   * The dotted paths a provider declared as secret, e.g. `auth.pass`.
   *
   * Returns null when the type is not registered — an uninstalled plugin
   * leaves rows behind, and those must still be readable and still masked.
   */
  private declaredSecretPaths(type: string): ReadonlySet<string> | null {
    const registry = getEmailProviderRegistry();
    if (!registry.has(type)) return null;

    const fields = registry.get(type).configFields;
    // No declared fields is not the same as declaring nothing secret. It is an
    // absence of information, and a provider can still store configuration
    // without describing it -- so treat it like a missing definition and mask
    // everything, rather than reading an empty list as permission.
    if (fields.length === 0) return null;

    return new Set(
      fields.filter(field => field.secret === true).map(field => field.name)
    );
  }

  /** Every path the provider describes, secret or not. */
  private declaredConfigPaths(type: string): ReadonlySet<string> {
    const registry = getEmailProviderRegistry();
    if (!registry.has(type)) return new Set();
    return new Set(registry.get(type).configFields.map(field => field.name));
  }

  /**
   * Mask a configuration object for a public read.
   *
   * Which values are secret is DECLARED by the provider, not guessed from key
   * names. The name heuristic below cannot know that `credential` holds one and
   * that a field merely containing `token` may not, and it can only ever be
   * right about names core has seen before — which is none of a plugin's.
   *
   * When no definition is available — the provider's package was uninstalled,
   * or it shipped no field metadata — EVERY leaf is masked rather than guessed
   * at. The key-name heuristic cannot reconstruct what the definition declared,
   * so a field the provider correctly marked secret (`credential`, say) would
   * come back in the clear precisely when the plugin that knew better is gone.
   * Absence of information has to mask more, not less; an over-masked read is
   * recoverable by reinstalling the package, a leaked credential is not.
   */
  private maskConfiguration(
    config: Record<string, unknown>,
    secretPaths: ReadonlySet<string> | null,
    declaredPaths: ReadonlySet<string>,
    pathPrefix = ""
  ): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const key of Object.keys(config)) {
      const value = config[key];
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        masked[key] = this.maskConfiguration(
          value as Record<string, unknown>,
          secretPaths,
          declaredPaths,
          path
        );
        continue;
      }

      // Three states, not two. `null` means no usable definition, so nothing is
      // known and everything is masked. Otherwise a path is revealed ONLY if the
      // provider declared it and did not mark it secret: a key the definition
      // does not mention at all -- a credential left behind by a plugin upgrade,
      // say -- is unknown rather than public, and the parsers strip unknown keys
      // for adapter construction without removing them from storage.
      const declared = secretPaths !== null && declaredPaths.has(path);
      const isSecret =
        secretPaths === null || !declared || secretPaths.has(path);
      masked[key] = isSecret ? MASKED_VALUE : value;
    }
    return masked;
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
      configuration: this.maskConfiguration(
        config,
        this.declaredSecretPaths(row.type),
        this.declaredConfigPaths(row.type)
      ),
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
    // Reject an unregistered type and an unusable configuration BEFORE the
    // insert. Without this a row stores happily and fails only when something
    // tries to send through it, inside a catch that reports `{ success: false }`
    // -- so the operator learns at the worst moment and with the least detail.
    getEmailProviderRegistry()
      .get(data.type)
      .validateConfig(data.configuration);

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
   * Provider `type` may be changed. The stored configuration is
   * re-validated against the new provider, since the rules that accepted it
   * belonged to the old one.
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

    // The type this row will have once the update lands. A type change with no
    // configuration alongside it still has to name a registered provider,
    // otherwise the row survives as one nothing can build an adapter for.
    const effectiveType = data.type ?? currentRow.type;
    const typeChanged =
      data.type !== undefined && data.type !== currentRow.type;
    if (typeChanged) {
      // A type change REPLACES the provider-specific configuration rather than
      // merging it: the two providers have different shapes, and an SMTP host
      // carried into a Resend config is not a partial edit, it is leftover.
      // Validating the OLD configuration here would fail every real switch,
      // because the submitted API key is exactly what the old shape lacks.
      const submitted =
        data.configuration !== undefined
          ? this.stripMaskedConfigValues(data.configuration)
          : {};
      getEmailProviderRegistry()
        .get(data.type as string)
        .validateConfig(submitted);

      // Persist the replacement even when the update carried no configuration.
      // Validating `{}` and then not writing it leaves the PREVIOUS provider's
      // encrypted configuration under the new type -- so a permissive target
      // parser would receive stale credentials, which is exactly what
      // "a type change replaces rather than merges" is supposed to prevent.
      if (data.configuration === undefined) {
        updateData.configuration = this.encryptConfiguration(submitted);
      }
    }

    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.fromEmail !== undefined) updateData.fromEmail = data.fromEmail;
    if (data.fromName !== undefined) updateData.fromName = data.fromName;
    if (data.configuration !== undefined) {
      const existingConfig = this.decryptConfiguration(
        currentRow.configuration
      );
      const incomingConfig = this.stripMaskedConfigValues(data.configuration);
      // Across a type change the stored configuration belongs to the previous
      // provider, so it is discarded rather than merged into the new shape.
      const mergedConfig = typeChanged
        ? incomingConfig
        : this.deepMergeConfig(existingConfig, incomingConfig);

      // Validate the MERGED result, not the incoming patch: an update usually
      // carries only the fields that changed, and the masked values it omits
      // are supplied by the merge. Checking the patch alone would reject every
      // partial edit for missing required fields it was never meant to send.
      //
      // Validated against the type this update RESULTS IN, not the stored one.
      // `data.type` is applied a few lines above, so a change from smtp to
      // resend would otherwise have its configuration checked by the SMTP
      // parser and stored under resend -- accepted here and unusable at send.
      getEmailProviderRegistry()
        .get(effectiveType)
        .validateConfig(mergedConfig);

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
      // Normalise raw driver errors via toDbError(dialect) first so the kind
      // is preserved (otherwise PG 23505 collapses to INTERNAL_ERROR).
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
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
    testEmail?: string,
    /**
     * `"send"` dispatches a real message, which is what the REST route and the
     * admin's Send Test button promise. `"connection"` asks the provider's own
     * probe instead and sends nothing — available only where the descriptor
     * reports `capabilities.connectionTest`. Defaulted so every existing caller
     * keeps the contract it was written against.
     */
    mode: "send" | "connection" | undefined = "send"
  ): Promise<{ success: boolean; error?: string }> {
    const provider = await this.getProviderDecrypted(id);

    if (!provider.isActive) {
      return {
        success: false,
        error: "Provider is inactive. Activate it before testing.",
      };
    }

    try {
      // Only when the caller explicitly asked to probe. Substituting a probe
      // for the send would have been silent and wrong: `api/email-providers-test.ts`
      // reports a dispatched message and the admin tells the operator to check
      // that inbox, so an SMTP user would have seen success with nothing sent.
      if (mode === "connection") {
        const registry = getEmailProviderRegistry();
        const probe = registry.has(provider.type)
          ? registry.get(provider.type).testConnectionFrom
          : undefined;
        if (!probe) {
          return {
            success: false,
            error: "This provider cannot be tested without sending a message.",
          };
        }
        const result = await probe(provider.configuration);
        return {
          success: result.ok,
          error: result.ok ? undefined : (result.detail ?? "Connection failed"),
        };
      }

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

    // Built-ins (smtp/resend/sendlayer) + any plugin-contributed provider types
    // (C2/D65). Unknown type → BUSINESS_RULE_VIOLATION (raised by the registry).
    return getEmailProviderRegistry().create(provider.type, config);
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
