/**
 * Form Builder Plugin Types
 *
 * Defines configuration options and types for the form builder plugin.
 *
 * @packageDocumentation
 */

import type {
  CollectionConfig,
  FieldDefinition,
  RequestContext,
} from "@revnixhq/nextly";
import type { ComponentType } from "react";

// ============================================================
// Supporting Types
// ============================================================

/**
 * Configuration for customizing field block behavior.
 */
export interface FieldBlockConfig {
  /** Default label for this field type */
  label?: string;
  /** Default validation settings */
  validation?: Record<string, unknown>;
  /** Custom component to use for this field type */
  component?: ComponentType<unknown>;
}

/**
 * Email configuration for notifications.
 */
export interface EmailConfig {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

/**
 * A single email notification integration stored on a form.
 * Matches the shape saved by the form builder admin UI.
 */
export interface FormNotificationItem {
  /** Unique ID for this notification */
  id: string;
  /** Display name for this integration */
  name: string;
  /** Whether this notification is active */
  enabled: boolean;
  /** ID of the email provider to use; undefined = system default */
  providerId?: string;
  /** Sender email override; undefined = use provider's configured address */
  senderEmail?: string;
  /** How the recipient address is determined */
  recipientType: "static" | "field";
  /** Recipient: static email address or a {{fieldName}} reference */
  to: string;
  /** CC email addresses */
  cc: string[];
  /** BCC email addresses */
  bcc: string[];
  /** Slug of the email template to use */
  templateSlug?: string;
}

/**
 * Form document structure (stored in database).
 */
export interface FormDocument {
  id: string;
  slug: string;
  name: string;
  fields: FormField[];
  settings: FormSettings;
  notifications: FormNotificationItem[];
  webhooks?: WebhookConfig[];
  status: "draft" | "published" | "closed";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Submission document structure (stored in database).
 */
export interface SubmissionDocument {
  id: string;
  form: string | FormDocument;
  data: Record<string, unknown>;
  status: "new" | "read" | "archived";
  ipAddress?: string;
  userAgent?: string;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Plugin Configuration
// ============================================================

/**
 * Configuration options for the form builder plugin.
 */
export interface FormBuilderPluginOptions {
  /**
   * Override the default Forms collection configuration.
   *
   * Allows customizing the slug, labels, fields, access control, and other
   * collection options.
   *
   * The `fields` option can be:
   * - An array of fields (merged with defaults)
   * - A function receiving `{ defaultFields }` for full control
   *
   * @example
   * ```typescript
   * // Option 1: Array (fields merged with defaults)
   * formOverrides: {
   *   slug: 'my-forms',
   *   labels: { singular: 'My Form', plural: 'My Forms' },
   *   access: {
   *     read: () => true,
   *     create: ({ roles }) => roles.includes('admin'),
   *   },
   *   fields: [
   *     text({ name: 'internalNotes', label: 'Internal Notes' }),
   *   ],
   * }
   *
   * // Option 2: Function (full control over fields)
   * formOverrides: {
   *   slug: 'contact-forms',
   *   access: {
   *     read: ({ user }) => !!user,
   *     update: () => false,
   *   },
   *   fields: ({ defaultFields }) => {
   *     return [
   *       ...defaultFields,
   *       { name: 'custom', type: 'text' },
   *     ];
   *   },
   * }
   * ```
   */
  formOverrides?: Partial<CollectionConfig> & {
    slug?: string;
    labels?: {
      singular?: string;
      plural?: string;
    };
    /** Fields can be an array or a function receiving defaultFields */
    fields?:
      | FieldDefinition[]
      | ((args: { defaultFields: FieldDefinition[] }) => FieldDefinition[]);
  };

