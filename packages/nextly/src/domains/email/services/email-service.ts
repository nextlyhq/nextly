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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors";
import {
  getFilterRegistry,
  FilterSeams,
  type EmailPayloadFilterValue,
  type EmailFilterContext,
  type EmailAfterSendValue,
} from "../../../filters";
import { getBaseUrl } from "../../../lib/get-base-url";
import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { EmailErrorCode } from "../errors";
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
import { getEmailProviderRegistry } from "./email-provider-registry";
import type { EmailProviderService } from "./email-provider-service";
import type { EmailTemplateService } from "./email-template-service";
import { createResendProvider } from "./providers/resend-provider";
import { createSendLayerProvider } from "./providers/sendlayer-provider";
import { createSmtpProvider } from "./providers/smtp-provider";
import { mergeTemplateAttachments } from "./template-attachment-merge";
import {
  htmlToText,
  interpolateTemplate,
  validateTemplateVariables,
} from "./template-engine";

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
   * `NextlyError` (validation for caller-fixable failures, internal for
   * storage I/O) on any failure — the caller (or `send()`) lets that
   * propagate.
   */
  private async resolveAttachmentsOrNone(
    inputs: EmailAttachmentInput[] | undefined
  ): Promise<ResolvedAttachment[] | undefined> {
    if (!inputs || inputs.length === 0) return undefined;
    if (!this.attachmentSource) {
      throw NextlyError.internal({
        logContext: {
          emailAttachmentCode: EmailErrorCode.ATTACHMENT_STORAGE_READ_FAILED,
          reason: "no-attachment-source",
        },
      });
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
   * @param options - Optional provider/address overrides. Per-send `from` and
   *   `replyTo` take precedence over the template's own overrides: the caller
   *   knows the concrete send context (e.g. a form rule's sender), while the
   *   template override is a static default.
   * @returns Send result with success status and optional message ID
   */
  async sendWithTemplate(
    templateSlug: string,
    to: string,
    variables: Record<string, unknown>,
    options?: {
      providerId?: string;
      from?: string;
      replyTo?: string;
      cc?: string[];
      bcc?: string[];
      attachments?: EmailAttachmentInput[];
    }
  ): Promise<{ success: boolean; messageId?: string }> {
    // Whitespace-only overrides must not shadow the template/provider
    // defaults or reach a provider as malformed headers.
    const fromOverride = options?.from?.trim() || undefined;
    const replyToOverride = options?.replyTo?.trim() || undefined;

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
      // Surface missing required variables without blocking the send — the
      // authoring UI validates at edit time, and existing sends must not
      // start failing on data that previously rendered (blank).
      const validation = validateTemplateVariables(
        dbTemplate.variables,
        variables
      );
      if (!validation.valid) {
        this.logger.warn(
          "Email template sent with missing required variables — they render blank",
          { slug: templateSlug, missing: validation.missing }
        );
      }

      // Interpolate subject (no HTML escaping — plain text)
      const subject = interpolateTemplate(dbTemplate.subject, variables, {
        escapeHtml: false,
      });

      // Interpolate body (HTML escaping for injected values)
      let html = interpolateTemplate(dbTemplate.htmlContent, variables);

      // Plain-text alternative: use the template's own text if authored
      // (interpolated, no HTML escaping); otherwise derive it from the body
      // BEFORE the preheader/layout are spliced in, so the hidden preheader div
      // never leaks into the text mail as duplicated preview text.
      const plainText = dbTemplate.plainTextContent?.trim()
        ? interpolateTemplate(dbTemplate.plainTextContent, variables, {
            escapeHtml: false,
          })
        : htmlToText(html);

      // Prepend a hidden preheader (inbox preview line) when authored.
      if (dbTemplate.preheader?.trim()) {
        const preheader = interpolateTemplate(dbTemplate.preheader, variables);
        html = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>${html}`;
      }

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
        plainText,
        from: fromOverride ?? dbTemplate.fromOverride ?? undefined,
        replyTo: replyToOverride ?? dbTemplate.replyTo ?? undefined,
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
        // Forward cc/bcc/from/replyTo here too — the DB-template path already
        // does, and omitting them on this branch silently dropped them for
        // code-first templates.
        from: fromOverride,
        replyTo: replyToOverride,
        cc: options?.cc,
        bcc: options?.bcc,
        attachments:
          mergedAttachments.length > 0 ? mergedAttachments : undefined,
      });
    }

    // 3. Neither exists — keep the public sentence free of identifiers per
    // spec §13.8; the slug goes to logContext for operators.
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "Email template not found. Create it in the admin UI or provide a code-first override.",
      statusCode: 422,
      logContext: { slug: templateSlug },
    });
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
    /** Override the resolved provider From (e.g. a per-template From). */
    from?: string;
    /** Reply-To header. Omitted when not set. */
    replyTo?: string;
    providerId?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: EmailAttachmentInput[];
  }): Promise<{ success: boolean; messageId?: string }> {
    // Resolve attachments BEFORE the provider try/catch so that
    // NextlyError (validation for caller-fixable failures, internal for
    // storage I/O — see attachment-resolver) propagates to the caller
    // instead of being swallowed into a generic `{ success: false }`
    // response.
    const resolvedAttachments = await this.resolveAttachmentsOrNone(
      options.attachments
    );

    const {
      adapter,
      from: resolvedFrom,
      providerType,
    } = await this.resolveProvider(options.providerId);

    // A per-template From override wins over the provider's default From.
    const from = options.from?.trim() ? options.from : resolvedFrom;

    const registry = getFilterRegistry();

    // D63 seam: let plugins transform the assembled email payload before dispatch.
    // Outside try/catch intentionally — the filter registry isolates per-handler
    // throws and never propagates, so a buggy plugin can't break sending.
    // Always ship a plain-text alternative (multipart/alternative) — use the
    // caller-supplied text, else derive one from the HTML. HTML-only mail
    // hurts deliverability and breaks text-only clients.
    const plainText = options.plainText?.trim()
      ? options.plainText
      : htmlToText(options.html);

    const filtered = await registry.applyFilters<
      EmailPayloadFilterValue,
      EmailFilterContext
    >(
      FilterSeams.EmailBeforeSend,
      {
        to: options.to,
        from,
        subject: options.subject,
        html: options.html,
        text: plainText,
        cc: options.cc,
        bcc: options.bcc,
      },
      { providerId: options.providerId }
    );

    const startedAt = Date.now();
    try {
      const result = await adapter.send({
        to: filtered.to,
        from: filtered.from,
        subject: filtered.subject,
        html: filtered.html,
        text: filtered.text,
        replyTo: options.replyTo,
        cc: filtered.cc,
        bcc: filtered.bcc,
        attachments: resolvedAttachments,
      });

      // D63 action seam: ordered, isolated side-effects after a send attempt.
      await registry.runActions<EmailAfterSendValue, EmailFilterContext>(
        FilterSeams.EmailAfterSend,
        {
          to: filtered.to,
          subject: filtered.subject,
          success: result.success,
          messageId: result.messageId,
        },
        { providerId: options.providerId }
      );

      const durationMs = Date.now() - startedAt;
      if (result.success) {
        // Stable, greppable send record for terminal / log-aggregator use.
        // Do not log recipient PII (addresses/subject). Counts keep the record
        // useful for a log aggregator without persisting personal data.
        this.logger.info("email.sent", {
          event: "email.sent",
          provider: providerType,
          messageId: result.messageId,
          durationMs,
          ccCount: options.cc?.length ?? 0,
          bccCount: options.bcc?.length ?? 0,
          attachmentCount: resolvedAttachments?.length ?? 0,
        });
      } else {
        this.logger.warn("email.failed", {
          event: "email.failed",
          provider: providerType,
          durationMs,
          reason: "provider returned unsuccessful",
        });
      }

      return result;
    } catch (error) {
      await registry.runActions<EmailAfterSendValue, EmailFilterContext>(
        FilterSeams.EmailAfterSend,
        {
          to: filtered.to,
          subject: filtered.subject,
          success: false,
          messageId: undefined,
        },
        { providerId: options.providerId }
      );
      this.logger.error("email.failed", {
        event: "email.failed",
        provider: providerType,
        durationMs: Date.now() - startedAt,
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

  /**
   * Whether this instance can actually send mail.
   *
   * Asking is otherwise only possible by trying: `resolveProvider` throws when
   * nothing is configured, so a caller that merely wants to know had to catch
   * the failure — and a caught failure is one nobody sees. Creating a user
   * whose only way in arrives by email needs to know before the user exists,
   * not after.
   */
  async isConfigured(): Promise<boolean> {
    try {
      await this.resolveProvider();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether a specific template could be sent right now.
   *
   * A template may name its own provider, and `sendWithTemplate` prefers it
   * over the default — so "is anything configured" is the wrong question for a
   * caller about to send one particular template. An install whose only
   * provider is the one that template names would answer no to `isConfigured`
   * and still send perfectly well.
   *
   * Resolves the provider by the same precedence as the send itself, so the
   * answer matches what would happen. A template that cannot be looked up, or
   * is inactive, falls through to the default — again as the send does.
   */
  async canSendTemplate(templateSlug: string): Promise<boolean> {
    let providerId: string | undefined;

    try {
      const template =
        await this.templateService.getTemplateBySlug(templateSlug);
      if (template?.isActive) {
        providerId = template.providerId ?? undefined;
      }
    } catch {
      // The template lookup failing is not an answer about the provider: the
      // send would fall back to the default here, so ask about that instead.
    }

    try {
      await this.resolveProvider(providerId);
      return true;
    } catch {
      return false;
    }
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
  private async resolveProvider(providerId?: string): Promise<{
    adapter: EmailProviderAdapter;
    from: string;
    providerType: string;
  }> {
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
        providerType: provider.type,
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
          providerType: defaultProvider.type,
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
        providerType: this.emailConfig.providerConfig.provider,
      };
    }

    // 4. No provider — operator-actionable public message; no identifiers
    // involved here, so logContext stays empty.
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "No email provider configured. Add a provider in Settings > Email Providers, or configure one in defineConfig({ email: { providerConfig } }).",
      statusCode: 422,
    });
  }

  // ============================================================
  // Private: Template Layout Composition
  // ============================================================

  /**
   * Compose the final HTML by injecting the interpolated template body
   * into its resolved layout at the `{{content}}` placeholder. The
   * layout's own `{{year}}` / `{{appName}}` placeholders are filled;
   * the body is spliced in verbatim. Returns the body unchanged when
   * no layout exists.
   */
  private async composeWithLayout(
    template: EmailTemplateRecord,
    interpolatedBody: string,
    variables: Record<string, unknown>
  ): Promise<string> {
    const layout = await this.templateService.getLayoutFor(template);
    if (!layout) return interpolatedBody;

    // Ensure common layout variables are always available
    const layoutVars: Record<string, unknown> = {
      ...variables,
      year: variables.year ?? new Date().getFullYear().toString(),
      appName: variables.appName ?? this.getAppName(),
    };

    return this.templateService.renderWithLayout(
      layout,
      interpolatedBody,
      layoutVars
    );
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

    // Built-ins + plugin-contributed provider types (C2/D65). Unknown type →
    // BUSINESS_RULE_VIOLATION (raised by the registry).
    return getEmailProviderRegistry().create(record.type, config);
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
        // Untrusted-ish: provider value from defineConfig(). Identifier still
        // belongs in logContext; the public message stays generic.
        throw new NextlyError({
          code: "BUSINESS_RULE_VIOLATION",
          publicMessage: "Unsupported email provider.",
          statusCode: 422,
          logContext: {
            provider: (providerConfig as { provider: string }).provider,
          },
        });
    }
  }

  // ============================================================
  // Private: Helpers
  // ============================================================

  /**
   * Get the base URL for email links. Delegates to the shared `getBaseUrl`
   * helper so email templates and absolutized media URLs resolve through
   * the same priority chain (emailConfig.baseUrl > NEXT_PUBLIC_APP_URL >
   * localhost).
   */
  private getBaseUrl(): string {
    return getBaseUrl(this.emailConfig?.baseUrl);
  }

  /**
   * Get the application name for email templates.
   */
  private getAppName(): string {
    return this.emailConfig?.appName ?? "Nextly";
  }

  /**
   * Format a "from" address: `"Name <email>"` or just `"email"`.
   */
  private formatFromAddress(name: string | null, email: string): string {
    if (name) return `${name} <${email}>`;
    return email;
  }
}
