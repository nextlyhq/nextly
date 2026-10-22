/**
 * Direct API Email Type Definitions
 *
 * Argument types for email providers, email templates, user field definitions,
 * and the email send API.
 *
 * @packageDocumentation
 */

import type { EmailFailure } from "../../domains/email/failure";
import type {
  EmailTemplateComparison as TemplateComparison,
  OwnerUpdateUndo as UpdateUndo,
} from "../../domains/email/services/email-template-service";
import type { RefusedRecipient } from "../../domains/email/services/send-failures";
import type {
  OwnerChange as Change,
  OwnerChangeChoice as ChangeChoice,
} from "../../domains/email/template-merge";
import type { EmailAttachmentInput } from "../../domains/email/types";
import type { PrincipalRef } from "../../plugins/principals/types";
import type { EmailProviderType } from "../../schemas/email-providers/types";
import type { EmailTemplateVersion as TemplateVersion } from "../../schemas/email-templates/types";

import type { DirectAPIConfig } from "./shared";

export type { EmailAttachmentInput };

// What the template ownership methods return, and the types their arguments
// are built from, so code calling them can name each. Declared here rather
// than re-exported so each public name carries its own release tag.

/**
 * @experimental An overridden template beside its owner's current version,
 * as `compare()` returns it.
 */
export type EmailTemplateComparison = TemplateComparison;

/**
 * @experimental The parts of a template an owner's update can change: what
 * the email says.
 */
export type EmailTemplateVersion = TemplateVersion;

/**
 * @experimental One change the owner made since the base, with the site's
 * lines beside it.
 */
export type OwnerChange = Change;

/** @experimental What the person chose for one change. */
export type OwnerChangeChoice = ChangeChoice;

/** @experimental What an applied review replaced, so it can be undone. */
export type OwnerUpdateUndo = UpdateUndo;

/**
 * Arguments for finding email providers.
 */
export interface FindEmailProvidersArgs extends DirectAPIConfig {
  /** Maximum providers per page */
  limit?: number;
  /** Page number (1-indexed) */
  page?: number;
}

/**
 * Arguments for finding an email provider by ID.
 */
export interface FindEmailProviderByIDArgs extends DirectAPIConfig {
  /** Provider ID (required) */
  id: string;
  /** Return `null` instead of throwing for not-found. @default false */
  disableErrors?: boolean;
}

/**
 * Arguments for creating an email provider.
 */
export interface CreateEmailProviderArgs extends DirectAPIConfig {
  /** Provider data (required) */
  data: {
    /** Display name */
    name: string;
    /** Provider type */
    type: EmailProviderType;
    /** From email address */
    fromEmail: string;
    /** From display name */
    fromName?: string;
    /** Provider-specific configuration (credentials encrypted at rest) */
    configuration: Record<string, unknown>;
    /** Mark as default provider */
    isDefault?: boolean;
    /**
     * Whether the provider may be selected to send. Defaults to true.
     *
     * Declared on the CREATE shape rather than only on the update, because
     * both services accept it and `UpdateEmailProviderArgs` derives its own
     * fields from this one. A typed caller could otherwise neither create a
     * provider deactivated nor deactivate one afterwards, while a JavaScript
     * caller could do both — the namespace forwards `data` unchanged, so the
     * capability was there and only the type withheld it.
     */
    isActive?: boolean;
  };
}

/**
 * Arguments for updating an email provider.
 */
export interface UpdateEmailProviderArgs extends DirectAPIConfig {
  /** Provider ID (required) */
  id: string;
  /** Partial provider data */
  data: Partial<CreateEmailProviderArgs["data"]> & {
    /**
     * Configuration fields to REMOVE, by the name the provider declares.
     *
     * Not expressible through `Partial<...>` of the create shape, because a
     * create has nothing to remove. Without it a typed caller can set an
     * optional field but never clear one — a JavaScript caller could, since
     * the namespace forwards `data` unchanged, so the capability existed and
     * only the type withheld it.
     */
    unsetConfiguration?: string[];
  };
}