  /**
   * Override the default Form Submissions collection configuration.
   *
   * Allows customizing the slug, labels, fields, access control, and other
   * collection options.
   *
   * The `fields` option can be:
   * - An array of fields (merged with defaults)
   * - A function receiving `{ defaultFields }` for full control
   *
   * @example
   * ```typescript
   * // Option 1: Array (fields merged with defaults)
   * formSubmissionOverrides: {
   *   slug: 'my-submissions',
   *   labels: { singular: 'Response', plural: 'Responses' },
   *   access: {
   *     read: ({ roles }) => roles.includes('admin'),
   *   },
   *   fields: [
   *     select({
   *       name: 'priority',
   *       label: 'Priority',
   *       options: [
   *         { label: 'Low', value: 'low' },
   *         { label: 'High', value: 'high' },
   *       ],
   *     }),
   *   ],
   * }
   *
   * // Option 2: Function (full control over fields)
   * formSubmissionOverrides: {
   *   fields: ({ defaultFields }) => {
   *     // Add field after 'form' field
   *     const formIndex = defaultFields.findIndex(f => f.name === 'form');
   *     return [
   *       ...defaultFields.slice(0, formIndex + 1),
   *       { name: 'source', type: 'text' },
   *       ...defaultFields.slice(formIndex + 1),
   *     ];
   *   },
   * }
   * ```
   */
  formSubmissionOverrides?: Partial<CollectionConfig> & {
    slug?: string;
    labels?: {
      singular?: string;
      plural?: string;
    };
    /** Fields can be an array or a function receiving defaultFields */
    fields?:
      | FieldDefinition[]
      | ((args: { defaultFields: FieldDefinition[] }) => FieldDefinition[]);
  };

  /**
   * @deprecated Use `formOverrides` and `formSubmissionOverrides` instead.
   * This option is kept for backward compatibility.
   */
  collections?: {
    forms?: Partial<CollectionConfig> & {
      slug?: string;
      labels?: {
        singular?: string;
        plural?: string;
      };
    };
    submissions?: Partial<CollectionConfig> & {
      slug?: string;
      labels?: {
        singular?: string;
        plural?: string;
      };
    };
  };

  /**
   * Configure which field types are available in the form builder.
   *
   * Set to `false` to disable a field type, or provide partial configuration
   * to customize default behavior.
   *
   * @example
   * ```typescript
   * fields: {
   *   // Disable payment field
   *   payment: false,
   *
   *   // Customize text field defaults
   *   text: {
   *     maxLength: 500,
   *   },
   *
   *   // Disable file uploads
   *   file: false,
   * }
   * ```
   */
  fields?: {
    text?: boolean | Partial<FieldBlockConfig>;
    email?: boolean | Partial<FieldBlockConfig>;
    number?: boolean | Partial<FieldBlockConfig>;
    phone?: boolean | Partial<FieldBlockConfig>;
    url?: boolean | Partial<FieldBlockConfig>;
    textarea?: boolean | Partial<FieldBlockConfig>;
    select?: boolean | Partial<FieldBlockConfig>;
    checkbox?: boolean | Partial<FieldBlockConfig>;
    radio?: boolean | Partial<FieldBlockConfig>;
    file?: boolean | Partial<FieldBlockConfig>;
    date?: boolean | Partial<FieldBlockConfig>;
    time?: boolean | Partial<FieldBlockConfig>;
    hidden?: boolean | Partial<FieldBlockConfig>;
  };

  /**
   * Collections that can be used as redirect targets after form submission.
   *
   * When specified, the form builder will allow selecting documents from
   * these collections as redirect destinations.
   *
   * @example
   * ```typescript
   * redirectRelationships: ['pages', 'posts', 'landing-pages']
   * ```
   */
  redirectRelationships?: string[];

  /**
   * Hook called before sending email notifications.
   *
   * Allows modifying, adding, or filtering emails before they are sent.
   * Return the modified emails array.
   *
   * @example
   * ```typescript
   * beforeEmail: async ({ emails, form, submission }) => {
   *   // Add BCC to all emails
   *   return emails.map(email => ({
   *     ...email,
   *     bcc: ['archive@example.com'],
   *   }));
   * }
   * ```
   */
  beforeEmail?: (args: {
    emails: EmailConfig[];
    form: FormDocument;
    submission: SubmissionDocument;
  }) => Promise<EmailConfig[]> | EmailConfig[];

  /**
   * Email notification settings.
   */
  notifications?: {
    /**
     * Default "from" email address.
     */
    defaultFrom?: string;

    /**
     * Default "to" email address for all form submissions.
     *
     * If specified, this email will receive all form submissions
     * regardless of form-specific notification settings.
     * @example
     * ```typescript
     * notifications: {
     *   defaultToEmail: 'submissions@example.com',
     * }
     * ```
     */
    defaultToEmail?: string;

    /**
     * Enable/disable email notifications globally.
     * @default true
     */
    enabled?: boolean;
  };

