/**
 * Email Service Types
 *
 * Provides configuration types for the Nextly email system.
 * Supports multiple email providers (SMTP, Resend, SendLayer) and
 * customizable email templates for auth flows.
 *
 * @module services/email/types
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@nextly/core';
 *
 * export default defineConfig({
 *   email: {
 *     providerConfig: {
 *       provider: 'resend',
 *       apiKey: process.env.RESEND_API_KEY!,
 *     },
 *     from: 'Nextly <noreply@example.com>',
 *   },
 * });
 * ```
 */

// ============================================================
// Email Provider Types
// ============================================================

/**
 * Supported email provider types.
 */
export type EmailProvider = "smtp" | "resend" | "sendlayer";

/**
 * SMTP provider configuration.
 *
 * Uses nodemailer under the hood for SMTP transport.
 *
 * @example
 * ```typescript
 * const smtp: SmtpConfig = {
 *   provider: 'smtp',
 *   host: 'smtp.gmail.com',
 *   port: 587,
 *   secure: false,
 *   auth: { user: 'user@gmail.com', pass: 'app-password' },
 * };
 * ```
 */
export interface SmtpConfig {
  provider: "smtp";

  /** SMTP server hostname. */
  host: string;

  /** SMTP server port. */
  port: number;

  /**
   * Use TLS/SSL for the connection.
   * @default false
   */
  secure?: boolean;

  /** SMTP authentication credentials. */
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Resend provider configuration.
 *
 * @example
 * ```typescript
 * const resend: ResendConfig = {
 *   provider: 'resend',
 *   apiKey: process.env.RESEND_API_KEY!,
 * };
 * ```
 */
export interface ResendConfig {
  provider: "resend";

  /** Resend API key. */
  apiKey: string;
}

/**
 * SendLayer provider configuration.
 *
 * @example
 * ```typescript
 * const sendLayer: SendLayerConfig = {
 *   provider: 'sendlayer',
 *   apiKey: process.env.SENDLAYER_API_KEY!,
 * };
 * ```
 */
export interface SendLayerConfig {
  provider: "sendlayer";

  /** SendLayer API key (Bearer token). */
  apiKey: string;
}

// ============================================================
// Email Template Types
// ============================================================

/**
 * Email template override function.
 *
 * Allows overriding the default email templates for auth flows
 * (welcome, password reset, email verification) in `defineConfig()`.
 *
 * The optional `attachments` field in the return value lets a
 * code-first template declare default attachments sourced from the
 * media library. At send time they're merged with per-send attachments
 * (per-send wins on mediaId conflict), then validated against the same
 * limits as any other attachment list.
 *
 * @example
 * ```typescript
 * const passwordResetTemplate: EmailTemplateFn = (data) => ({
 *   subject: `Reset your password`,
 *   html: `<p>Hi ${data.user.name}, click <a href="${data.url}">here</a> to reset.</p>`,
 * });
 *
 * const welcomeWithBrochure: EmailTemplateFn = (data) => ({
 *   subject: `Welcome to Acme`,
 *   html: `<p>Welcome, ${data.user.name}!</p>`,
 *   attachments: [{ mediaId: "med_onboarding_pdf" }],
 * });
 * ```
 */
export type EmailTemplateFn = (data: {
  /** The user receiving the email. */
  user: { name: string | null; email: string };
  /** Auth token (for password reset, email verification). */
  token?: string;
  /** Full URL with token (e.g., password reset link). */
  url?: string;
}) => {
  subject: string;
  html: string;
  /** Default attachments for this template. Optional. */
  attachments?: EmailAttachmentInput[];
};

// ============================================================
// Email Configuration
// ============================================================

/**
 * Email configuration for `defineConfig()`.
 *
 * Provides a code-first fallback for email sending. Database-managed
 * providers (configured via admin Settings UI) take precedence when
 * available.
 *
 * @example
 * ```typescript
 * export default defineConfig({
 *   email: {
 *     providerConfig: {
 *       provider: 'smtp',
 *       host: 'smtp.gmail.com',
 *       port: 587,
 *       auth: { user: 'user@gmail.com', pass: 'app-password' },
 *     },
 *     from: 'My App <noreply@example.com>',
 *     baseUrl: 'https://example.com',
 *   },
 * });
 * ```
 */
export interface EmailConfig {
  /**
   * Provider configuration. SMTP, Resend, or SendLayer.
   * This is the code-first fallback — database-managed providers
   * take precedence when configured via admin UI.
   */
  providerConfig: SmtpConfig | ResendConfig | SendLayerConfig;