/**
 * Arguments for deleting an email provider.
 */
export interface DeleteEmailProviderArgs extends DirectAPIConfig {
  /** Provider ID (required) */
  id: string;
}

/**
 * Arguments for setting an email provider as default.
 */
export interface SetDefaultProviderArgs extends DirectAPIConfig {
  /** Provider ID (required) */
  id: string;
}

/**
 * Arguments for sending a test email through a provider.
 */
export interface TestEmailProviderArgs extends DirectAPIConfig {
  /** Provider ID (required) */
  id: string;
  /** Recipient email address (required) */
  to: string;
  /**
   * `"send"` (default) dispatches a real message to `to`, which is what the
   * admin's Send Test button promises. `"connection"` asks the provider's own
   * probe and sends nothing — available only where the descriptor reports
   * `capabilities.connectionTest`, and `to` is then ignored.
   */
  mode?: "send" | "connection";
}

/**
 * Arguments for finding email templates.
 */
export interface FindEmailTemplatesArgs extends DirectAPIConfig {
  /** Maximum templates per page */
  limit?: number;
  /** Page number (1-indexed) */
  page?: number;
}

/**
 * Arguments for finding an email template by ID.
 */
export interface FindEmailTemplateByIDArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /** Return `null` instead of throwing for not-found. @default false */
  disableErrors?: boolean;
}

/**
 * Arguments for finding an email template by slug.
 */
export interface FindEmailTemplateBySlugArgs extends DirectAPIConfig {
  /** Template slug (required) */
  slug: string;
  /** Return `null` instead of throwing for not-found. @default false */
  disableErrors?: boolean;
}

/**
 * Arguments for creating an email template.
 */
export interface CreateEmailTemplateArgs extends DirectAPIConfig {
  /** Template data (required) */
  data: {
    /** Display name */
    name: string;
    /** Unique slug identifier */
    slug: string;
    /** Email subject line (supports {{variable}} interpolation) */
    subject: string;
    /** HTML content (supports {{variable}} interpolation) */
    htmlContent: string;
    /** Plain text fallback content */
    textContent?: string;
    /** Row kind: "template" (default), "layout", or "partial". */
    kind?: "template" | "layout" | "partial";
    /** Hidden inbox-preview line rendered before the body. */
    preheader?: string;
    /** Layout row that wraps this template at its {{content}} marker. */
    layoutId?: string;
    /**
     * Override the provider's From address for this template. Its display
     * name may use the send's variables; its address may not.
     */
    fromOverride?: string;
    /** Reply-To address for this template; may use the send's variables. */
    replyTo?: string;
    /**
     * @experimental Fixed addresses copied on every send, after the send's
     * own. Refused on a template that carries a secret.
     */
    cc?: string[];
    /** @experimental Fixed addresses blind-copied on every send, as `cc`. */
    bcc?: string[];
    /** Whether to wrap this template in its layout when sending. */
    useLayout?: boolean;
    /** Specific provider ID to use for this template */
    providerId?: string;
    /** Whether this template is active */
    isActive?: boolean;
    /** Template variables metadata */
    variables?: { name: string; description: string; required?: boolean }[];
    /**
     * Default attachments for this template. Merged with per-send
     * attachments at send time; per-send wins on mediaId conflict.
     */
    attachments?: EmailAttachmentInput[];
    /**
     * @experimental When the template is sent, in a sentence the admin shows
     * beside it.
     */
    description?: string;
  };
}

/**
 * Arguments for updating an email template.
 */
export interface UpdateEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /**
   * Partial template data; `description: null` clears the description, and
   * `cc: null` or `bcc: null` clears the copies.
   */
  data: Partial<
    Omit<CreateEmailTemplateArgs["data"], "description" | "cc" | "bcc">
  > & {
    description?: string | null;
    cc?: string[] | null;
    bcc?: string[] | null;
  };
}

/**
 * Arguments for deleting an email template.
 */
export interface DeleteEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
}

