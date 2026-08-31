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
import {
  isRecognisedMessageId,
  mailboxOf,
  refusedMailboxes,
  messageIdWithoutRecipients,
  type EmailDeliveryRecipientKind,
} from "../delivery-record";
import { EmailErrorCode } from "../errors";
import { describeProviderFailure } from "../provider-definition";
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
import type { EmailDeliveryService } from "./email-delivery-service";
import { getEmailProviderRegistry } from "./email-provider-registry";
import type { EmailProviderService } from "./email-provider-service";
import type { EmailTemplateService } from "./email-template-service";
import { LOG_PROVIDER_TYPE } from "./providers/log-provider";
import { DEFAULT_APP_NAME, renderTemplate } from "./render-template";
import { mergeTemplateAttachments } from "./template-attachment-merge";
import { htmlToText, validateTemplateVariables } from "./template-engine";

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

/**
 * Every address a message actually went to, with the line it was on.
 *
 * The delivery log answers questions about a PERSON, and a person copied on a
 * message received it exactly as the primary recipient did — so recording only
 * `to` would answer "no record" for someone holding the message in their
 * inbox. The adapter is handed `cc` and `bcc`, so these are addresses that were
 * really dispatched to rather than ones that were merely requested.
 *
 * Read from the FILTERED payload, because `email.beforeSend` may add or remove
 * recipients and the log has to describe what was sent, not what was asked for.
 *
 * Duplicates are collapsed: the same address on two lines is one mailbox, and
 * two rows would double every count taken from this table.
 */
function deliveryRecipients(payload: {
  to: string;
  cc?: string[];
  bcc?: string[];
}): Array<{ to: string; recipientKind: EmailDeliveryRecipientKind }> {
  // Recorded as the MAILBOX, not the string the caller wrote. A provider
  // dispatches `Display Name <user@example.com>` to `user@example.com`, and so
  // does the person asking support whether a message arrived -- a hash of the
  // display form answers "no record" for a message that was sent. Nodemailer
  // reports refusals as bare mailboxes too, so the same normalisation is what
  // lets a refused recipient be matched at all.
  const seen = new Set<string>();
  const recipients: Array<{
    to: string;
    recipientKind: EmailDeliveryRecipientKind;
  }> = [];

  const add = (address: string, recipientKind: EmailDeliveryRecipientKind) => {
    const mailbox = mailboxOf(address);
    const key = mailbox.toLowerCase();
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    recipients.push({ to: mailbox, recipientKind });
  };

  add(payload.to, "to");
  for (const address of payload.cc ?? []) add(address, "cc");
  for (const address of payload.bcc ?? []) add(address, "bcc");

  return recipients;
}