  /**
   * Spam protection configuration.
   */
  spamProtection?: {
    /**
     * Enable honeypot field for spam detection.
     * @default true
     */
    honeypot?: boolean;

    /**
     * Enable reCAPTCHA v3.
     * @default false
     */
    recaptcha?: {
      enabled: boolean;
      siteKey?: string;
      secretKey?: string;
      scoreThreshold?: number; // 0.0 - 1.0
    };

    /**
     * Rate limiting configuration.
     */
    rateLimit?: {
      /**
       * Maximum submissions per window.
       * @default 10
       */
      maxSubmissions?: number;

      /**
       * Time window in milliseconds.
       * @default 60000 (1 minute)
       */
      windowMs?: number;
    };
  };

  /**
   * File upload settings.
   */
  uploads?: {
    /**
     * Maximum file size in bytes.
     * @default 10485760 (10MB)
     */
    maxFileSize?: number;

    /**
     * Allowed file types (MIME types).
     * @default ['image/*', 'application/pdf', 'text/*']
     */
    allowedMimeTypes?: string[];

    /**
     * Collection to store uploaded files.
     * @default 'media'
     */
    uploadCollection?: string;
  };

  /**
   * Enable/disable features.
   */
  features?: {
    /**
     * Enable visual form builder UI.
     * @default true
     */
    builder?: boolean;

    /**
     * Enable conditional logic.
     * @default true
     */
    conditionalLogic?: boolean;

    /**
     * Enable file uploads.
     * @default true
     */
    fileUploads?: boolean;
  };
}

// ============================================================
// Form Configuration Types
// ============================================================

/**
 * Form configuration interface.
 * Similar to CollectionConfig but tailored for forms.
 */
export interface FormConfig {
  /**
   * Unique identifier for the form.
   */
  slug: string;

  /**
   * Display labels for the form.
   */
  labels?: {
    singular?: string;
    plural?: string;
  };

  /**
   * Form fields definition.
   */
  fields: FormField[];

  /**
   * Form settings and behavior.
   */
  settings?: FormSettings;

  /**
   * Email notification configuration.
   */
  notifications?: FormNotifications;

  /**
   * Access control for form submission and viewing.
   */
  access?: FormAccess;

  /**
   * Lifecycle hooks for form submissions.
   */
  hooks?: FormHooks;

  /**
   * Custom metadata.
   */
  custom?: Record<string, unknown>;
}

// ============================================================
// Form Field Types (Discriminated Union)
// ============================================================

/**
 * Form field type (discriminated union).
 * Uses the `type` property as the discriminant.
 */
export type FormField =
  | TextFormField
  | EmailFormField
  | NumberFormField
  | PhoneFormField
  | UrlFormField
  | TextareaFormField
  | SelectFormField
  | CheckboxFormField
  | RadioFormField
  | FileFormField
  | DateFormField
  | TimeFormField
  | HiddenFormField;

/**
 * All available form field type identifiers.
 */
export type FormFieldType =
  | "text"
  | "email"
  | "number"
  | "phone"
  | "url"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "date"
  | "time"
  | "hidden";

/**
 * Base form field properties.
 * All form field types extend this interface.
 */
export interface BaseFormField {
  /** Field type identifier (discriminant) */
  type: FormFieldType;

  /** Field name (used as key in submission data) */
  name: string;

  /** Display label */
  label: string;

  /** Placeholder text */
  placeholder?: string;

  /** Help text shown below field */
  helpText?: string;

  /** Default value */
  defaultValue?: unknown;

  /** Whether field is required */
  required?: boolean;

  /** Validation rules */
  validation?: ValidationRules;

  /** Conditional logic configuration */
  conditionalLogic?: ConditionalLogic;