/**
 * @experimental Arguments for overriding a core or plugin template, so it
 * holds the site's version from now on.
 */
export interface OverrideEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /**
   * Where the site's version starts. Omitted fields start from the owner's
   * current version.
   */
  version?: Partial<EmailTemplateVersion>;
}

/**
 * @experimental Arguments for returning an overridden template to its
 * owner's current version.
 */
export interface ResetEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
}

/**
 * @experimental Arguments for comparing an overridden template with its
 * owner's current version.
 */
export interface CompareEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
}

/**
 * @experimental Arguments for applying a review of an owner's update.
 */
export interface ApplyEmailTemplateUpdateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /**
   * A choice for every change `compare` offered, by its `id`: keep the
   * site's lines, use the owner's, or use text the person wrote.
   */
  choices: Record<string, OwnerChangeChoice>;
  /**
   * The `review` token `compare` returned. The update is refused if the
   * template or either version moved since, so choices are only applied to
   * the changes they were made on.
   */
  review: string;
}

/**
 * @experimental Arguments for undoing an applied review.
 */
export interface UndoEmailTemplateUpdateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /** What `applyUpdate` returned as `undo`. */
  undo: OwnerUpdateUndo;
}

/**
 * Arguments for previewing an email template with variable data.
 */
export interface PreviewEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /** Variable values for interpolation */
  data?: EmailTemplateData;
}

/**
 * Arguments for finding user field definitions.
 */
export interface FindUserFieldsArgs extends DirectAPIConfig {
  /** Maximum fields per page */
  limit?: number;
  /** Page number (1-indexed) */
  page?: number;
  /** Include inactive (soft-deleted) fields. @default false */
  includeInactive?: boolean;
}

/**
 * Arguments for finding a user field definition by ID.
 */
export interface FindUserFieldByIDArgs extends DirectAPIConfig {
  /** Field definition ID (required) */
  id: string;
  /** Return `null` instead of throwing for not-found. @default false */
  disableErrors?: boolean;
}

/**
 * Arguments for creating a user field definition.
 * Only UI-sourced fields can be created via the Direct API.
 */
export interface CreateUserFieldArgs extends DirectAPIConfig {
  /** Field definition data (required) */
  data: {
    /** Unique field name (camelCase) */
    name: string;
    /** Display label */
    label: string;
    /** Field type */
    type:
      | "text"
      | "textarea"
      | "number"
      | "email"
      | "select"
      | "radio"
      | "checkbox"
      | "date";
    /** Whether the field is required */
    required?: boolean;
    /** Default value */
    defaultValue?: string;
    /** Options for select/radio fields */
    options?: { label: string; value: string }[];
    /** Placeholder text */
    placeholder?: string;
    /** Help text / description */
    description?: string;
    /** Display order */
    sortOrder?: number;
  };
}

/**
 * Arguments for updating a user field definition.
 * Code-first fields (`source: 'code'`) cannot be updated.
 */
export interface UpdateUserFieldArgs extends DirectAPIConfig {
  /** Field definition ID (required) */
  id: string;
  /** Partial field definition data */
  data: Partial<CreateUserFieldArgs["data"]>;
}

/**
 * Arguments for deleting a user field definition.
 * Code-first fields (`source: 'code'`) cannot be deleted.
 */
export interface DeleteUserFieldArgs extends DirectAPIConfig {
  /** Field definition ID (required) */
  id: string;
}

/**
 * Arguments for reordering user field definitions.
 */
export interface ReorderUserFieldsArgs extends DirectAPIConfig {
  /** Ordered array of field definition IDs */
  orderedIds: string[];
}

/**
 * Arguments for sending a raw email.
 */