export class EmailService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly providerService: EmailProviderService,
    private readonly templateService: EmailTemplateService,
    private readonly emailConfig?: EmailConfig,
    private readonly attachmentSource?: EmailAttachmentSource,
    /**
     * Where sends are recorded.
     *
     * Optional so an install that predates the delivery table -- or a test
     * that does not care -- still sends. A missing recorder means no record,
     * never a failed send: the log exists to observe delivery, and it must not
     * become a thing that can prevent it.
     */
    private readonly deliveries?: EmailDeliveryService
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

      // One composition, shared with every preview surface. Resolving WHICH
      // layout wraps this template needs the database; composing with it does
      // not, so only the resolution stays here.
      const layout = dbTemplate.useLayout
        ? await this.templateService.getLayoutFor(dbTemplate)
        : null;

      const {
        subject,
        html,
        text: plainText,
      } = renderTemplate(dbTemplate, layout, variables, {
        appName: this.getAppName(),
      });

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
        // Which template this was, for the delivery log. Without it every
        // password reset, verification and welcome message -- the entire
        // reason the log exists -- records no template at all.
        templateSlug,
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
        templateSlug,
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
    /**
     * Which template produced this message, for the delivery log.
     *
     * The SLUG, never the rendered subject: a slug says which kind of message
     * this was and cannot carry a name, while a rendered subject is the field
     * most likely to interpolate one.
     */
    templateSlug?: string;
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
      resolvedProviderId,
    } = await this.resolveProviderForSend(options.providerId);

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
    // Two variables rather than one, because they answer different questions
    // and only one of them can be answered immediately. `accepted` is the fact
    // that the provider took the message; `dispatched` is the response, which
    // needs values derived after the answer -- the refused set, the recipient
    // list, a message id that has been checked for leaked credentials.
    //
    // Deriving any of those can throw, and while the fact lived in the
    // response it could not be recorded until they had all succeeded. A
    // failure in between then reached the catch as though the provider had
    // refused: a full set of `failed` rows, an after-send action told the send
    // failed, and an auth flow withholding a token for a message that was
    // delivered.
    let providerVerdict: boolean | undefined;
    let dispatched: { success: boolean; messageId?: string } | undefined;

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

      // The provider has answered, and WHAT it answered. Both are recorded
      // here: a later throw must not be able to turn a refusal into a success
      // any more than it can turn an acceptance into a failure. Storing only
      // "it answered" and defaulting to success would have an auth flow
      // withhold its undelivered-token fallback for a message the provider
      // said it did not send.
      providerVerdict = result.success === true;

      // Recorded inline rather than through the after-send action seam, and
      // BEFORE it. That seam exists for PLUGIN side-effects -- ordered,
      // isolated, and registered by whoever installs one -- and core's own
      // durable record of what it sent must not depend on a registry a plugin
      // also writes into. Isolation is not enough on its own: `runActions`
      // awaits each handler in turn, so a handler that blocks on network I/O
      // long enough for the request to be torn down loses the record of a
      // message the provider has already accepted. Writing first means the row
      // exists whatever a plugin does afterwards.
      // Per recipient, not per message. SMTP answers `RCPT TO` one address at
      // a time, so a server can accept the message for some recipients and
      // refuse it for others while the send as a whole succeeds -- and a row
      // saying `sent` for a refused address is a wrong answer to the one
      // question this table exists to answer.
      const refused = refusedMailboxes(result.rejected);
      const recipients = deliveryRecipients(filtered);
      // A provider is handed `options.to` and may build its identifier out of
      // it. The error string is redacted for exactly that reason, and an id
      // like `delivery-user@example.com` carries a recipient into every place
      // this value goes: the delivery row, the response both send routes
      // spread it into, the after-send actions, and the log. An
      // `email.beforeSend` filter can add a BCC the caller never wrote, so the
      // address is not always one the reader already knows.
      //
      // Computed once and used for all four, so the value the caller reads,
      // the value an action receives, the value in the log and the value in
      // the delivery row cannot diverge. Four sanitisations could.
      //
      // Compared against the ACTUAL mailboxes rather than redacted by shape:
      // a Message-ID legitimately contains an `@`, so address-shaped redaction
      // would destroy every RFC-form id while catching nothing else.
      // Two ways an id can carry something it should not: out of the envelope,
      // and out of the body. The adapter is handed both.
      // Kept only if it is SHAPED like an identifier, and then only if it
      // carries nothing this message was built from that is KNOWN here. The
      // shape rule stands in for the question that has no exact answer --
      // whether the id came out of the body -- while the addresses and the
      // attachment filenames are values in scope, so those are compared
      // exactly rather than guessed at.
      const safeMessageId = isRecognisedMessageId(result.messageId)
        ? messageIdWithoutRecipients(
            result.messageId,
            recipients.map(recipient => recipient.to),
            (resolvedAttachments ?? []).map(attachment => attachment.filename)
          )
        : null;

      /**
       * Whether the message reached the address the caller addressed it to.
       *
       * SMTP answers `RCPT TO` per address, so a server can accept a message
       * for a CC -- including one an `email.beforeSend` filter added, which
       * the caller never asked for -- while refusing the primary recipient,
       * and the message-level result still says it succeeded. `AuthService`
       * assigns this value to `delivered` and withholds a password-reset
       * token from the response on the strength of it, so reporting that send
       * as successful leaves someone who received nothing with no way to
       * continue.
       *
       * The delivery rows are already per-recipient and say `failed` for that
       * address. This makes the value every OTHER sink reads agree with them.
       */
      const deliveredToCaller =
        result.success &&
        !recipients.some(
          recipient =>
            recipient.recipientKind === "to" &&
            refused.has(recipient.to.trim().toLowerCase())
        );

      // The provider has answered. Everything below this line is bookkeeping
      // about a message that was already handed over, and the catch beneath
      // the whole block reports a PROVIDER failure -- so an installed logger
      // that throws, or a recorder that does, would otherwise write a second
      // set of failed rows, run the after-send actions again with
      // `success: false`, and tell the caller a delivered message failed.
      dispatched = {
        success: deliveredToCaller,
        ...(safeMessageId !== null ? { messageId: safeMessageId } : {}),
      };

      await this.deliveries?.recordAll(
        recipients.map(recipient => {
          const wasRefused = refused.has(recipient.to.trim().toLowerCase());
          const delivered = result.success && !wasRefused;
          return {
            ...recipient,
            providerId: resolvedProviderId ?? null,
            providerType,
            templateSlug: options.templateSlug ?? null,
            status: delivered ? ("sent" as const) : ("failed" as const),
            messageId: safeMessageId,
            error: delivered
              ? null
              : wasRefused
                ? "Recipient refused by the provider"
                : "Send returned unsuccessful",
          };
        })
      );

      // D63 action seam: ordered, isolated side-effects after a send attempt.
      await registry.runActions<EmailAfterSendValue, EmailFilterContext>(
        FilterSeams.EmailAfterSend,
        {
          to: filtered.to,
          subject: filtered.subject,
          success: deliveredToCaller,
          messageId: safeMessageId ?? undefined,
        },
        { providerId: options.providerId }
      );

      const durationMs = Date.now() - startedAt;
      if (deliveredToCaller) {
        // Stable, greppable send record for terminal / log-aggregator use.
        // Do not log recipient PII (addresses/subject). Counts keep the record
        // useful for a log aggregator without persisting personal data.
        this.logger.info("email.sent", {
          event: "email.sent",
          provider: providerType,
          messageId: safeMessageId,
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
          // A refused primary recipient and a provider-level failure are
          // different operational problems: one is an address the server would
          // not take, the other is the send itself.
          reason: result.success
            ? "primary recipient refused"
            : "provider returned unsuccessful",
        });
      }

      // Constructed, never the adapter's object. `send`'s declared return type
      // has only these two fields, but returning `result` hands back whatever
      // the provider put on it -- and both send routes spread that straight
      // into an HTTP response. `rejected` carries addresses, including BCC
      // recipients an `email.beforeSend` filter added, and a contributed
      // provider can put anything else there while holding decrypted
      // configuration. What this method promises is what it returns.
      return {
        success: deliveredToCaller,
        ...(safeMessageId !== null ? { messageId: safeMessageId } : {}),
      };
    } catch (error) {
      // The message was already accepted, so this is not a provider failure
      // however it reached here. Reporting one would contradict the rows and
      // the action that have already gone out, and would tell an auth flow to
      // withhold a token for a mail that was sent.
      if (providerVerdict !== undefined) {
        // The diagnostic is isolated because the thing it is describing may be
        // the logger itself: a transport that threw once will throw again, and
        // letting it do so here would reject an accepted send for the second
        // time in the same catch -- putting back exactly the outcome this
        // branch exists to prevent.
        try {
          this.logger.error("email.after_send_failed", {
            event: "email.after_send_failed",
            provider: providerType,
            ...describeProviderFailure(error),
          });
        } catch {
          // Nowhere left to report it: the reporter is what failed. The send
          // stands, which is the fact that matters to the caller.
        }
        // Absent when the throw landed between the provider's answer and the
        // point the response was built. The provider's own verdict stands --
        // reporting a failure because an identifier could not be assembled is
        // the outcome this branch exists to prevent, and reporting a success
        // the provider never claimed is the outcome the verdict prevents.
        //
        // No identifier travels with it: the one the provider returned has not
        // been through the check that keeps a credential or a recipient out of
        // it, and an unchecked id is the thing that check exists to stop.
        return dispatched ?? { success: providerVerdict };
      }

      // Recorded before the action seam, for the reason given in the success
      // path: a plugin handler that blocks must not be able to cost us the
      // record of an attempt. A throw here is the case where the record
      // matters most, since it is the only durable trace of the failure.
      await this.deliveries?.recordAll(
        deliveryRecipients(filtered).map(recipient => ({
          ...recipient,
          providerId: resolvedProviderId ?? null,
          providerType,
          templateSlug: options.templateSlug ?? null,
          status: "failed" as const,
          // The NORMALISED message, never the cause. `cause` is the provider's
          // original error, and a contributed provider throws it with
          // decrypted configuration in scope -- `Invalid key ${config.apiKey}`
          // is an easy thing to write. Storing it would put a credential in a
          // database column, which is the same disclosure the provider wrapper
          // closes for responses, arriving by a longer route and persisting.
          //
          // Redaction cannot substitute for this: it removes address-shaped
          // text, and an API key is not address-shaped.
          //
          // The cause is not lost -- the log line below records it, which is
          // where a provider's own diagnostic belongs.
          error: describeProviderFailure(error).message,
        }))
      );

      // D63 action seam: ordered, isolated side-effects after a send attempt.
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
        // The cause too, not just the message. A provider's own diagnostic --
        // an SMTP status line, an API error code -- is moved onto `cause` when
        // its failure is normalised, so a log reading only `message` records
        // the generic sentence and loses the one fact worth having.
        ...describeProviderFailure(error),
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
   *
   * Returns the send result rather than `void`. `send()` converts a provider
   * throw into `{ success: false }` instead of propagating it, so a caller that
   * only awaits this cannot tell a failed delivery from a completed one — and
   * for an auth flow that difference decides what the user is told. Callers
   * that genuinely do not care may still ignore the value.
   */
  async sendPasswordResetEmail(
    to: string,
    user: { name: string | null; email: string },
    token: string,
    options?: { path?: string }
  ): Promise<{ success: boolean; messageId?: string }> {
    const baseUrl = this.getBaseUrl();
    const path =
      options?.path ??
      this.emailConfig?.resetPasswordPath ??
      "/admin/reset-password";
    const resetLink = `${baseUrl}${path}?token=${encodeURIComponent(token)}`;

    return this.sendWithTemplate("password-reset", to, {
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
   *
   * Returns the send result rather than `void`. `send()` converts a provider
   * throw into `{ success: false }` instead of propagating it, so a caller that
   * only awaits this cannot tell a failed delivery from a completed one — and
   * for an auth flow that difference decides what the user is told. Callers
   * that genuinely do not care may still ignore the value.
   */
  async sendEmailVerificationEmail(
    to: string,
    user: { name: string | null; email: string },
    token: string,
    options?: { path?: string }
  ): Promise<{ success: boolean; messageId?: string }> {
    const baseUrl = this.getBaseUrl();
    const path =
      options?.path ??
      this.emailConfig?.verifyEmailPath ??
      "/admin/verify-email";
    const verifyLink = `${baseUrl}${path}?token=${encodeURIComponent(token)}`;

    return this.sendWithTemplate("email-verification", to, {
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
   *
   * Returns the send result rather than `void`. `send()` converts a provider
   * throw into `{ success: false }` instead of propagating it, so a caller that
   * only awaits this cannot tell a failed delivery from a completed one — and
   * for an auth flow that difference decides what the user is told. Callers
   * that genuinely do not care may still ignore the value.
   */
  async sendWelcomeEmail(
    to: string,
    user: { name: string | null; email: string },
    options?: { verifyLink?: string }
  ): Promise<{ success: boolean; messageId?: string }> {
    return this.sendWithTemplate("welcome", to, {
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
  /**
   * The provider a send will actually use, falling back to the log transport.
   *
   * Deliberately separate from `resolveProvider`. Auth calls `isConfigured()`
   * to decide whether to return a password-reset token in the response, and
   * `isConfigured` answers by asking `resolveProvider` whether anything is
   * configured. Putting the fallback in that method would make the answer
   * permanently yes and silently change the auth branch, so the fallback lives
   * only on the path that sends.
   */
  private async resolveProviderForSend(providerId?: string): Promise<{
    adapter: EmailProviderAdapter;
    from: string;
    providerType: string;
    resolvedProviderId?: string;
  }> {
    try {
      return await this.resolveProvider(providerId);
    } catch (error) {
      // A specific provider was asked for and could not be resolved: that is a
      // real failure, not an unconfigured install, so it must not be swallowed
      // into a log write that reports success.
      if (providerId !== undefined) throw error;

      const definition = getEmailProviderRegistry().get(LOG_PROVIDER_TYPE);

      return {
        adapter: definition.createAdapterFrom({}),
        // Nothing configured a sender, so the address only has to be valid and
        // obviously local. A caller-supplied `from` still wins downstream.
        from: this.emailConfig?.from ?? "nextly@localhost",
        providerType: LOG_PROVIDER_TYPE,
      };
    }
  }

  private async resolveProvider(providerId?: string): Promise<{
    adapter: EmailProviderAdapter;
    from: string;
    providerType: string;
    /**
     * The stored provider this resolved to, when a stored one was used.
     *
     * The caller's `providerId` is not the same fact: a send that names no
     * provider still uses the database DEFAULT, and recording `null` for those
     * would leave most of a provider's history unattached to it — which is the
     * majority of sends, not an edge case.
     */
    resolvedProviderId?: string;
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
        resolvedProviderId: provider.id,
      };
    }

    // 2. DB default provider.
    //
    // The catch covers the LOOKUP only. Adapter construction now validates the
    // stored configuration, and a validation failure is not a reason to fall
    // through: a default whose configuration no longer parses would otherwise
    // send silently through the code-first account instead, or report "no
    // provider configured" when one is plainly selected. Falling back is right
    // for a database that is not ready yet; it is wrong for a default that is
    // there and broken.
    let defaultProvider: Awaited<
      ReturnType<EmailProviderService["getDefaultProviderDecrypted"]>
    > = null;
    try {
      defaultProvider =
        await this.providerService.getDefaultProviderDecrypted();
    } catch (error) {
      this.logger.warn(
        "Failed to look up default email provider from DB — trying code-first config",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (defaultProvider && defaultProvider.isActive) {
      // Outside the try: a throw here means the selected default is unusable,
      // and the caller needs to hear that rather than have another account
      // substituted for it.
      return {
        adapter: this.createAdapterFromRecord(defaultProvider),
        from: this.formatFromAddress(
          defaultProvider.fromName ?? null,
          defaultProvider.fromEmail
        ),
        providerType: defaultProvider.type,
        resolvedProviderId: defaultProvider.id,
      };
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
    });
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
    // Resolved through the registry, exactly as a database-stored provider is.
    // A hardcoded switch here meant a plugin could register a provider that was
    // dispatchable from the admin and unusable from defineConfig -- the same
    // provider working or not depending on where it was configured.
    //
    // `provider` names the type; the rest of the object is its configuration,
    // which the registered provider validates before building anything.
    // `custom` is the union's discriminant, present only on the plugin branch
    // and never part of a provider's own configuration, so it is dropped before
    // parseConfig sees it. Narrowed rather than destructured off the union,
    // since the built-in shapes do not carry the key at all.
    const { provider, ...rest } = providerConfig;
    const configuration =
      "custom" in providerConfig
        ? Object.fromEntries(
            Object.entries(rest).filter(([key]) => key !== "custom")
          )
        : rest;

    return getEmailProviderRegistry().create(provider, configuration);
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
    return this.emailConfig?.appName ?? DEFAULT_APP_NAME;
  }

  /**
   * Format a "from" address: `"Name <email>"` or just `"email"`.
   */
  private formatFromAddress(name: string | null, email: string): string {
    if (name) return `${name} <${email}>`;
    return email;
  }
}
