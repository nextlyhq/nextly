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
import type {
  TemplateFormat,
  WrittenDocument,
} from "../../domains/email/written/document";

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
// Email Template Kind
// ============================================================

/**
 * Row kind discriminator for the unified `email_templates` table.
 *
 * - `template` — a message body sent to recipients (the default).
 * - `layout` — a wrapper whose `htmlContent` holds a `{{content}}`
 *   placeholder where a template body is injected at send time.
 * - `partial` — a reusable fragment (reserved for future use).
 */
export type EmailTemplateKind = "template" | "layout" | "partial";

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
   * Inbox preview line shown after the subject. Supports `{{variable}}`
   * interpolation. When null/omitted, no preheader is rendered.
   */
  preheader?: string | null;

  /**
   * Row kind. Omit for a normal message body (`template`).
   * @default 'template'
   */
  kind?: EmailTemplateKind;

  /**
   * Layout row (`kind = 'layout'`) that wraps this template at send time.
   * When null/omitted, the default layout is used.
   */
  layoutId?: string | null;

  /**
   * Per-template From override (e.g. `Support <help@example.com>`).
   * When null/omitted, the provider / config From is used. The display name
   * may use the send's variables (`{{shopName}} <shop@example.com>`); the
   * address may not.
   */
  fromOverride?: string | null;

  /**
   * Per-template Reply-To address. When null/omitted, no Reply-To is set. May
   * use the send's variables (`{{customerEmail}}`); a send whose rendered
   * Reply-To is not an address fails, as retrying cannot fix it.
   */
  replyTo?: string | null;

  /**
   * Fixed addresses copied on every send, after the send's own copies, with
   * no address twice. Never variables, and refused on a template its owner
   * marks as carrying a secret.
   */
  cc?: string[] | null;

  /** Fixed addresses blind-copied on every send, on the same rules as `cc`. */
  bcc?: string[] | null;

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

  /**
   * When the template is sent, in a sentence. Owners write one for each
   * template they own; a site may write one for its own.
   */
  description?: string | null;

  /**
   * Whether the template is written (blocks) or coded (HTML); coded when
   * unset. A written template's `htmlContent` and `plainTextContent` are
   * written from its blocks, never edited directly.
   *
   * @experimental
   */
  format?: TemplateFormat | null;

  /**
   * A written template's blocks; absent for a coded one.
   *
   * @experimental
   */
  blocks?: WrittenDocument | null;
}

// ============================================================
// Ownership
// ============================================================

/**
 * Who a template belongs to.
 *
 * - `core`: one of Nextly's own templates or layouts.
 * - `plugin`: contributed by the plugin named `name`. `installed` is false when
 *   that plugin is no longer running; its templates are kept, and the site may
 *   delete them.
 * - `site`: made by the site.
 */
export type EmailTemplateOwner =
  | { kind: "core" }
  | { kind: "plugin"; name: string; installed: boolean }
  | { kind: "site" };

/** The stored owner kinds. */
export type EmailTemplateOwnerKind = EmailTemplateOwner["kind"];

/**
 * The part of a template its owner versions and a site's override replaces:
 * what the email says. Settings such as the provider, the layout, From,
 * Reply-To, attachments and whether it is active are the site's and are never
 * changed by an owner update.
 */
export interface EmailTemplateVersion {
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  preheader: string | null;
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

  /** Inbox preview line (required on record, nullable). */
  preheader: string | null;

  /** Row kind (required on record). */
  kind: EmailTemplateKind;

  /** Written or coded (required on record); a row stored before written templates is coded. */
  format: TemplateFormat;

  /** A written template's blocks (required on record, null for a coded one). */
  blocks: WrittenDocument | null;

  /** Wrapping layout id (required on record, nullable). */
  layoutId: string | null;

  /** Per-template From override (required on record, nullable). */
  fromOverride: string | null;

  /** Per-template Reply-To (required on record, nullable). */
  replyTo: string | null;

  /** Fixed copies (required on record, nullable). */
  cc: string[] | null;

  /** Fixed blind copies (required on record, nullable). */
  bcc: string[] | null;

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

  /** When the template is sent (required on record, nullable). */
  description: string | null;

  /** Who owns the template. */
  owner: EmailTemplateOwner;

  /**
   * Whether the template's owner marks it as carrying a secret, such as a
   * reset or verification link. Declared by the owner and never editable:
   * such a template takes no `cc` or `bcc`, and any stored on it are not sent.
   */
  carriesSecret: boolean;

  /**
   * Whether the site has overridden an owned template. Always false for a
   * site's own template, which has nothing to override.
   */
  overridden: boolean;

  /**
   * Whether the owner's version changed since the override started, so an
   * update is waiting for review. False when not overridden.
   */
  ownerChanged: boolean;

  /**
   * Whether the site's code sets this template (`email.templates` in
   * `defineConfig()`). Such a version is sent while the template is not
   * overridden.
   */
  setInCode: boolean;
}
