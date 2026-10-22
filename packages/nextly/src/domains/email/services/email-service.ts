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
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { toDbError } from "../../../database/errors";
import { getStaticRelations } from "../../../database/static-relations";
import { NextlyError } from "../../../errors";
import {
  getFilterRegistry,
  FilterSeams,
  type EmailPayloadFilterValue,
  type EmailFilterContext,
  type EmailAfterSendValue,
} from "../../../filters";
import { env } from "../../../lib/env";
import { getBaseUrl } from "../../../lib/get-base-url";
import { maskingServiceLogger } from "../../../observability/mask-emails";
import { linkedTransaction } from "../../../plugins/database/plugin-transaction-link";
import {
  isStaffPersonId,
  principalRefOf,
  staffPerson,
  staffPersonOf,
} from "../../../plugins/principals/ref";
import { getPrincipalKind } from "../../../plugins/principals/registry";
import type { PrincipalRef } from "../../../plugins/principals/types";
import type { TxOption } from "../../../plugins/security/one-time-secrets";
import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { assertNoOpenTransaction } from "../../../shared/lib/open-transaction";
import { requireFilterValue } from "../../../shared/lib/require-filter-value";
import { runAdapterTransaction } from "../../../shared/lib/run-adapter-transaction";
import { pluginSettingsSecrets } from "../../plugins/settings-service";
import { warnQuietly } from "../../retention/safe-log";
import {
  isRecognisedMessageId,
  mailboxOf,
  refusedMailboxes,
  messageIdWithoutRecipients,
  type EmailDeliveryInput,
  type EmailDeliveryRecipientKind,
} from "../delivery-record";
import { EmailErrorCode } from "../errors";
import {
  type EmailFailure,
  noAnswerFailure,
  withEmailFailure,
} from "../failure";
import { describeProviderFailure } from "../provider-definition";
import { warnAboutLateQueuedEmail } from "../queued-email-warning";
import {
  type QueuedEmail,
  type QueuedEmailState,
  type QueuedMessage,
  queuedEmailState,
  storeQueuedEmail,
} from "../queued-send";
import {
  assertIdempotencyKey,
  CORE_KEY_SCOPE,
  sendKeyOf,
  type HeldClaim,
} from "../send-claims";
import {
  CALL_DEADLINE_MS,
  LEASE_LIMIT_MS,
  LEASE_RENEWAL_MS,
} from "../send-timing";
import {
  renderTemplateFrom,
  renderTemplateReplyTo,
  withTemplateCopies,
} from "../template-envelope";
import { CODE_TEMPLATE_KEYS, sendSource } from "../template-ownership";
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
import {
  type CallOutcome,
  pendingEnvelope,
  sendResultOf,
  slotsOf,
} from "./recipient-outcomes";
import {
  assertSendable,
  assertSendableReplyTo,
  declaredMaxTo,
  filteredToList,
  firstAddress,
  recipientsOf,
  messagesFor,
  toAddressList,
  type SendEnvelope,
  type SendMessage,
} from "./recipients";
import { DEFAULT_APP_NAME } from "./render-template";
import {
  answeredFailure,
  type EmailSendOutcome,
  inProgressFailure,
  notAcceptedFailure,
  refusalOf,
  refusedRecipients,
  refusedRecordError,
  type RefusedRecipient,
  thrownFailure,
} from "./send-failures";
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
  to: readonly string[];
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

  for (const address of payload.to) add(address, "to");
  for (const address of payload.cc ?? []) add(address, "cc");
  for (const address of payload.bcc ?? []) add(address, "bcc");

  return recipients;
}

/** What a send, or one message of it, reports to the caller. */
type SendOutcome = EmailSendOutcome;

/** What one message's dispatch needs beyond the message itself. */
interface DispatchContext {
  adapter: EmailProviderAdapter;
  providerType: string;
  resolvedProviderId?: string;
  providerId?: string;
  templateSlug?: string;
  person: PrincipalRef | null;
  resolvedAttachments?: ResolvedAttachment[];
  /** The claim a keyed send holds, and the key its calls are derived from. */
  keyed?: KeyedSend;
  /** Runs, or queues, the `email.afterSend` actions for this message. */
  afterSend: (value: EmailAfterSendValue) => Promise<void>;
  /**
   * Writes, or keeps for the claim's commit, this message's delivery
   * records. Never throws.
   */
  record: (rows: EmailDeliveryInput[]) => Promise<void>;
}

/** A keyed send's claim, while it sends. */
interface KeyedSend {
  claim: HeldClaim;
  /** Push the claim's lease on, before each provider call. */
  renew(): Promise<void>;
}

/**
 * What a dispatch knows once the provider has answered: its verdict, and the
 * response once it has been built. Shared with the catch, so a throw in the
 * bookkeeping after the answer reports what the provider said.
 */
interface DispatchState {
  verdict?: boolean;
  dispatched?: SendOutcome;
}

/** The message as the adapter is handed it. */
function adapterMessage(
  message: SendMessage,
  context: DispatchContext
): Parameters<EmailProviderAdapter["send"]>[0] {
  const attachments = context.resolvedAttachments;
  return {
    // Only to an adapter that declares it takes one, so every other adapter
    // is handed exactly what it was before keys existed.
    ...(context.keyed && context.adapter.acceptsIdempotencyKey === true
      ? { idempotencyKey: context.keyed.claim.providerKey(message) }
      : {}),
    to: message.to[0],
    // Only for a message to several people, so a one-recipient message
    // reaches every adapter exactly as it did before `toList` existed.
    ...(message.to.length > 1 ? { toList: [...message.to] } : {}),
    from: message.from,
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: message.replyTo,
    cc: message.cc,
    bcc: message.bcc,
    attachments,
  };
}

/**
 * The calls a keyed send has had wholly accepted, by provider key: those an
 * earlier attempt recorded and those of this one, kept on the claim for an
 * instance of the earlier version that reads progress only that way.
 */
function acceptedCallsOf(
  claim: HeldClaim,
  calls: readonly CallOutcome[]
): string[] {
  return [
    ...claim.acceptedCalls,
    ...calls
      .filter(call => call.accepted && call.outcome.success)
      .map(call => claim.providerKey(call.message)),
  ];
}

/** Resolve once `at` (epoch milliseconds) has passed. */
function untilTime(at: number): Promise<void> {
  return new Promise(resolve => {
    // Never what keeps a process alive: nothing else is waiting on it.
    setTimeout(resolve, Math.max(0, at - Date.now())).unref?.();
  });
}