export interface SendEmailArgs extends DirectAPIConfig {
  /**
   * Recipient email address, or several. Every one receives the email: in one
   * message through a provider that takes several `to` addresses, else in one
   * message each, with `cc` and `bcc` on the first.
   */
  to: string | string[];
  /** Email subject line (required) */
  subject: string;
  /** HTML content (required) */
  html: string;
  /** Plain text fallback */
  text?: string;
  /** Override the "from" address */
  from?: string;
  /** @experimental The Reply-To address. */
  replyTo?: string;
  /** CC recipients (carbon copy). */
  cc?: string[];
  /** BCC recipients (blind carbon copy). */
  bcc?: string[];
  /** Use a specific provider instead of the default */
  providerId?: string;
  /**
   * Attachments sourced from the media library.
   * Each entry references a media record by ID; Nextly loads the bytes
   * from storage and forwards to the provider.
   */
  attachments?: EmailAttachmentInput[];
  /**
   * @experimental The person the first `to` address belongs to, by kind and
   * id: a staff user (`{ kind: "staff", id }`) or a plugin-defined person.
   * The delivery record names them, so deleting them erases it. A send naming
   * a staff user who does not exist is refused before anything is sent.
   */
  person?: PrincipalRef;
  /**
   * @experimental Send this message once for the key. A repeat of a send
   * that succeeded returns its result with `repeat: true` and sends nothing;
   * a repeat after a failure sends again; the same key with a different
   * message is refused. Keys from the site's code never meet a plugin's.
   */
  idempotencyKey?: string;
}

/**
 * The data a template renders with: any value, nested objects and lists
 * included, which a template can loop over and branch on, and HTML the
 * calling code marked with `markHtml`. Every value but a marked one is
 * escaped where it is written into HTML.
 */
export type EmailTemplateData = Record<string, unknown>;

/**
 * Arguments for sending an email using a database template.
 */
export interface SendTemplateEmailArgs extends DirectAPIConfig {
  /**
   * Recipient email address, or several. Every one receives the email: in one
   * message through a provider that takes several `to` addresses, else in one
   * message each, with `cc` and `bcc` on the first.
   */
  to: string | string[];
  /** Template slug (required) */
  template: string;
  /**
   * The template's data. Any JSON-shaped value: text, numbers, yes/no, lists
   * and objects, which a template can loop over and branch on. Every value is
   * escaped where it is written into HTML.
   */
  variables?: EmailTemplateData;
  /** Override the "from" address */
  from?: string;
  /** @experimental The Reply-To address. */
  replyTo?: string;
  /** CC recipients (carbon copy). */
  cc?: string[];
  /** BCC recipients (blind carbon copy). */
  bcc?: string[];
  /** Use a specific provider instead of the default */
  providerId?: string;
  /**
   * Attachments sourced from the media library. Merged with the
   * template's default attachments at send-time (Phase 2).
   */
  attachments?: EmailAttachmentInput[];
  /**
   * @experimental The person the first `to` address belongs to, by kind and
   * id: a staff user (`{ kind: "staff", id }`) or a plugin-defined person.
   * The delivery record names them, so deleting them erases it. A send naming
   * a staff user who does not exist is refused before anything is sent.
   */
  person?: PrincipalRef;
  /**
   * @experimental Send this message once for the key. A repeat of a send
   * that succeeded returns its result with `repeat: true` and sends nothing;
   * a repeat after a failure sends again; the same key with a different
   * message is refused. Keys from the site's code never meet a plugin's.
   */
  idempotencyKey?: string;
}

/**
 * Result of an email send operation.
 */
export interface SendEmailResult {
  /** Whether the email was sent successfully */
  success: boolean;
  /** Provider-assigned message ID (on success) */
  messageId?: string;
  /**
   * Why the send failed (on failure): the same sentence as `failure.reason`.
   */
  error?: string;
  /**
   * @experimental On failure: whether a retry can help, the provider's status
   * where it gave one, and a short reason free of configuration and secrets.
   */
  failure?: EmailFailure;
  /**
   * @experimental Recipients the provider refused while taking the message,
   * by line and position, never by address.
   */
  refused?: RefusedRecipient[];
  /**
   * @experimental The result of an earlier send with the same idempotency
   * key; nothing was sent this time.
   */
  repeat?: true;
}