  /**
   * Default "from" address for all emails.
   * @example 'Nextly <noreply@example.com>'
   */
  from: string;

  /**
   * Base URL for links in emails (e.g., password reset link).
   * Falls back to `NEXT_PUBLIC_APP_URL` environment variable if not set.
   * @example 'https://example.com'
   */
  baseUrl?: string;

  /**
   * Path for the password reset page link in emails.
   * The full URL is constructed as `{baseUrl}{resetPasswordPath}?token=...`.
   *
   * @default '/admin/reset-password'
   * @example '/auth/reset-password'
   */
  resetPasswordPath?: string;

  /**
   * Path for the email verification page link in emails.
   * The full URL is constructed as `{baseUrl}{verifyEmailPath}?token=...`.
   *
   * @default '/admin/verify-email'
   * @example '/auth/verify-email'
   */
  verifyEmailPath?: string;

  /**
   * Custom email template overrides.
   * Override the default HTML templates for auth-related emails.
   */
  templates?: {
    /** Welcome email sent after user registration. */
    welcome?: EmailTemplateFn;
    /** Password reset email with reset link. */
    passwordReset?: EmailTemplateFn;
    /** Email verification email with verification link. */
    emailVerification?: EmailTemplateFn;
  };
}

// ============================================================
// Email Attachments
// ============================================================

/**
 * Caller-facing attachment descriptor.
 *
 * Attachments must already exist in the Nextly media library. Uploaded
 * separately via the media API; the email API only references them by ID.
 *
 * @example
 * ```ts
 * await nextly.email.send({
 *   to: "user@example.com",
 *   subject: "Your invoice",
 *   html: "<p>See attached.</p>",
 *   attachments: [{ mediaId: "med_abc123" }],
 * });
 * ```
 */
export interface EmailAttachmentInput {
  /** Media record ID. Required. */
  mediaId: string;
  /**
   * Override the media's original filename in the outgoing email.
   * Useful for sanitising or humanising filenames at send-time.
   */
  filename?: string;
}

/**
 * Internal attachment shape after resolution (bytes in memory).
 *
 * Produced by the attachment resolver; consumed by provider adapters.
 * Not part of the public API — adapters translate to their provider's
 * wire format (nodemailer native, base64 for Resend/SendLayer).
 *
 * @internal
 */
export interface ResolvedAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

// ============================================================
// Email Provider Adapter
// ============================================================

/**
 * Provider adapter interface for sending emails.
 *
 * Each email provider (SMTP, Resend, SendLayer) implements this
 * interface. The `EmailService` resolves the active provider and
 * delegates to its `send()` method.
 */
export interface EmailProviderAdapter {
  /**
   * Send an email through this provider.
   *
   * @param options - Email sending options
   * @returns Result with success status and optional message ID
   */
  send(options: {
    /** Recipient email address. */
    to: string;
    /** Sender email address (e.g., 'App <noreply@example.com>'). */
    from: string;
    /** Email subject line. */
    subject: string;
    /** HTML email body. */
    html: string;
    /** CC email addresses. */
    cc?: string[];
    /** BCC email addresses. */
    bcc?: string[];
    /**
     * Attachments to include. Each entry is already resolved to raw
     * bytes — adapters forward to their provider's format.
     */
    attachments?: ResolvedAttachment[];
  }): Promise<{ success: boolean; messageId?: string }>;
}