/**
 * Run after-send actions in turn. Every message has been handed over by
 * now, so nothing an action or its reporting does can change what was sent.
 * Contained per value: a failure here would otherwise replace the send's
 * result with an exception and skip the remaining actions.
 */
async function runActions(
  values: readonly EmailAfterSendValue[],
  run: (value: EmailAfterSendValue) => Promise<void>
): Promise<void> {
  for (const value of values) {
    try {
      await run(value);
    } catch {
      // The registry already isolates a failing action; reaching here means
      // its own reporting failed too, and there is nowhere left to report it.
    }
  }
}

/** Whether `promise` settles, either way, within `ms`. */
function settlesWithin(
  promise: Promise<unknown>,
  ms: number
): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    const settled = () => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(settled, settled);
  });
}

/**
 * The caller's result: the outcome, the message id when one is safe, and what
 * went wrong when anything did.
 */
function outcomeOf(
  success: boolean,
  messageId: string | null,
  problems: { failure?: EmailFailure; refused?: RefusedRecipient[] } = {}
): SendOutcome {
  return {
    success,
    ...(messageId !== null ? { messageId } : {}),
    ...(problems.failure ? { failure: problems.failure } : {}),
    ...(problems.refused?.length ? { refused: problems.refused } : {}),
  };
}

/**
 * `to` as one string for a one-recipient message, as the after-send actions
 * have always received it, and as a list otherwise, beside every recipient of
 * the message, copies included, in the same form the filter was given them.
 */
function afterSendAddressing(
  message: SendMessage
): Pick<EmailAfterSendValue, "to" | "recipients"> {
  return {
    to: message.to.length === 1 ? message.to[0] : [...message.to],
    recipients: recipientsOf(message),
  };
}

/** The fields every delivery record of a message shares. */
function rowBase(
  recipient: ReturnType<typeof deliveryRecipients>[number],
  context: DispatchContext
) {
  return {
    ...recipient,
    person: recipient.recipientKind === "to" ? context.person : null,
    providerId: context.resolvedProviderId ?? null,
    providerType: context.providerType,
    templateSlug: context.templateSlug ?? null,
    keyDigest: context.keyed?.claim.keyDigest ?? null,
  };
}

/** One recipient's delivery record for a message the provider answered. */
function acceptedRow(
  recipient: ReturnType<typeof deliveryRecipients>[number],
  facts: {
    refused: ReadonlySet<string>;
    result: Awaited<ReturnType<EmailProviderAdapter["send"]>>;
    safeMessageId: string | null;
    context: DispatchContext;
  }
) {
  const wasRefused = facts.refused.has(recipient.to.trim().toLowerCase());
  const delivered = facts.result.success && !wasRefused;
  return {
    ...rowBase(recipient, facts.context),
    status: delivered ? ("sent" as const) : ("failed" as const),
    messageId: facts.safeMessageId,
    // A refusal says, on the record, whether a retry can help it.
    error: delivered
      ? null
      : wasRefused
        ? refusedRecordError(refusalOf(facts.result, recipient.to))
        : "Send returned unsuccessful",
  };
}

/** What a queued email is checked for before it is stored. */
interface QueueChecks {
  to: string | string[];
  person: unknown;
  idempotencyKey: string | undefined;
}

