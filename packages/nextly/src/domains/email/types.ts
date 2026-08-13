import type { EmailRetentionConfig } from "./retention-config";
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
 *
 * Widened past the built-ins for the same reason `EmailConfig.providerConfig`
 * is: the resolver builds every provider through the registry, so a contributed
 * type is usable in `defineConfig` and stored in the database. Leaving this
 * alias closed would have made two exported types disagree about which names
 * exist — a consumer could configure `"postmark"` and then be unable to type
 * the same value with the alias core exports for it.
 *
 * `(string & {})` rather than plain `string` so the literals still autocomplete;
 * widening to `string` alone collapses the union and drops that affordance.
 */
export type EmailProvider = "smtp" | "resend" | "sendlayer" | (string & {});

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

/**
 * Configuration for a provider registered by a plugin.
 *
 * `provider` names a registered type; everything else is that provider's own
 * configuration, which its `parseConfig` validates. Deliberately open — core
 * cannot know the shape of a provider it was never compiled against.
 *
 * `custom: true` is a required discriminant, not decoration. Without it this
 * branch is structurally `{ provider: string, ...anything }`, which also
 * matches a MALFORMED built-in: `{ provider: "smtp" }` with no host, port or
 * auth would satisfy the union and defer to a runtime failure an error the
 * compiler used to catch. The literal keeps the built-in shapes fully checked
 * while still admitting a provider core has never seen.
 *
 * @example
 * ```ts
 * email: {
 *   providerConfig: {
 *     custom: true,
 *     provider: "postmark",
 *     serverToken: process.env.POSTMARK_TOKEN!,
 *   },
 *   from: "Acme <noreply@example.com>",
 * }
 * ```
 */
export interface RegisteredProviderConfig {
  custom: true;
  provider: string;
  [key: string]: unknown;
}

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
/**
 * The code-first provider, and the address it sends from.
 *
 * Declared as a pair because the resolver treats them as one: `from` is read
 * ONLY inside the branch that builds an adapter from `providerConfig`, and a
 * database-managed provider carries its own `fromEmail`. So the two states that
 * exist are "a code-first provider, with its address" and "no code-first
 * provider at all" — and an install that manages providers in the admin UI is
 * squarely the second.
 *
 * Previously both were required, which made that second state unrepresentable:
 * such an install could not write `defineConfig({ email: { retention } })` to
 * bound or disable its delivery log without inventing a provider it never uses.
 * A configuration block whose only valid spelling includes a fiction is a
 * defect in the type, not a discipline for the user.
 *
 * A union rather than two optional fields, so `providerConfig` without `from`
 * still fails: that pair really is required together, and the resolver would
 * otherwise send from `undefined`.
 */
export type EmailProviderBlock =
  | {
      /**
       * Provider configuration. This is the code-first fallback —
       * database-managed providers take precedence when configured via the
       * admin UI.
       *
       * The three built-in shapes are named so they keep full checking and
       * autocomplete. `RegisteredProviderConfig` admits any type a plugin
       * registered: the resolver builds every provider through the registry, so
       * restricting this to the built-ins would have made a contributed
       * provider usable from the database and rejected by the compiler in
       * `defineConfig` — the same provider working or not depending on where it
       * was configured.
       */
      providerConfig:
        | SmtpConfig
        | ResendConfig
        | SendLayerConfig
        | RegisteredProviderConfig;

      /**
       * Default "from" address for all emails.
       * @example 'Nextly <noreply@example.com>'
       */
      from: string;
    }
  | { providerConfig?: undefined; from?: undefined };

export type EmailConfig = EmailProviderBlock & EmailSettings;

/** Everything in `email` that does not depend on where the provider comes from. */
export interface EmailSettings {
  /**
   * How long the delivery log keeps its rows.
   *
   * The log records who was written to, identified by a digest of their
   * address, so it is a record of people rather than of traffic — and it grows
   * on every send. Omitting this keeps the default window rather than keeping
   * rows forever, because an unbounded record of recipients is not a reasonable
   * default for a table an install fills without opting in.
   *
   * `false` keeps everything, at a single window or for the whole block, and is
   * stated rather than implied by absence.
   */
  retention?: EmailRetentionConfig | false;

  /**
   * Application name injected into templates and the shared layout as the
   * `{{appName}}` variable. Falls back to "Nextly" when not set.
   * @example 'Acme'
   */
  appName?: string;

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
    /**
     * Plain-text alternative body, sent alongside the HTML as a
     * `multipart/alternative` message. Optional so custom adapters that
     * predate this field keep compiling; built-in adapters forward it.
     */
    text?: string;
    /**
     * Reply-To address. Optional so custom adapters that predate this
     * field keep compiling; built-in adapters forward it when set.
     */
    replyTo?: string;
    /** CC email addresses. */
    cc?: string[];
    /** BCC email addresses. */
    bcc?: string[];
    /**
     * Attachments to include. Each entry is already resolved to raw
     * bytes — adapters forward to their provider's format.
     */
    attachments?: ResolvedAttachment[];
  }): Promise<{
    success: boolean;
    messageId?: string;
    /**
     * Addresses the provider refused, when it says so per recipient.
     *
     * SMTP answers `RCPT TO` one address at a time, so a server can accept the
     * message for some recipients and reject it for others while the send as a
     * whole succeeds. Without this the delivery log records every recipient as
     * `sent`, and a lookup would claim someone received a message that never
     * went to them — the one question that table exists to answer.
     *
     * Optional, because most API providers report a single outcome for the
     * message and have nothing per-recipient to say. Absent means "no
     * per-recipient detail", not "none rejected".
     *
     * Each entry must be a BARE MAILBOX — `user@example.com`, never
     * `Name <user@example.com>`. The consumer matches these against the
     * message's own recipients exactly, after trimming and lowercasing, so a
     * display-name form matches nothing and every recipient is recorded as
     * delivered. That failure is silent, which is why the shape is stated here
     * rather than left to the reader: this interface is what an adapter author
     * writes against.
     */
    rejected?: string[];
  }>;
}
