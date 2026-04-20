/**
 * Email Service
 *
 * Central orchestration layer for email sending. Resolves providers
 * (DB default > code-first config), resolves templates (DB > code-first
 * overrides), handles variable interpolation, layout composition,
 * and delegates to the appropriate provider adapter (SMTP, Resend,
 * SendLayer).
 *
 * @module services/email/email-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { ServiceError } from "../../../errors/service-error";
import { env } from "../../../lib/env";
import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { EmailAttachmentError, EmailErrorCode } from "../errors";
import type {
  EmailAttachmentInput,
  EmailConfig,
  EmailProviderAdapter,
  ResolvedAttachment,
} from "../types";

import { getAttachmentLimits } from "./attachment-limits";
import type {
  AttachmentMediaRecord,
  ResolveAttachmentsDeps,
} from "./attachment-resolver";
import { resolveAttachments } from "./attachment-resolver";
import type { EmailProviderService } from "./email-provider-service";
import type { EmailTemplateService } from "./email-template-service";
import { createResendProvider } from "./providers/resend-provider";
import { createSendLayerProvider } from "./providers/sendlayer-provider";
import { createSmtpProvider } from "./providers/smtp-provider";
import { mergeTemplateAttachments } from "./template-attachment-merge";
import { interpolateTemplate } from "./template-engine";

/**
 * Dependencies needed to resolve attachments from the media library.
 * Injected into `EmailService` so the service doesn't need to know
 * which concrete `MediaService` / storage adapter is in use.
 */
export interface EmailAttachmentSource {
  findMedia: (mediaId: string) => Promise<AttachmentMediaRecord | null>;
  readBytes: (storagePath: string) => Promise<Buffer>;
}

// ============================================================
// Slug-to-code-template key mapping
// ============================================================

/**
 * Maps DB template slugs to `EmailConfig.templates` keys.
 * Used for code-first template fallback resolution.
 */
const SLUG_TO_TEMPLATE_KEY: Record<
  string,
  keyof NonNullable<EmailConfig["templates"]>
> = {
  welcome: "welcome",
  "password-reset": "passwordReset",
  "email-verification": "emailVerification",
};

// ============================================================
// Email Service
// ============================================================

