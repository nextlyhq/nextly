/**
 * Dialect-Agnostic Type Definitions for Email Providers
 *
 * These types define the structure for the `email_providers` table
 * used to manage email sending providers (SMTP, Resend, SendLayer)
 * via the Admin UI. All dialect-specific schemas (PostgreSQL, MySQL,
 * SQLite) will implement these interfaces.
 *
 * @module schemas/email-providers/types
 * @since 1.0.0
 */

// ============================================================
// Email Provider Types
// ============================================================

/**
 * Supported email provider types.
 *
 * - `smtp`: SMTP server (uses nodemailer)
 * - `resend`: Resend API (uses resend SDK)
 * - `sendlayer`: SendLayer API (uses REST API)
 *
 * @example
 * ```typescript
 * const type: EmailProviderType = 'resend';
 * ```
 */
export type EmailProviderType = "smtp" | "resend" | "sendlayer";

// ============================================================
// Email Provider Insert Type
// ============================================================

/**
 * Insert type for creating a new email provider.
 *
 * Contains all required and optional fields for inserting a provider
 * into the `email_providers` table. Fields with defaults (like
 * `isDefault`, `isActive`) are optional on insert.
 *
 * @example
 * ```typescript
 * const newProvider: EmailProviderInsert = {
 *   name: 'Production SMTP',
 *   type: 'smtp',
 *   fromEmail: 'noreply@example.com',
 *   fromName: 'My App',
 *   configuration: {
 *     host: 'smtp.gmail.com',
 *     port: 587,
 *     secure: false,
 *     auth: { user: 'user@gmail.com', pass: 'encrypted...' },
 *   },
 * };
 * ```
 */
export interface EmailProviderInsert {
  /** Display name for this provider (e.g., "Production SMTP", "Resend API"). */
  name: string;

  /** Provider type determining which adapter is used for sending. */
  type: EmailProviderType;

  /**
   * Default sender email address.
   * @example 'noreply@example.com'
   */
  fromEmail: string;

  /**
   * Default sender display name.
   * @example 'My App'
   */
  fromName?: string | null;

  /**
   * Provider-specific configuration stored as JSON.
   * Sensitive fields (passwords, API keys) are encrypted at rest.
   *
   * Shape depends on `type`:
   * - `smtp`: `{ host, port, secure, auth: { user, pass } }`
   * - `resend`: `{ apiKey }`
   * - `sendlayer`: `{ apiKey }`
   */
  configuration: Record<string, unknown>;

  /**
   * Whether this is the default provider for sending emails.
   * Only one provider can be default at a time.
   * @default false
   */
  isDefault?: boolean;

  /**
   * Whether this provider is currently active.
   * Inactive providers are stored but not used for sending.
   * @default true
   */
  isActive?: boolean;
}

// ============================================================
// Email Provider Record Type
// ============================================================

/**
 * Full record type for an email provider.
 *
 * Extends `EmailProviderInsert` with all required fields that are
 * set by the database (id, timestamps) or have default values.
 *
 * @example
 * ```typescript
 * const provider: EmailProviderRecord = {
 *   id: 'uuid-123',
 *   name: 'Production Resend',
 *   type: 'resend',
 *   fromEmail: 'noreply@example.com',
 *   fromName: 'My App',
 *   configuration: { apiKey: '••••••••' },
 *   isDefault: true,
 *   isActive: true,
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface EmailProviderRecord extends EmailProviderInsert {
  /** Unique identifier (UUID or CUID). */
  id: string;

  /** Whether this is the default provider (required on record). */
  isDefault: boolean;

  /** Whether this provider is active (required on record). */
  isActive: boolean;

  /** When the provider was created. */
  createdAt: Date;

  /** When the provider was last updated. */
  updatedAt: Date;
}