  /** Admin UI configuration */
  admin?: {
    /** CSS classes */
    className?: string;

    /** Field width */
    width?: "25%" | "33%" | "50%" | "66%" | "75%" | "100%";
  };
}

/**
 * Text input field.
 */
export interface TextFormField extends Omit<BaseFormField, "type"> {
  type: "text";
  defaultValue?: string;
  validation?: ValidationRules & {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

/**
 * Email input field.
 */
export interface EmailFormField extends Omit<BaseFormField, "type"> {
  type: "email";
  defaultValue?: string;
  validation?: ValidationRules & {
    pattern?: string;
  };
}

/**
 * Number input field.
 */
export interface NumberFormField extends Omit<BaseFormField, "type"> {
  type: "number";
  defaultValue?: number;
  validation?: ValidationRules & {
    min?: number;
    max?: number;
    step?: number;
  };
}

/**
 * Phone input field.
 */
export interface PhoneFormField extends Omit<BaseFormField, "type"> {
  type: "phone";
  defaultValue?: string;
  validation?: ValidationRules & {
    pattern?: string;
  };
}

/**
 * URL input field.
 */
export interface UrlFormField extends Omit<BaseFormField, "type"> {
  type: "url";
  defaultValue?: string;
  validation?: ValidationRules & {
    pattern?: string;
  };
}

/**
 * Textarea field.
 */
export interface TextareaFormField extends Omit<BaseFormField, "type"> {
  type: "textarea";
  defaultValue?: string;
  rows?: number;
  validation?: ValidationRules & {
    minLength?: number;
    maxLength?: number;
  };
}

/**
 * Select dropdown field.
 */
export interface SelectFormField extends Omit<BaseFormField, "type"> {
  type: "select";
  options: Array<{ label: string; value: string }>;
  defaultValue?: string | string[];
  allowMultiple?: boolean;
}

/**
 * Single checkbox field.
 */
export interface CheckboxFormField extends Omit<BaseFormField, "type"> {
  type: "checkbox";
  defaultValue?: boolean;
}

/**
 * Radio group field.
 */
export interface RadioFormField extends Omit<BaseFormField, "type"> {
  type: "radio";
  options: Array<{ label: string; value: string }>;
  defaultValue?: string;
}

/**
 * File upload field.
 */
export interface FileFormField extends Omit<BaseFormField, "type"> {
  type: "file";
  accept?: string; // MIME types
  multiple?: boolean;
  maxFileSize?: number; // bytes
  /**
   * When true, files uploaded through this field are attached to all
   * notification emails for this form. Default false.
   */
  attachToEmail?: boolean;
}

/**
 * Date picker field.
 */
export interface DateFormField extends Omit<BaseFormField, "type"> {
  type: "date";
  defaultValue?: string; // ISO date string
  min?: string; // ISO date
  max?: string; // ISO date
}

/**
 * Time picker field.
 */
export interface TimeFormField extends Omit<BaseFormField, "type"> {
  type: "time";
  defaultValue?: string; // HH:mm format
}

/**
 * Hidden field.
 */
export interface HiddenFormField extends Omit<BaseFormField, "type"> {
  type: "hidden";
  defaultValue?: string;
}

// ============================================================
// Validation Types
// ============================================================

/**
 * Validation rules for form fields.
 */
export interface ValidationRules {
  /** Custom error message */
  errorMessage?: string;

  /** Custom validation function */
  validate?: (
    value: unknown,
    formData: Record<string, unknown>
  ) => boolean | string | Promise<boolean | string>;
}

// ============================================================
// Conditional Logic Types
// ============================================================

/**
 * Conditional logic configuration.
 */
export interface ConditionalLogic {
  /** Whether conditional logic is enabled */
  enabled: boolean;

  /** Action to perform when conditions are met */
  action: "show" | "hide";

  /** Logical operator for multiple conditions */
  operator: "AND" | "OR";

  /** Conditions to evaluate */
  conditions: ConditionalLogicCondition[];
}

/**
 * A single conditional logic condition.
 */
export interface ConditionalLogicCondition {
  /** Field name to check */
  field: string;

  /** Comparison operator */
  comparison:
    | "equals"
    | "notEquals"
    | "contains"
    | "isEmpty"
    | "isNotEmpty"
    | "greaterThan"
    | "lessThan";

  /** Value to compare against (not used for isEmpty/isNotEmpty) */
  value?: unknown;
}

// ============================================================
// Form Settings Types
// ============================================================

/**
 * Form settings and behavior.
 */
export interface FormSettings {
  /** Submit button text */
  submitButtonText?: string;

  /**
   * Confirmation type after successful submission.
   * - "message": Display a success message
   * - "redirect": Redirect to a URL or linked document
   *
   * @default "message"
   */
  confirmationType?: "message" | "redirect";

  /** Success message (supports HTML) - used when confirmationType is "message" */
  successMessage?: string;

  /** Redirect URL after successful submission - used when confirmationType is "redirect" */
  redirectUrl?: string;

  /**
   * Relationship to redirect document - used when confirmationType is "redirect"
   * and redirectRelationships are configured in plugin options.
   */
  redirectRelation?: {
    relationTo: string;
    value: string; // Document ID
  };

  /** Allow multiple submissions from same user/IP */
  allowMultipleSubmissions?: boolean;

  /** reCAPTCHA configuration */
  captcha?: {
    enabled: boolean;
    siteKey?: string;
  };
}

// ============================================================
// Notification Types
// ============================================================

/**
 * Email notification configuration for a form.
 */
export interface FormNotifications {
  /** Enable email notifications */
  enabled: boolean;

  /** Recipient email addresses */
  recipients: Array<{
    email: string;
    name?: string;
  }>;

  /** Email subject line */
  subject?: string;

  /** Use submitter's email as reply-to */
  replyTo?: boolean;

  /** Custom email template */
  template?: string; // HTML template

  /**
   * Webhook endpoints to notify on form events.
   *
   * Webhooks are fired asynchronously and do not block form submission.
   * Failed webhooks are logged but do not cause submission failures.
   *
   * @example
   * ```typescript
   * webhooks: [
   *   {
   *     url: 'https://api.example.com/webhooks/form-submissions',
   *     events: ['submission.created'],
   *     secret: 'your-webhook-secret', // Optional HMAC signature
   *   },
   *   {
   *     url: 'https://crm.example.com/api/leads',
   *     events: ['submission.created', 'submission.updated'],
   *     headers: { 'X-API-Key': 'abc123' },
   *     includeData: true,
   *   },
   * ]
   * ```
   */
  webhooks?: WebhookConfig[];
}

// ============================================================
// Webhook Types
// ============================================================

/**
 * Webhook event types.
 */
export type WebhookEvent =
  | "submission.created"
  | "submission.updated"
  | "submission.deleted";

/**
 * Configuration for a webhook endpoint.
 */
export interface WebhookConfig {
  /** Webhook URL to send POST requests to */
  url: string;

  /**
   * HTTP method for the webhook request.
   * @default "POST"
   */
  method?: "POST" | "PUT";

  /**
   * Custom headers to include in the webhook request.
   * Useful for authentication tokens or API keys.
   */
  headers?: Record<string, string>;

  /**
   * Events that trigger this webhook.
   * Must include at least one event.
   */
  events: WebhookEvent[];

  /**
   * Whether to include full submission data in the webhook payload.
   * If false, only submission ID and timestamp are included.
   * @default true
   */
  includeData?: boolean;

  /**
   * Secret key for HMAC-SHA256 signature verification.
   *
   * When provided, the webhook request will include an
   * `X-Webhook-Signature` header containing the signature:
   * `sha256=<hex-encoded-hmac>`
   *
   * Recipients can verify the signature to ensure the webhook
   * originated from your server and wasn't tampered with.
   *
   * @example
   * ```typescript
   * // Verifying the signature on the receiving end (Node.js):
   * const crypto = require('crypto');
   * const expectedSignature = req.headers['x-webhook-signature'];
   * const payload = JSON.stringify(req.body);
   * const signature = 'sha256=' + crypto
   *   .createHmac('sha256', secret)
   *   .update(payload)
   *   .digest('hex');
   * const isValid = crypto.timingSafeEqual(
   *   Buffer.from(expectedSignature),
   *   Buffer.from(signature)
   * );
   * ```
   */
  secret?: string;
}

// ============================================================
// Access Control Types
// ============================================================

/**
 * Form access control.
 */
export interface FormAccess {
  /** Who can submit the form */
  submit?: (context: { req: RequestContext }) => boolean | Promise<boolean>;

  /** Who can view submissions */
  read?: (context: { req: RequestContext }) => boolean | Promise<boolean>;
}

// ============================================================
// Hook Types
// ============================================================

/**
 * Form lifecycle hooks.
 */
export interface FormHooks {
  /** Before submission validation */
  beforeValidate?: Array<(context: FormHookContext) => void | Promise<void>>;

  /** Before submission is saved */
  beforeSubmit?: Array<(context: FormHookContext) => void | Promise<void>>;

  /** After submission is saved */
  afterSubmit?: Array<(context: FormHookContext) => void | Promise<void>>;
}

/**
 * Hook context for form hooks.
 */
export interface FormHookContext {
  /** Form configuration */
  form: FormConfig;

  /** Submission data */
  data: Record<string, unknown>;

  /** Request context */
  req: RequestContext;

  /** Submission metadata */
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
  };
}

// ============================================================
// Submission Types
// ============================================================

/**
 * Form submission data structure.
 */
export interface FormSubmission {
  /** Submission ID */
  id: string;