export class EmailService extends BaseService {
  /** Who sends through this instance: a keyed send is scoped to them. */
  private keyScope: string = CORE_KEY_SCOPE;

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
    private readonly deliveries?: EmailDeliveryService,
    /**
     * Run a queued email's job now: its first attempt, once the email is
     * stored. Optional so a service built without the job queue -- a test's
     * -- still queues; the email then waits for the jobs trigger.
     */
    private readonly runQueuedJob?: (jobId: string) => Promise<unknown>
  ) {
    // Masked here whatever logger an app supplied: what this service logs,
    // a provider error quoting a recipient included, never carries a full
    // email address outside development and test.
    super(adapter, maskingServiceLogger(logger));
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
   * @experimental This service as `scope` sends through it: the same service,
   * with every idempotency key scoped to that caller. The surface a send came
   * through chooses the scope, never the caller.
   */
  scopedTo(scope: string): EmailService {
    const view = Object.create(this) as EmailService;
    view.keyScope = scope;
    return view;
  }

  /**
   * Send an email using a named template.
   *
   * Resolution order for templates:
   * 1. The site's override of the template, when it has one
   * 2. The site's code version, from `defineConfig({ email: { templates } })`
   * 3. The owner's version, as stored
   * 4. Error if none exists
   *
   * @param templateSlug - Template slug (e.g., "password-reset", "welcome")
   * @param to - Recipient email address, or several: every one receives the
   *   email (see `send`)
   * @param variables - Key-value pairs for `{{variable}}` placeholder replacement
   * @param options - Optional provider/address overrides. Per-send `from` and
   *   `replyTo` take precedence over the template's own overrides: the caller
   *   knows the concrete send context (e.g. a form rule's sender), while the
   *   template override is a static default.
   * @returns Send result with success status and optional message ID
   */
  async sendWithTemplate(
    templateSlug: string,
    to: string | string[],
    variables: Record<string, unknown>,
    options?: {
      providerId?: string;
      from?: string;
      replyTo?: string;
      cc?: string[];
      bcc?: string[];
      attachments?: EmailAttachmentInput[];
      /**
       * @experimental The plugin-defined person `to` is, by kind and id, so
       * the delivery record names them and their deletion report erases it.
       */
      person?: PrincipalRef;
      /** @experimental Send this message once for the key (see `send`). */
      idempotencyKey?: string;
    }
  ): Promise<EmailSendOutcome> {
    // Whitespace-only overrides must not shadow the template/provider
    // defaults or reach a provider as malformed headers.
    const fromOverride = options?.from?.trim() || undefined;
    const replyToOverride = options?.replyTo?.trim() || undefined;

    // The stored template, and whether the site's code version comes first:
    // it does unless the site has overridden the template.
    const codeFn = this.codeTemplateFor(templateSlug);
    let dbTemplate: EmailTemplateRecord | null = null;
    let preferCode = true;
    try {
      ({ template: dbTemplate, preferCode } =
        await this.templateService.resolveForSend(templateSlug));
    } catch (error) {
      this.logger.warn(
        "Failed to look up email template from DB — will try code-first fallback",
        {
          slug: templateSlug,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (
      dbTemplate &&
      sendSource({ stored: dbTemplate, preferCode, hasCode: !!codeFn }) ===
        "stored"
    ) {
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

      // One composition, shared with every preview surface: the layout, and
      // the engine each renders with, are resolved by the template service. A
      // template that cannot be rendered throws here, before any provider is
      // asked, and the send fails; retrying cannot fix a template.
      const {
        subject,
        html,
        text: plainText,
      } = await this.templateService.renderStored(dbTemplate, variables, {
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
        ...this.templateEnvelope(dbTemplate, templateSlug, variables, {
          to,
          from: fromOverride,
          replyTo: replyToOverride,
          cc: options?.cc,
          bcc: options?.bcc,
        }),
        providerId: options?.providerId ?? dbTemplate.providerId ?? undefined,
        // Which template this was, for the delivery log. Without it every
        // password reset, verification and welcome message -- the entire
        // reason the log exists -- records no template at all.
        templateSlug,
        person: options?.person,
        attachments:
          mergedAttachments.length > 0 ? mergedAttachments : undefined,
        idempotencyKey: options?.idempotencyKey,
      });
    }

    // The site's code version.
    if (codeFn) {
      // Template data may now hold any value; the code version's contract is
      // strings, so only a string reaches it.
      const text = (value: unknown) =>
        typeof value === "string" ? value : undefined;
      const result = codeFn({
        user: {
          name: text(variables.userName) ?? null,
          // A code-first template renders for one user; with several `to`
          // addresses it is given the first, and `send` delivers to all.
          email: firstAddress(to),
        },
        token: text(variables.token),
        url: text(variables.resetLink) ?? text(variables.verifyLink),
      });

      // The code supplies the content; how it is delivered (provider, From,
      // Reply-To, attachments) stays the stored template's settings, which
      // are the site's whichever version it sends.
      const settings = dbTemplate;

      // Merge the code's attachments, then the stored template's, then the
      // per-send ones (same rules as DB templates — a later entry wins by
      // mediaId, combined list validated by the resolver).
      const mergedAttachments = mergeTemplateAttachments(
        mergeTemplateAttachments(result.attachments, settings?.attachments),
        options?.attachments
      );

      return this.send({
        to,
        subject: result.subject,
        html: result.html,
        providerId: options?.providerId ?? settings?.providerId ?? undefined,
        templateSlug,
        person: options?.person,
        // Forward cc/bcc/from/replyTo here too — the DB-template path already
        // does, and omitting them on this branch silently dropped them for
        // code-first templates.
        ...this.templateEnvelope(settings, templateSlug, variables, {
          to,
          from: fromOverride,
          replyTo: replyToOverride,
          cc: options?.cc,
          bcc: options?.bcc,
        }),
        attachments:
          mergedAttachments.length > 0 ? mergedAttachments : undefined,
        idempotencyKey: options?.idempotencyKey,
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
    /**
     * The recipient, or several. Every `to` address receives the email: in one
     * message through a provider that takes several, else one message each,
     * with `cc` and `bcc` on the first. Refused before any provider is
     * contacted when empty, malformed, longer than the provider takes, or more
     * than one alongside `person`.
     */
    to: string | string[];
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
    /**
     * @experimental The plugin-defined person `to` is, by kind and id, so the
     * delivery record names them and their deletion report erases it. Names
     * the `to` rows only: a copied address is someone else.
     */
    person?: PrincipalRef;
    /**
     * @experimental Send this message once for the key, on every provider.
     *
     * Claimed before any provider is contacted. A repeat of a send that
     * succeeded returns its result, marked `repeat`, without sending; a repeat
     * while it is still sending reports it in progress; a repeat after it
     * failed sends again. The same key with a different message is refused.
     * Keys are scoped to their caller, so two plugins never share one.
     */
    idempotencyKey?: string;
  }): Promise<EmailSendOutcome> {
    if (options.idempotencyKey !== undefined) {
      assertIdempotencyKey(options.idempotencyKey);
    }
    // A precondition, before anything is resolved or sent: a person that
    // cannot be read would leave the record unable to be erased with them.
    const person = await this.personToRecord(options.person);

    // The caller's recipients are a precondition too. They are checked again
    // once filters have run, against the envelope that is actually sent.
    const requestedTo = toAddressList(options.to);
    assertSendable(requestedTo, { namesPerson: person !== null });

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

    //
    // `to` stays one string for a one-recipient send, which is every send a
    // handler has seen so far, and is a list for several. `recipients` lists
    // every address, copies included, and is derived from `to`, `cc` and
    // `bcc` again after each handler, so no handler in a chain reads a list
    // that disagrees with the fields an earlier one changed. `replyTo` is part
    // of the envelope too, so a filter sees and can change everything sent.
    const givenTo = {
      to: requestedTo.length === 1 ? requestedTo[0] : [...requestedTo],
    };
    const initial = {
      // A copy, so a handler that edits the list in place does not edit the
      // precondition's view of what the caller asked for.
      to: Array.isArray(givenTo.to) ? [...givenTo.to] : givenTo.to,
      from,
      ...(options.replyTo !== undefined ? { replyTo: options.replyTo } : {}),
      subject: options.subject,
      html: options.html,
      text: plainText,
      cc: options.cc,
      bcc: options.bcc,
    };
    let previous: EmailPayloadFilterValue = {
      ...initial,
      recipients: recipientsOf(initial),
    };
    const filtered = await registry.applyFilters<
      EmailPayloadFilterValue,
      EmailFilterContext
    >(
      FilterSeams.EmailBeforeSend,
      previous,
      { providerId: options.providerId },
      {
        afterEach: value => {
          // A handler that leaves `to` or `replyTo` out of what it returns
          // keeps the value it was handed, which may be an earlier handler's
          // change rather than the caller's. Carried forward here, after each
          // handler, so a later handler built on fewer fields cannot undo it.
          const merged = {
            ...value,
            to: "to" in value ? value.to : previous.to,
            ...("replyTo" in value || !("replyTo" in previous)
              ? {}
              : { replyTo: previous.replyTo }),
          };
          previous = { ...merged, recipients: recipientsOf(merged) };
          return previous;
        },
      }
    );

    // Every rule again, on what the filters returned: a handler can add a
    // recipient, remove one, or replace the address a person was named for.
    const maxToPerMessage = declaredMaxTo(adapter);
    const to = toAddressList(filteredToList(givenTo, filtered));
    assertSendable(to, {
      maxToPerMessage,
      namesPerson: person !== null,
      personAddress: person !== null ? requestedTo[0] : undefined,
    });

    const envelope: SendEnvelope = {
      to,
      from: filtered.from,
      // A handler written before `replyTo` was in the payload may build a new
      // object without it; leaving the key out is not a change.
      replyTo: "replyTo" in filtered ? filtered.replyTo : options.replyTo,
      subject: filtered.subject,
      html: filtered.html,
      text: filtered.text,
      cc: filtered.cc,
      bcc: filtered.bcc,
    };

    // The Reply-To that goes out, whoever set it, is a header like the
    // recipients, and is held to the same rule before any provider is called.
    assertSendableReplyTo(envelope.replyTo);

    // Claimed on the envelope that goes out, so a filter's change is part of
    // the message the key names. A repeat is answered here, sending nothing.
    const claimed = await this.claimForSend(options.idempotencyKey, {
      ...envelope,
      attachments: resolvedAttachments,
      person,
    });
    if (claimed && "answer" in claimed) return claimed.answer;

    // A keyed retry sends only to the recipients an earlier attempt with the
    // key had not reached. With none, this is the envelope itself.
    const previouslyAccepted = this.acceptedBefore(
      claimed?.keyed.claim,
      envelope,
      maxToPerMessage
    );
    const messages = messagesFor(
      pendingEnvelope(envelope, previouslyAccepted),
      maxToPerMessage
    );

    const runAfterSend = (value: EmailAfterSendValue) =>
      registry.runActions<EmailAfterSendValue, EmailFilterContext>(
        FilterSeams.EmailAfterSend,
        value,
        { providerId: options.providerId }
      );
    // A split send hands every message to the provider before any after-send
    // action runs. Actions are awaited, and one that never settles would
    // otherwise keep every later recipient from being sent to. A single
    // message runs its actions where it always has.
    //
    // A keyed send's actions also wait, until its records and outcome are
    // committed: an action that stalls must not keep a delivered message
    // uncommitted, to be sent again once its claim lapses.
    const deferred: EmailAfterSendValue[] = [];
    const afterSend =
      messages.length === 1 && !claimed
        ? runAfterSend
        : (value: EmailAfterSendValue) => {
            deferred.push(value);
            return Promise.resolve();
          };

    // A keyed send's records are kept, to commit with its claim's outcome;
    // any other send's are written as each message is answered, as before.
    const records: EmailDeliveryInput[] | undefined = claimed ? [] : undefined;
    const calls = await this.dispatchAll(messages, {
      adapter,
      providerType,
      resolvedProviderId,
      providerId: options.providerId,
      templateSlug: options.templateSlug,
      person,
      resolvedAttachments,
      keyed: claimed?.keyed,
      afterSend,
      record: rows => this.recordOrKeep(rows, records),
    });
    // One message is today's send, and its result is returned as it is; a
    // split send's messages are combined into one result.
    const { outcome, accepted } = sendResultOf(
      envelope,
      previouslyAccepted,
      calls
    );
    const late = calls.some(call => call.late);
    let committed = true;
    if (late) {
      // A call is still unsettled: its claim stays held, renewed, until the
      // call answers or the lease limit passes, and is settled then.
      void this.finishLateCalls({
        keyed: claimed?.keyed,
        envelope,
        previouslyAccepted,
        calls,
        records,
        actions: { deferred, run: runAfterSend },
      });
    } else if (claimed) {
      committed =
        (await this.deliveries?.settleSend(
          claimed.keyed.claim,
          outcome,
          accepted,
          records,
          acceptedCallsOf(claimed.keyed.claim, calls)
        )) ?? true;
    }

    // A keyed send's actions run once its outcome is committed: not at all
    // when the commit failed, since the send that takes its claim over runs
    // them, and from the late finisher when a call is still unsettled.
    // Taken, not iterated in place: a late call adds its actions afterwards.
    if (committed && !(claimed && late)) {
      await runActions(deferred.splice(0), runAfterSend);
    }

    return outcome;
  }

  /**
   * The recipients an earlier attempt with the key had accepted, by place: as
   * the claim records them, or, for a claim that recorded accepted calls,
   * every recipient of each call it records.
   */
  private acceptedBefore(
    claim: HeldClaim | undefined,
    envelope: SendEnvelope,
    maxToPerMessage: number | undefined
  ): ReadonlySet<string> {
    // Calls are read only from a claim the earlier version wrote, which has no
    // recipients: a claim that records both is read by its recipients, which
    // keep a refused copy apart from the call that carried it.
    if (
      !claim ||
      claim.acceptedRecipients.size > 0 ||
      claim.acceptedCalls.size === 0
    ) {
      return claim?.acceptedRecipients ?? new Set<string>();
    }
    const calls = messagesFor(envelope, maxToPerMessage).filter(message =>
      claim.acceptedCalls.has(claim.providerKey(message))
    );
    return new Set([...claim.acceptedRecipients, ...slotsOf(envelope, calls)]);
  }

  /**
   * Hand each message to the provider in turn, and say what each call
   * answered.
   *
   * In turn rather than at once: a provider that takes one `to` per message
   * is usually one that rate-limits, and the delivery records of each message
   * are written before the next is sent.
   */
  private async dispatchAll(
    messages: readonly SendMessage[],
    context: DispatchContext
  ): Promise<CallOutcome[]> {
    const calls: CallOutcome[] = [];
    for (const message of messages) {
      calls.push(await this.dispatchMessage(message, context));
    }
    return calls;
  }

  /**
   * Finish a send whose calls were still unsettled at their deadline: renew
   * its claim's lease while they are, record what each answers within the
   * lease limit (or that it never answered), and settle the claim with the
   * send's outcome then. Never throws: the caller has its result.
   */
  private async finishLateCalls(late: {
    keyed?: KeyedSend;
    envelope: SendEnvelope;
    previouslyAccepted: ReadonlySet<string>;
    calls: readonly CallOutcome[];
    records?: EmailDeliveryInput[];
    actions: {
      deferred: EmailAfterSendValue[];
      run: (value: EmailAfterSendValue) => Promise<void>;
    };
  }): Promise<void> {
    let committed = true;
    const renewal = setInterval(() => {
      void late.keyed?.renew();
    }, LEASE_RENEWAL_MS);
    // A renewal timer must not keep a process alive that has nothing else.
    renewal.unref?.();
    try {
      const calls = await Promise.all(
        late.calls.map(call =>
          call.late ? call.late() : Promise.resolve(call)
        )
      );
      if (late.keyed) {
        const { outcome, accepted } = sendResultOf(
          late.envelope,
          late.previouslyAccepted,
          calls
        );
        committed =
          (await this.deliveries?.settleSend(
            late.keyed.claim,
            outcome,
            accepted,
            late.records,
            acceptedCallsOf(late.keyed.claim, calls)
          )) ?? true;
      }
    } catch (error) {
      committed = false;
      warnQuietly(this.logger, "A late email send could not be finished", {
        error,
      });
    } finally {
      clearInterval(renewal);
    }
    // The actions still waiting, after the commit, and only once it holds.
    if (committed) {
      await runActions(late.actions.deferred.splice(0), late.actions.run);
    }
  }

  /**
   * Claim a keyed send's key: the claim to send under, or the answer for a
   * send that must not go out, a repeat or one still in progress. Nothing for
   * a send without a key.
   *
   * @throws {NextlyError} `CONFLICT` when the key was used for a different
   *   message, and `INTERNAL_ERROR` when no delivery log can hold the claim.
   */
  private async claimForSend(
    key: string | undefined,
    message: Parameters<typeof sendKeyOf>[2]
  ): Promise<{ keyed: KeyedSend } | { answer: SendOutcome } | undefined> {
    if (key === undefined) return undefined;
    if (!this.deliveries) {
      throw NextlyError.internal({
        logContext: { reason: "a keyed send needs the delivery log" },
      });
    }
    const sendKey = sendKeyOf(this.keyScope, key, message);
    const decided = await this.deliveries.claimSend(sendKey);
    switch (decided.kind) {
      case "claimed": {
        const { claim } = decided;
        const deliveries = this.deliveries;
        return {
          keyed: { claim, renew: () => deliveries.renewSend(claim) },
        };
      }
      case "repeat":
        return { answer: { ...decided.result, repeat: true } };
      case "in-progress":
        return { answer: { success: false, failure: inProgressFailure() } };
      case "different-message":
        throw new NextlyError({
          code: "CONFLICT",
          publicMessage:
            "This idempotency key was already used for a different message.",
          logContext: { reason: "idempotency-key-reused" },
        });
    }
  }

  /**
   * Hand one message to the provider, and record what it answered.
   *
   * Never throws for a provider failure: the outcome is returned, recorded
   * per recipient, and handed to `afterSend` for the `email.afterSend`
   * actions, once for each message.
   */
  private async dispatchMessage(
    message: SendMessage,
    context: DispatchContext
  ): Promise<CallOutcome> {
    // A keyed send of several messages renews its claim before each one, so a
    // later send with the key does not take over a send still in progress.
    await context.keyed?.renew();
    const startedAt = Date.now();
    const controller = new AbortController();
    // Started once, and answered within the deadline or carried on past it:
    // never started again, which would send the message twice.
    const sending = Promise.resolve().then(() =>
      context.adapter.send({
        ...adapterMessage(message, context),
        signal: controller.signal,
      })
    );
    if (await settlesWithin(sending, CALL_DEADLINE_MS)) {
      return this.recordAnswer(message, context, sending, startedAt);
    }
    // No answer yet: the caller is told so now, the adapter is told to stop,
    // and the call is finished later with whatever it answers, by its own
    // lease limit, counted from when it started.
    controller.abort();
    const limitAt = startedAt + LEASE_LIMIT_MS;
    return {
      message,
      outcome: { success: false, failure: noAnswerFailure() },
      accepted: false,
      late: async () => {
        if (await settlesWithin(sending, Math.max(0, limitAt - Date.now()))) {
          const answered = await this.recordAnswer(
            message,
            context,
            sending,
            startedAt
          );
          // An answer that is itself unknown, as the cancellation gives a
          // keyless adapter that honours it, may still be processing at the
          // provider: its claim is held to the lease limit all the same.
          // Only a keyed call has a claim to hold.
          if (context.keyed && answered.outcome.failure?.unknown) {
            await untilTime(limitAt);
          }
          return answered;
        }
        // Never answered: recorded as without an answer, and its claim let go.
        const outcome = await this.recordFailed(
          message,
          withEmailFailure(
            new Error("no answer by the lease limit"),
            noAnswerFailure()
          ),
          context,
          startedAt
        );
        return { message, outcome, accepted: false };
      },
    };
  }

  /** Record what a provider call answered, or how it failed. */
  private async recordAnswer(
    message: SendMessage,
    context: DispatchContext,
    sending: Promise<Awaited<ReturnType<EmailProviderAdapter["send"]>>>,
    startedAt: number
  ): Promise<CallOutcome> {
    // Two fields rather than one, because they answer different questions
    // and only one of them can be answered immediately. `verdict` is the fact
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
    const state: DispatchState = {};

    try {
      const result = await sending;

      // The provider has answered, and WHAT it answered. Both are recorded
      // here: a later throw must not be able to turn a refusal into a success
      // any more than it can turn an acceptance into a failure. Storing only
      // "it answered" and defaulting to success would have an auth flow
      // withhold its undelivered-token fallback for a message the provider
      // said it did not send.
      state.verdict = result.success === true;

      const outcome = await this.recordAccepted(
        message,
        result,
        context,
        state,
        startedAt
      );
      return { message, outcome, accepted: state.verdict };
    } catch (error) {
      // The message was already accepted, so this is not a provider failure
      // however it reached here. Reporting one would contradict the rows and
      // the action that have already gone out, and would tell an auth flow to
      // withhold a token for a mail that was sent.
      if (state.verdict !== undefined) {
        const outcome = this.acceptedDespite(error, context.providerType, {
          verdict: state.verdict,
          dispatched: state.dispatched,
        });
        return { message, outcome, accepted: state.verdict };
      }
      const outcome = await this.recordFailed(
        message,
        error,
        context,
        startedAt
      );
      return { message, outcome, accepted: false };
    }
  }

  /**
   * Everything after a provider has answered: the delivery records, the
   * after-send actions, the log line and the caller's result.
   *
   * Throws only when that bookkeeping does, after `state.dispatched` holds the
   * response, so `dispatchMessage`'s catch can still report what the provider
   * said rather than a failure.
   */
  private async recordAccepted(
    message: SendMessage,
    result: Awaited<ReturnType<EmailProviderAdapter["send"]>>,
    context: DispatchContext,
    state: DispatchState,
    startedAt: number
  ): Promise<SendOutcome> {
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
    const recipients = deliveryRecipients(message);
    // A provider is handed the `to` addresses and may build its identifier out of
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
          (context.resolvedAttachments ?? []).map(
            attachment => attachment.filename
          )
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

    // Constructed, never the adapter's object. `send`'s declared return type
    // has only these two fields, but returning `result` hands back whatever
    // the provider put on it -- and both send routes spread that straight
    // into an HTTP response. `rejected` carries addresses, including BCC
    // recipients an `email.beforeSend` filter added, and a contributed
    // provider can put anything else there while holding decrypted
    // configuration. What this method promises is what it returns.
    const outcome = outcomeOf(deliveredToCaller, safeMessageId, {
      failure: deliveredToCaller
        ? undefined
        : answeredFailure(result, recipients, refused),
      refused: refusedRecipients(message, refused, result),
    });

    // The provider has answered. Everything below this line is bookkeeping
    // about a message that was already handed over, and the catch beneath
    // the whole block reports a PROVIDER failure -- so an installed logger
    // that throws, or a recorder that does, would otherwise write a second
    // set of failed rows, run the after-send actions again with
    // `success: false`, and tell the caller a delivered message failed.
    state.dispatched = outcome;

    await context.record(
      recipients.map(recipient =>
        acceptedRow(recipient, {
          refused,
          result,
          safeMessageId,
          context,
        })
      )
    );

    // D63 action seam: ordered, isolated side-effects after a send attempt.
    await context.afterSend({
      ...afterSendAddressing(message),
      subject: message.subject,
      success: deliveredToCaller,
      messageId: safeMessageId ?? undefined,
    });

    this.logAccepted(message, context, {
      deliveredToCaller,
      providerAccepted: result.success,
      safeMessageId,
      durationMs: Date.now() - startedAt,
    });

    return outcome;
  }

  /**
   * The log line for a message the provider answered.
   */
  private logAccepted(
    message: SendMessage,
    context: DispatchContext,
    facts: {
      deliveredToCaller: boolean;
      providerAccepted: boolean;
      safeMessageId: string | null;
      durationMs: number;
    }
  ): void {
    if (facts.deliveredToCaller) {
      // Stable, greppable send record for terminal / log-aggregator use.
      // Do not log recipient PII (addresses/subject). Counts keep the record
      // useful for a log aggregator without persisting personal data.
      this.logger.info("email.sent", {
        event: "email.sent",
        provider: context.providerType,
        messageId: facts.safeMessageId,
        durationMs: facts.durationMs,
        toCount: message.to.length,
        ccCount: message.cc?.length ?? 0,
        bccCount: message.bcc?.length ?? 0,
        attachmentCount: context.resolvedAttachments?.length ?? 0,
      });
      return;
    }
    this.logger.warn("email.failed", {
      event: "email.failed",
      provider: context.providerType,
      durationMs: facts.durationMs,
      // A refused primary recipient and a provider-level failure are
      // different operational problems: one is an address the server would
      // not take, the other is the send itself.
      reason: facts.providerAccepted
        ? "primary recipient refused"
        : "provider returned unsuccessful",
    });
  }

  /**
   * The result of a message the provider answered, when the bookkeeping after
   * that answer threw.
   */
  private acceptedDespite(
    error: unknown,
    providerType: string,
    state: { verdict: boolean; dispatched?: SendOutcome }
  ): SendOutcome {
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
    return (
      state.dispatched ??
      (state.verdict
        ? { success: true }
        : { success: false, failure: notAcceptedFailure() })
    );
  }

  /**
   * Record a message the provider refused or never answered.
   */
  private async recordFailed(
    message: SendMessage,
    error: unknown,
    context: DispatchContext,
    startedAt: number
  ): Promise<SendOutcome> {
    const recipients = deliveryRecipients(message);
    // Recorded before the action seam, for the reason given in the success
    // path: a plugin handler that blocks must not be able to cost us the
    // record of an attempt. A throw here is the case where the record
    // matters most, since it is the only durable trace of the failure.
    //
    // Contained, like the log line below: a recorder or a logger that throws
    // here would otherwise turn this message's failure into an exception, and
    // on a split send stop every later message from being sent.
    await context.record(
      recipients.map(recipient => ({
        ...rowBase(recipient, context),
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
    await context.afterSend({
      ...afterSendAddressing(message),
      subject: message.subject,
      success: false,
      messageId: undefined,
    });

    const failure = thrownFailure(
      error,
      recipients.map(recipient => recipient.to)
    );
    try {
      this.logger.error("email.failed", {
        event: "email.failed",
        provider: context.providerType,
        durationMs: Date.now() - startedAt,
        retryable: failure.retryable,
        ...(failure.status !== undefined ? { status: failure.status } : {}),
        // The cause too, not just the message. A provider's own diagnostic --
        // an SMTP status line, an API error code -- is moved onto `cause` when
        // its failure is normalised, so a log reading only `message` records
        // the generic sentence and loses the one fact worth having.
        ...describeProviderFailure(error),
      });
    } catch {
      // Nowhere left to report it: the reporter is what failed. The failure
      // is still returned, which is what the caller acts on.
    }
    return { success: false, failure };
  }

  /**
   * Record delivery rows, or keep them in `kept` for a keyed send's commit,
   * never letting the recorder's own failure escape.
   */
  private async recordOrKeep(
    rows: EmailDeliveryInput[],
    kept: EmailDeliveryInput[] | undefined
  ): Promise<void> {
    if (kept) {
      kept.push(...rows);
      return;
    }
    try {
      await this.deliveries?.recordAll(rows);
    } catch {
      // The recorder already promises not to throw; one that breaks that
      // promise costs the record of this attempt, never the send.
    }
  }

  /**
   * @experimental Queue an email: stored, sent right after, and retried
   * through the job queue until it is sent or fails for good.
   *
   * Takes every option `send` takes. With `tx`, the handle a plugin's
   * `ctx.db.transaction` passes its callback, the email is stored in that
   * transaction and exists only if it commits; its first attempt is made once
   * it has, before `ctx.db.transaction` resolves. Without `tx` the email is
   * stored and attempted before this returns; a call made while the flow has
   * a transaction open is then refused, since the email would commit on its
   * own.
   *
   * A failure the provider marks temporary is retried with backoff, up to a
   * limit; any other failure fails the email without another attempt. Every
   * attempt sends with `idempotencyKey`, or with one derived from the queued
   * email when none is given, so a retry after a lost response is not
   * delivered twice where the provider takes a key. The message is held
   * sealed under the install's secret, never in the job queue. A retry needs
   * the jobs trigger (`/api/jobs/run`) to run.
   *
   * @returns The queued email's id, and where it stands
   */
  async queue(
    options: Omit<Parameters<EmailService["send"]>[0], "templateSlug"> &
      TxOption
  ): Promise<QueuedEmail> {
    const { tx, ...send } = options;
    return this.enqueue(
      { kind: "message", send },
      { to: send.to, person: send.person, idempotencyKey: send.idempotencyKey },
      tx,
      "email.queue"
    );
  }

  /**
   * @experimental Queue an email made from a template, as `queue` queues a
   * message (see it for `tx`, retries and keys). The template is rendered at
   * each attempt, from the template as saved then, with `variables` as given.
   *
   * @returns The queued email's id, and where it stands
   */
  async queueWithTemplate(
    templateSlug: string,
    to: string | string[],
    variables: Record<string, unknown>,
    options?: NonNullable<Parameters<EmailService["sendWithTemplate"]>[3]> &
      TxOption
  ): Promise<QueuedEmail> {
    const { tx, ...rest } = options ?? {};
    return this.enqueue(
      { kind: "template", slug: templateSlug, to, variables, options: rest },
      { to, person: rest.person, idempotencyKey: rest.idempotencyKey },
      tx,
      "email.queueWithTemplate"
    );
  }

  /**
   * What a send would refuse before anything is resolved, refused when the
   * email is queued rather than at its first attempt: the key, the person,
   * and the recipients as the caller gave them. A staff person is read in
   * `tx` when the email is queued in a transaction, so a user that
   * transaction wrote is seen, as the queued email will be.
   */
  private async assertQueueable(
    checks: QueueChecks,
    tx?: TransactionContext
  ): Promise<void> {
    if (checks.idempotencyKey !== undefined) {
      assertIdempotencyKey(checks.idempotencyKey);
    }
    const recorded = await this.personToRecord(checks.person, tx);
    assertSendable(toAddressList(checks.to), {
      namesPerson: recorded !== null,
    });
  }

  /** Store a queued email, and start its first attempt once it is durable. */
  private async enqueue(
    message: QueuedMessage,
    checks: QueueChecks,
    tx: TxOption["tx"],
    operation: string
  ): Promise<QueuedEmail> {
    const input = {
      scope: this.keyScope,
      message,
      secrets: pluginSettingsSecrets(env),
      dialect: this.dialect,
      now: new Date(),
    };
    if (tx !== undefined) {
      const link = linkedTransaction(tx, operation);
      const { id, jobId } = await link.run(async adapterTx => {
        await this.assertQueueable(checks, adapterTx);
        return storeQueuedEmail(adapterTx, input);
      });
      link.afterCommit(() => this.firstAttempt(jobId));
      return { id, state: "waiting" };
    }
    assertNoOpenTransaction(this.adapter, operation);
    await this.assertQueueable(checks);
    const { id, jobId } = await runAdapterTransaction<
      { id: string; jobId: string },
      TransactionContext
    >(
      run => this.adapter.transaction(ctx => run(ctx)),
      ctx => storeQueuedEmail(ctx, input)
    );
    await this.firstAttempt(jobId);
    return { id, state: await this.stateAfterFirstAttempt(id) };
  }

  /**
   * Where a stored email stands after its first attempt, or `waiting` when
   * that cannot be read. Never throws: the email is stored and may already be
   * sent, and a caller told the queue failed would queue it again, under a
   * new id and so a new key.
   */
  private async stateAfterFirstAttempt(id: string): Promise<QueuedEmailState> {
    try {
      return (await queuedEmailState(this.adapter, id)) ?? "waiting";
    } catch (error) {
      warnQuietly(
        this.logger,
        "A queued email's state could not be read after its first attempt.",
        { error: error instanceof Error ? error.message : String(error) }
      );
      return "waiting";
    }
  }

  /**
   * A stored email's first attempt, through its job, then the warning when
   * queued email is overdue. Never throws: the email is stored, and an
   * attempt that could not start is made by the next jobs trigger.
   */
  private async firstAttempt(jobId: string): Promise<void> {
    try {
      await this.runQueuedJob?.(jobId);
    } catch (error) {
      // Contained: the email is stored, and a logger that throws must not
      // turn that into a failed queue the caller would repeat.
      warnQuietly(
        this.logger,
        "A queued email's first attempt did not start; the jobs trigger will make it.",
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
    await warnAboutLateQueuedEmail(this.adapter, this.logger);
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
    options?: {
      path?: string;
      /**
       * The staff user the email goes to, by id, so its delivery records name
       * them. Named explicitly, never read off `user`: a caller's user object
       * may carry an id of its own that is no staff user's.
       */
      staffUserId?: string;
    }
  ): Promise<EmailSendOutcome> {
    const baseUrl = this.getBaseUrl();
    const path =
      options?.path ??
      this.emailConfig?.resetPasswordPath ??
      "/admin/reset-password";
    const resetLink = `${baseUrl}${path}?token=${encodeURIComponent(token)}`;

    return this.sendWithTemplate(
      "password-reset",
      to,
      {
        resetLink,
        expiresIn: "1 hour",
        appName: this.getAppName(),
        userName: user.name ?? user.email,
        userEmail: user.email,
        token,
        year: new Date().getFullYear().toString(),
      },
      staffRecipient(options?.staffUserId)
    );
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
    options?: {
      path?: string;
      /**
       * The staff user the email goes to, by id, so its delivery records name
       * them. Named explicitly, never read off `user`: a caller's user object
       * may carry an id of its own that is no staff user's.
       */
      staffUserId?: string;
    }
  ): Promise<EmailSendOutcome> {
    const baseUrl = this.getBaseUrl();
    const path =
      options?.path ??
      this.emailConfig?.verifyEmailPath ??
      "/admin/verify-email";
    const verifyLink = `${baseUrl}${path}?token=${encodeURIComponent(token)}`;

    return this.sendWithTemplate(
      "email-verification",
      to,
      {
        verifyLink,
        expiresIn: "24 hours",
        appName: this.getAppName(),
        userName: user.name ?? user.email,
        userEmail: user.email,
        token,
        year: new Date().getFullYear().toString(),
      },
      staffRecipient(options?.staffUserId)
    );
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
    options?: {
      verifyLink?: string;
      /**
       * The staff user the email goes to, by id, so its delivery records name
       * them. Named explicitly, never read off `user`: a caller's user object
       * may carry an id of its own that is no staff user's.
       */
      staffUserId?: string;
    }
  ): Promise<EmailSendOutcome> {
    return this.sendWithTemplate(
      "welcome",
      to,
      {
        userName: user.name ?? user.email,
        appName: this.getAppName(),
        userEmail: user.email,
        verifyLink: options?.verifyLink ?? "",
        expiresIn: "24 hours",
        year: new Date().getFullYear().toString(),
      },
      staffRecipient(options?.staffUserId)
    );
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
      const { template } =
        await this.templateService.resolveForSend(templateSlug);
      // The stored template's provider, whichever version sends: the code
      // supplies only content (see sendWithTemplate), and sends whenever the
      // stored template doesn't (inactive, or not overridden).
      const hasCode = !!this.codeTemplateFor(templateSlug);
      if (template && (template.isActive || hasCode)) {
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

  /**
   * How a template's send is addressed. The send's own From and Reply-To win
   * over the template's, which are rendered from the send's data; the
   * template's copies follow the send's own. A template that carries a
   * secret copies nobody, even with copies stored on it past the save-time
   * check: those are left out, and the leaving out is logged.
   *
   * @throws NextlyError, not retryable, when the template's From or Reply-To
   *   cannot be used (see `template-envelope.ts`)
   */
  private templateEnvelope(
    template: EmailTemplateRecord | null,
    slug: string,
    variables: Record<string, unknown>,
    given: {
      to: string | string[];
      from?: string;
      replyTo?: string;
      cc?: string[];
      bcc?: string[];
    }
  ): { from?: string; replyTo?: string; cc?: string[]; bcc?: string[] } {
    const from =
      given.from ??
      (template?.fromOverride != null
        ? renderTemplateFrom(template.fromOverride, variables, slug)
        : undefined);
    const replyTo =
      given.replyTo ??
      (template?.replyTo != null
        ? renderTemplateReplyTo(template.replyTo, variables, slug)
        : undefined);
    let copies = { cc: template?.cc ?? null, bcc: template?.bcc ?? null };
    if (template?.carriesSecret && (copies.cc?.length || copies.bcc?.length)) {
      this.logger.warn(
        "Left out an email template's copies: the template carries a secret",
        { slug }
      );
      copies = { cc: null, bcc: null };
    }
    return { from, replyTo, ...withTemplateCopies(given, copies) };
  }

  /** The site's code version of a template, from `email.templates`, if it sets one. */
  private codeTemplateFor(slug: string) {
    const key = CODE_TEMPLATE_KEYS[slug];
    return key ? this.emailConfig?.templates?.[key] : undefined;
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
   * The person a send names, by kind and id, or null for none: a staff user
   * (`{ kind: "staff", id }`) or a plugin-defined person. Refused when it is
   * given and cannot name a person, since a record kept under it could never
   * be matched by the deletion that erases the person's records; and refused
   * when it names a staff user who does not exist, for the same reason.
   */
  private async personToRecord(
    value: unknown,
    tx?: TransactionContext
  ): Promise<PrincipalRef | null> {
    if (value === undefined || value === null) return null;
    const staff = staffPersonOf(value);
    if (!staff) return pluginPersonToRecord(value);
    // In `tx` when there is one: on PostgreSQL and MySQL the pool is another
    // connection, which cannot see a user that transaction has written.
    const db = tx
      ? tx.drizzleWithRelations<typeof this.db>(
          getStaticRelations(this.dialect)
        )
      : this.db;
    let user: { id: string } | undefined;
    try {
      user = await db.query.users.findFirst({
        where: { id: requireFilterValue(staff.id, "person.id") },
        columns: { id: true },
      });
    } catch (error) {
      // The canonical error, as every other database failure of a send is.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
    if (!user) {
      throw NextlyError.validation({
        errors: [
          {
            path: "person",
            code: "NOT_FOUND",
            message: "`person` names a staff user who does not exist.",
          },
        ],
        logContext: { operation: "email.send" },
      });
    }
    // The id as stored, not as the caller spelled it: on MySQL's usual
    // case-insensitive collation the two can differ, and the record, the
    // deleted-people digest and the deletion must all name one spelling.
    return staffPerson(String(user.id));
  }

  /**
   * Format a "from" address: `"Name <email>"` or just `"email"`.
   */
  private formatFromAddress(name: string | null, email: string): string {
    if (name) return `${name} <${email}>`;
    return email;
  }
}

/**
 * The send options that name the staff user a core email goes to, so its
 * delivery records name them and their deletion erases those records; none
 * for a caller that named no staff user.
 */
function staffRecipient(
  staffUserId: string | undefined
): { person: PrincipalRef } | undefined {
  // An id longer than a record can hold is sent naming nobody, as every core
  // email was before staff users were named, rather than refused.
  return isStaffPersonId(staffUserId)
    ? { person: staffPerson(staffUserId) }
    : undefined;
}

/**
 * The plugin-defined person a send names, by kind and id. Refused when it
 * cannot name one: recorded as it is, it could never be matched by the report
 * that erases the person's records.
 */
function pluginPersonToRecord(value: unknown): PrincipalRef {
  const ref = principalRefOf(value);
  // Of a kind a running plugin registers, too: a misspelled kind is one no
  // deletion report can name, so a record kept under it would outlive the
  // person it names.
  if (ref && getPrincipalKind(ref.kind)) return ref;
  throw NextlyError.validation({
    errors: [
      {
        path: "person",
        code: "INVALID",
        message:
          '`person` must name a staff user (`{ kind: "staff", id }`) or a plugin-defined person by the full name of a registered kind, with an id a delivery record can hold for a staff user, and of 1 to 128 characters for a plugin-defined person.',
      },
    ],
    logContext: { operation: "email.send" },
  });
}
