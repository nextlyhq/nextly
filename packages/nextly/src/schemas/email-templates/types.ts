/**
 * Dialect-Agnostic Type Definitions for Email Templates
 *
 * These types define the structure for the `email_templates` table
 * used to manage email templates with variable interpolation via
 * the Admin UI. All dialect-specific schemas (PostgreSQL, MySQL,
 * SQLite) will implement these interfaces.
 *
 * @module schemas/email-templates/types
 * @since 1.0.0
 */

import type { EmailAttachmentInput } from "../../domains/email/types";

// ============================================================
// Email Template Variable Type
// ============================================================

/**
 * Describes a variable available for interpolation in an email template.
 *
 * Variables are referenced in template `subject` and `htmlContent` using
 * `{{name}}` syntax. The `description` field documents the variable's
 * purpose for admin UI display.
 *
 * @example
 * ```typescript
 * const vars: EmailTemplateVariable[] = [
 *   { name: 'userName', description: 'The recipient user name', required: true },
 *   { name: 'resetLink', description: 'Password reset URL', required: true },
 *   { name: 'expiresIn', description: 'Token expiration time' },
 * ];
 * ```
 */
export interface EmailTemplateVariable {
  /** Variable name used in `{{name}}` placeholders. */
  name: string;

  /** Human-readable description shown in the admin UI. */
  description: string;

  /**
   * Whether this variable must be provided when sending the template.
   * @default false
   */
  required?: boolean;
}

// ============================================================
// Email Template Insert Type
// ============================================================

/**
 * Insert type for creating a new email template.
 *
 * Contains all required and optional fields for inserting a template
 * into the `email_templates` table. Fields with defaults (like
 * `useLayout`, `isActive`) are optional on insert.
 *
 * @example
 * ```typescript
 * const newTemplate: EmailTemplateInsert = {
 *   name: 'Welcome Email',
 *   slug: 'welcome',
 *   subject: 'Welcome to {{appName}}, {{userName}}!',
 *   htmlContent: '<h1>Welcome, {{userName}}!</h1><p>Thanks for joining.</p>',
 *   variables: [
 *     { name: 'userName', description: 'The new user name', required: true },
 *     { name: 'appName', description: 'Application name', required: true },
 *   ],
 * };
 * ```
 */
export interface EmailTemplateInsert {
  /** Display name for this template (e.g., "Welcome Email", "Password Reset"). */
  name: string;

  /**
   * Unique identifier slug (e.g., "welcome", "password-reset").
   * Used to reference templates programmatically via the Direct API.
   */
  slug: string;

  /**
   * Email subject line. Supports `{{variable}}` interpolation.
   * @example 'Reset your {{appName}} password'
   */
  subject: string;

  /**
   * HTML body content. Supports `{{variable}}` interpolation.
   * When `useLayout` is true, this content is wrapped with the
   * shared header/footer layout.
   */
  htmlContent: string;

  /**
   * Optional plain text fallback content. Supports `{{variable}}` interpolation.
   * When null, a plain text version may be auto-generated from `htmlContent`.
   */
  plainTextContent?: string | null;

  /**
   * Available template variables with descriptions.
   * Displayed in the admin UI template editor for reference.
   * When null, no variables are documented (template may still use interpolation).
   */
  variables?: EmailTemplateVariable[] | null;

  /**
   * Whether to wrap `htmlContent` with the shared email header/footer layout.
   * @default true
   */
  useLayout?: boolean;

  /**
   * Whether this template is currently active.
   * Inactive templates are stored but cannot be used for sending.
   * @default true
   */
  isActive?: boolean;

  /**
   * Optional provider ID to override the default email provider for this template.
   * When null, the system default provider is used.
   */
  providerId?: string | null;

  /**
   * Default attachments for this template. Merged with per-send attachments
   * at send time (dedupe by mediaId, per-send wins). Null/omitted means
   * no default attachments.
   */
  attachments?: EmailAttachmentInput[] | null;
}

// ============================================================
// Email Template Record Type
// ============================================================

/**
 * Full record type for an email template.
 *
 * Extends `EmailTemplateInsert` with all required fields that are
 * set by the database (id, timestamps) or have default values.
 *
 * @example
 * ```typescript
 * const template: EmailTemplateRecord = {
 *   id: 'uuid-456',
 *   name: 'Password Reset',
 *   slug: 'password-reset',
 *   subject: 'Reset your {{appName}} password',
 *   htmlContent: '<h1>Password Reset</h1><p>Click <a href="{{resetLink}}">here</a>.</p>',
 *   plainTextContent: null,
 *   variables: [
 *     { name: 'resetLink', description: 'Password reset URL', required: true },
 *     { name: 'appName', description: 'Application name', required: true },
 *   ],
 *   useLayout: true,
 *   isActive: true,
 *   providerId: null,
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface EmailTemplateRecord extends EmailTemplateInsert {
  /** Unique identifier (UUID or CUID). */
  id: string;

  /** Plain text fallback content (required on record, nullable). */
  plainTextContent: string | null;

  /** Available template variables (required on record, nullable). */
  variables: EmailTemplateVariable[] | null;

  /** Whether to wrap with shared layout (required on record). */
  useLayout: boolean;

  /** Whether this template is active (required on record). */
  isActive: boolean;

  /** Optional provider override (required on record, nullable). */
  providerId: string | null;

  /** Default attachments (required on record, nullable). */
  attachments: EmailAttachmentInput[] | null;

  /** When the template was created. */
  createdAt: Date;

  /** When the template was last updated. */
  updatedAt: Date;
}