  /** Form slug */
  formSlug: string;

  /** Submission data (JSON) */
  data: Record<string, unknown>;

  /** Submission status */
  status: "new" | "read" | "archived";

  /** Internal notes (admin only) */
  notes?: string;

  /** Metadata */
  ipAddress?: string;
  userAgent?: string;
  submittedAt: Date;

  /** Created/updated timestamps */
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Resolved Configuration Types (Internal)
// ============================================================

/**
 * Resolved form builder configuration after applying defaults.
 * Used internally by the plugin.
 */
export interface ResolvedFormBuilderConfig {
  formOverrides: {
    slug: string;
    labels: {
      singular: string;
      plural: string;
    };
  } & Partial<CollectionConfig>;

  formSubmissionOverrides: {
    slug: string;
    labels: {
      singular: string;
      plural: string;
    };
  } & Partial<CollectionConfig>;

  fields: {
    text: boolean | Partial<FieldBlockConfig>;
    email: boolean | Partial<FieldBlockConfig>;
    number: boolean | Partial<FieldBlockConfig>;
    phone: boolean | Partial<FieldBlockConfig>;
    url: boolean | Partial<FieldBlockConfig>;
    textarea: boolean | Partial<FieldBlockConfig>;
    select: boolean | Partial<FieldBlockConfig>;
    checkbox: boolean | Partial<FieldBlockConfig>;
    radio: boolean | Partial<FieldBlockConfig>;
    file: boolean | Partial<FieldBlockConfig>;
    date: boolean | Partial<FieldBlockConfig>;
    time: boolean | Partial<FieldBlockConfig>;
    hidden: boolean | Partial<FieldBlockConfig>;
  };

