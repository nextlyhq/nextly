/**
 * Direct API Email Type Definitions
 *
 * Argument types for email providers, email templates, user field definitions,
 * and the email send API.
 *
 * @packageDocumentation
 */

import type { EmailAttachmentInput } from "../../domains/email/types";

import type { DirectAPIConfig } from "./shared";

export type { EmailAttachmentInput };

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
    type: "smtp" | "resend" | "sendlayer";
    /** From email address */
    fromEmail: string;
    /** From display name */
    fromName?: string;
    /** Provider-specific configuration (credentials encrypted at rest) */
    configuration: Record<string, unknown>;
    /** Mark as default provider */
    isDefault?: boolean;
  };
}

/**
 * Arguments for updating an email provider.
 */
export interface UpdateEmailProviderArgs extends DirectAPIConfig {
  /** Provider ID (required) */
  id: string;
  /** Partial provider data */
  data: Partial<CreateEmailProviderArgs["data"]>;
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
  };
}

/**
 * Arguments for updating an email template.
 */
export interface UpdateEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /** Partial template data */
  data: Partial<CreateEmailTemplateArgs["data"]>;
}

/**
 * Arguments for deleting an email template.
 */
export interface DeleteEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
}

/**
 * Arguments for previewing an email template with variable data.
 */
export interface PreviewEmailTemplateArgs extends DirectAPIConfig {
  /** Template ID (required) */
  id: string;
  /** Variable values for interpolation */
  data?: Record<string, string>;
}

/**
 * Arguments for getting the shared email layout (header/footer).
 */
export interface GetEmailLayoutArgs extends DirectAPIConfig {}

/**
 * Arguments for updating the shared email layout (header/footer).
 */
export interface UpdateEmailLayoutArgs extends DirectAPIConfig {
  /** Layout data */
  data: {
    /** Header HTML content */
    header?: string;
    /** Footer HTML content */
    footer?: string;
  };
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
  /** Recipient email address(es) */
  to: string | string[];
  /** Email subject line (required) */
  subject: string;
  /** HTML content (required) */
  html: string;
  /** Plain text fallback */
  text?: string;
  /** Override the "from" address */
  from?: string;
  /** Use a specific provider instead of the default */
  providerId?: string;
  /**
   * Attachments sourced from the media library.
   * Each entry references a media record by ID; Nextly loads the bytes
   * from storage and forwards to the provider.
   */
  attachments?: EmailAttachmentInput[];
}

/**
 * Arguments for sending an email using a database template.
 */
export interface SendTemplateEmailArgs extends DirectAPIConfig {
  /** Recipient email address(es) */
  to: string | string[];
  /** Template slug (required) */
  template: string;
  /** Variables for template interpolation */
  variables?: Record<string, string>;
  /** Override the "from" address */
  from?: string;
  /** Use a specific provider instead of the default */
  providerId?: string;
  /**
   * Attachments sourced from the media library. Merged with the
   * template's default attachments at send-time (Phase 2).
   */
  attachments?: EmailAttachmentInput[];
}

/**
 * Result of an email send operation.
 */
export interface SendEmailResult {
  /** Whether the email was sent successfully */
  success: boolean;
  /** Provider-assigned message ID (on success) */
  messageId?: string;
  /** Error message (on failure) */
  error?: string;
}