export class EmailService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly providerService: EmailProviderService,
    private readonly templateService: EmailTemplateService,
    private readonly emailConfig?: EmailConfig,
    private readonly attachmentSource?: EmailAttachmentSource
  ) {
    super(adapter, logger);
  }

  /**
   * Resolve caller-provided attachments into bytes-ready form.
   * Returns `undefined` when no attachments supplied. Throws
   * `EmailAttachmentError` on any validation or I/O failure — the
   * caller (or `send()`) lets that propagate.
   */
  private async resolveAttachmentsOrNone(
    inputs: EmailAttachmentInput[] | undefined
  ): Promise<ResolvedAttachment[] | undefined> {
    if (!inputs || inputs.length === 0) return undefined;
    if (!this.attachmentSource) {
      throw new EmailAttachmentError(
        EmailErrorCode.ATTACHMENT_STORAGE_READ_FAILED,
        "Email attachments are not supported in this configuration: no media storage wired to EmailService."
      );
    }
    const deps: ResolveAttachmentsDeps = {
      limits: getAttachmentLimits(),
      findMedia: this.attachmentSource.findMedia,
      readBytes: this.attachmentSource.readBytes,
    };
    return resolveAttachments(inputs, deps);
  }

  // ============================================================
  // Public Methods
  // ============================================================

  /**
   * Send an email using a named template.
   *
   * Resolution order for templates:
   * 1. DB template (by slug) — interpolates variables, composes with layout
   * 2. Code-first template override from `defineConfig({ email: { templates } })`
   * 3. Error if neither exists
   *
   * @param templateSlug - Template slug (e.g., "password-reset", "welcome")
   * @param to - Recipient email address
   * @param variables - Key-value pairs for `{{variable}}` placeholder replacement
   * @param options - Optional provider override
   * @returns Send result with success status and optional message ID
   */
  async sendWithTemplate(
    templateSlug: string,
    to: string,
    variables: Record<string, unknown>,
    options?: {
      providerId?: string;
      cc?: string[];
      bcc?: string[];
      attachments?: EmailAttachmentInput[];
    }
  ): Promise<{ success: boolean; messageId?: string }> {
    // 1. Try DB template first
    let dbTemplate: EmailTemplateRecord | null = null;
    try {
      dbTemplate = await this.templateService.getTemplateBySlug(templateSlug);
    } catch (error) {
      this.logger.warn(
        "Failed to look up email template from DB — will try code-first fallback",
        {
          slug: templateSlug,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (dbTemplate && dbTemplate.isActive) {
      // Interpolate subject (no HTML escaping — plain text)
      const subject = interpolateTemplate(dbTemplate.subject, variables, {
        escapeHtml: false,
      });

      // Interpolate body (HTML escaping for injected values)
      let html = interpolateTemplate(dbTemplate.htmlContent, variables);

      // Compose with layout if enabled
      if (dbTemplate.useLayout) {
        html = await this.composeWithLayout(dbTemplate, html, variables);
      }

      // Merge template-default attachments with per-send attachments.
      // Dedupe by mediaId — per-send entries win on conflict.
      const mergedAttachments = mergeTemplateAttachments(
        dbTemplate.attachments,
        options?.attachments
      );

      return this.send({
        to,
        subject,
        html,
        providerId: options?.providerId ?? dbTemplate.providerId ?? undefined,
        cc: options?.cc,
        bcc: options?.bcc,
        attachments:
          mergedAttachments.length > 0 ? mergedAttachments : undefined,
      });
    }

    // 2. Try code-first template override
    const templateKey = SLUG_TO_TEMPLATE_KEY[templateSlug];
    const codeFn = templateKey
      ? this.emailConfig?.templates?.[templateKey]
      : undefined;

    if (codeFn) {
      const result = codeFn({
        user: {
          name: (variables.userName as string) ?? null,
          email: to,
        },
        token: variables.token as string | undefined,
        url:
          (variables.resetLink as string) ?? (variables.verifyLink as string),
      });

      // Merge code-first template's default attachments with per-send
      // attachments (same rules as DB templates — per-send wins by
      // mediaId, combined list validated by the resolver).
      const mergedAttachments = mergeTemplateAttachments(
        result.attachments,
        options?.attachments
      );

      return this.send({
        to,
        subject: result.subject,
        html: result.html,
        providerId: options?.providerId,
        attachments:
          mergedAttachments.length > 0 ? mergedAttachments : undefined,
      });
    }

    // 3. Neither exists
    throw ServiceError.businessRule(
      `Email template "${templateSlug}" not found. Create it in the admin UI or provide a code-first override.`,
      { slug: templateSlug }
    );
  }

  /**
   * Send a raw email (no template).
   *
   * Provider resolution order:
   * 1. Specific provider by ID (if `providerId` is provided)
   * 2. DB default provider
   * 3. Code-first provider from `defineConfig({ email: { providerConfig } })`
   * 4. Error if no provider configured
   *
   * @param options - Email sending options
   * @returns Send result with success status and optional message ID
   */
  async send(options: {
    to: string;
    subject: string;
    html: string;
    plainText?: string;
    providerId?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: EmailAttachmentInput[];
  }): Promise<{ success: boolean; messageId?: string }> {
    // Resolve attachments BEFORE the provider try/catch so that
    // EmailAttachmentError (count/size/media-not-found/storage-read)
    // propagates to the caller instead of being swallowed into a
    // generic `{ success: false }` response.
    const resolvedAttachments = await this.resolveAttachmentsOrNone(
      options.attachments
    );

    const { adapter, from } = await this.resolveProvider(options.providerId);

    try {
      const result = await adapter.send({
        to: options.to,
        from,
        subject: options.subject,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        attachments: resolvedAttachments,
      });

      if (result.success) {
        this.logger.info("Email sent successfully", {
          to: options.to,
          subject: options.subject,
          messageId: result.messageId,
          cc: options.cc ?? [],
          bcc: options.bcc ?? [],
          attachmentCount: resolvedAttachments?.length ?? 0,
        });
      } else {
        this.logger.warn("Email send returned unsuccessful", {
          to: options.to,
          subject: options.subject,
        });
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to send email", {
        to: options.to,
        subject: options.subject,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false };
    }
  }

  // ============================================================
  // Convenience Methods for Auth Flows
  // ============================================================

  /**
   * Send a password reset email.
   *
   * Uses the `password-reset` template slug. Constructs the reset link
   * from the base URL + the configured reset password path.
   *
   * Path resolution (highest priority first):
   * 1. `options.path` (per-request override)
   * 2. `emailConfig.resetPasswordPath` (global config)
   * 3. `'/admin/reset-password'` (default)
   */
  async sendPasswordResetEmail(
    to: string,
    user: { name: string | null; email: string },
    token: string,
    options?: { path?: string }
  ): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const path =
      options?.path ??
      this.emailConfig?.resetPasswordPath ??
      "/admin/reset-password";
    const resetLink = `${baseUrl}${path}?token=${encodeURIComponent(token)}`;

    await this.sendWithTemplate("password-reset", to, {
      resetLink,
      expiresIn: "1 hour",
      appName: this.getAppName(),
      userName: user.name ?? user.email,
      userEmail: user.email,
      token,
      year: new Date().getFullYear().toString(),
    });
  }

  /**
   * Send an email verification email.
   *
   * Uses the `email-verification` template slug. Constructs the verify link
   * from the base URL + the configured verify email path.
   *
   * Path resolution (highest priority first):
   * 1. `options.path` (per-request override)
   * 2. `emailConfig.verifyEmailPath` (global config)
   * 3. `'/admin/verify-email'` (default)
   */
  async sendEmailVerificationEmail(
    to: string,
    user: { name: string | null; email: string },
    token: string,
    options?: { path?: string }
  ): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const path =
      options?.path ??
      this.emailConfig?.verifyEmailPath ??
      "/admin/verify-email";
    const verifyLink = `${baseUrl}${path}?token=${encodeURIComponent(token)}`;

    await this.sendWithTemplate("email-verification", to, {
      verifyLink,
      expiresIn: "24 hours",
      appName: this.getAppName(),
      userName: user.name ?? user.email,
      userEmail: user.email,
      token,
      year: new Date().getFullYear().toString(),
    });
  }

  /**
   * Send a welcome email.
   *
   * Uses the `welcome` template slug. When `verifyLink` is provided the
   * template includes a "Verify Email" button so the user can confirm
   * their address before logging in.
   */
  async sendWelcomeEmail(
    to: string,
    user: { name: string | null; email: string },
    options?: { verifyLink?: string }
  ): Promise<void> {
    await this.sendWithTemplate("welcome", to, {
      userName: user.name ?? user.email,
      appName: this.getAppName(),
      userEmail: user.email,
      verifyLink: options?.verifyLink ?? "",
      expiresIn: "24 hours",
      year: new Date().getFullYear().toString(),
    });
  }

  // ============================================================
  // Private: Provider Resolution
  // ============================================================

  /**
   * Resolve the provider adapter and "from" address.
   *
   * Priority:
   * 1. Specific DB provider (by ID)
   * 2. DB default provider
   * 3. Code-first config from `defineConfig({ email })`
   * 4. Error
   */
  private async resolveProvider(
    providerId?: string
  ): Promise<{ adapter: EmailProviderAdapter; from: string }> {
    // 1. Specific provider by ID
    if (providerId) {
      const provider =
        await this.providerService.getProviderDecrypted(providerId);
      return {
        adapter: this.createAdapterFromRecord(provider),
        from: this.formatFromAddress(
          provider.fromName ?? null,
          provider.fromEmail
        ),
      };
    }

    // 2. DB default provider
    try {
      const defaultProvider =
        await this.providerService.getDefaultProviderDecrypted();
      if (defaultProvider && defaultProvider.isActive) {
        return {
          adapter: this.createAdapterFromRecord(defaultProvider),
          from: this.formatFromAddress(
            defaultProvider.fromName ?? null,
            defaultProvider.fromEmail
          ),
        };
      }
    } catch (error) {
      // DB not ready (e.g., migrations not run yet) — fall through to code-first
      this.logger.warn(
        "Failed to look up default email provider from DB — trying code-first config",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // 3. Code-first config
    if (this.emailConfig?.providerConfig) {
      return {
        adapter: this.createAdapterFromConfig(this.emailConfig.providerConfig),
        from: this.emailConfig.from,
      };
    }

    // 4. No provider
    throw ServiceError.businessRule(
      "No email provider configured. Add a provider in Settings > Email Providers, or configure one in defineConfig({ email: { providerConfig } })."
    );
  }

  // ============================================================
  // Private: Template Layout Composition
  // ============================================================

  /**
   * Compose the final HTML by wrapping the interpolated template body
   * with the shared header/footer layout.
   *
   * Composition: headerHtml + interpolatedBody + footerHtml.
   * Variable interpolation applies to the header and footer parts
   * (e.g., `{{year}}`, `{{appName}}` in footer).
   */
  private async composeWithLayout(
    _template: EmailTemplateRecord,
    interpolatedBody: string,
    variables: Record<string, unknown>
  ): Promise<string> {
    const layout = await this.templateService.getLayout();

    // Ensure common layout variables are always available
    const layoutVars: Record<string, unknown> = {
      ...variables,
      year: variables.year ?? new Date().getFullYear().toString(),
      appName: variables.appName ?? this.getAppName(),
    };

    const header = interpolateTemplate(layout.header, layoutVars);
    const footer = interpolateTemplate(layout.footer, layoutVars);

    return header + interpolatedBody + footer;
  }

  // ============================================================
  // Private: Adapter Factories
  // ============================================================

  /**
   * Create a provider adapter from a DB provider record (decrypted).
   */
  private createAdapterFromRecord(record: {
    type: string;
    configuration: Record<string, unknown>;
  }): EmailProviderAdapter {
    const config = record.configuration;

    switch (record.type) {
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
        throw ServiceError.businessRule(
          `Unsupported email provider type: ${record.type}`
        );
    }
  }

  /**
   * Create a provider adapter from code-first config (`defineConfig()`).
   */
  private createAdapterFromConfig(
    providerConfig: NonNullable<EmailConfig["providerConfig"]>
  ): EmailProviderAdapter {
    switch (providerConfig.provider) {
      case "smtp":
        return createSmtpProvider({
          host: providerConfig.host,
          port: providerConfig.port,
          secure: providerConfig.secure,
          auth: providerConfig.auth,
        });
      case "resend":
        return createResendProvider({
          apiKey: providerConfig.apiKey,
        });
      case "sendlayer":
        return createSendLayerProvider({
          apiKey: providerConfig.apiKey,
        });
      default:
        throw ServiceError.businessRule(
          `Unsupported email provider: ${(providerConfig as { provider: string }).provider}`
        );
    }
  }

  // ============================================================
  // Private: Helpers
  // ============================================================

  /**
   * Get the base URL for email links.
   * Priority: emailConfig.baseUrl > NEXT_PUBLIC_APP_URL > localhost
   */
  private getBaseUrl(): string {
    const url =
      this.emailConfig?.baseUrl ??
      env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";

    // Remove trailing slash
    return url.replace(/\/$/, "");
  }

  /**
   * Get the application name for email templates.
   */
  private getAppName(): string {
    return "Nextly";
  }

  /**
   * Format a "from" address: `"Name <email>"` or just `"email"`.
   */
  private formatFromAddress(name: string | null, email: string): string {
    if (name) return `${name} <${email}>`;
    return email;
  }
}