  redirectRelationships: string[];

  beforeEmail?: FormBuilderPluginOptions["beforeEmail"];

  notifications: {
    defaultFrom?: string;
    defaultToEmail?: string;
    enabled: boolean;
  };

  spamProtection: {
    honeypot: boolean;
    recaptcha?: {
      enabled: boolean;
      siteKey?: string;
      secretKey?: string;
      scoreThreshold?: number;
    };
    rateLimit?: {
      maxSubmissions: number;
      windowMs: number;
    };
  };

  uploads: {
    maxFileSize: number;
    allowedMimeTypes: string[];
    uploadCollection: string;
  };

  features: {
    builder: boolean;
    conditionalLogic: boolean;
    fileUploads: boolean;
  };
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Check if a value is a FormField.
 */
export function isFormField(value: unknown): value is FormField {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "name" in value &&
    "label" in value
  );
}

/**
 * Check if a FormField is a specific type.
 */
export function isFormFieldType<T extends FormField>(
  field: FormField,
  type: T["type"]
): field is T {
  return field.type === type;
}

/**
 * Type guard for text field.
 */
export function isTextFormField(field: FormField): field is TextFormField {
  return field.type === "text";
}

/**
 * Type guard for email field.
 */
export function isEmailFormField(field: FormField): field is EmailFormField {
  return field.type === "email";
}

/**
 * Type guard for select field.
 */
export function isSelectFormField(field: FormField): field is SelectFormField {
  return field.type === "select";
}

/**
 * Type guard for checkbox field.
 */
export function isCheckboxFormField(
  field: FormField
): field is CheckboxFormField {
  return field.type === "checkbox";
}

/**
 * Type guard for file field.
 */
export function isFileFormField(field: FormField): field is FileFormField {
  return field.type === "file";
}
