/**
 * Form Field Helpers
 *
 * Convenient factory functions for creating form field configurations.
 * These helpers eliminate the need to manually specify the `type` property,
 * providing a cleaner, more ergonomic API for form definitions.
 *
 * @module config/field-helpers
 *
 * @example
 * ```typescript
 * import {
 *   text,
 *   email,
 *   select,
 *   checkbox,
 *   option,
 * } from '@nextly/plugin-form-builder';
 *
 * const contactFormFields = [
 *   text({ name: 'firstName', label: 'First Name', required: true }),
 *   text({ name: 'lastName', label: 'Last Name', required: true }),
 *   email({ name: 'email', label: 'Email Address', required: true }),
 *   select({
 *     name: 'subject',
 *     label: 'Subject',
 *     options: [
 *       option('General Inquiry'),
 *       option('Support Request'),
 *       option('Feedback'),
 *     ],
 *   }),
 *   checkbox({ name: 'subscribe', label: 'Subscribe to newsletter' }),
 * ];
 * ```
 */

import type {
  TextFormField,
  EmailFormField,
  NumberFormField,
  PhoneFormField,
  UrlFormField,
  TextareaFormField,
  SelectFormField,
  CheckboxFormField,
  RadioFormField,
  FileFormField,
  DateFormField,
  TimeFormField,
  HiddenFormField,
} from "../types";

// ============================================================
// Utility Types
// ============================================================

/**
 * Option for select and radio fields.
 */
export interface FormFieldOption {
  label: string;
  value: string;
}

// ============================================================
// Utility Helpers
// ============================================================

/**
 * Creates an option for select or radio fields.
 *
 * If no value is provided, the label is converted to lowercase with
 * spaces replaced by underscores.
 *
 * @param label - Display label for the option
 * @param value - Optional value (defaults to lowercase label with underscores)
 * @returns Option object with label and value
 *
 * @example
 * ```typescript
 * // Value derived from label
 * option('United States') // { label: 'United States', value: 'united_states' }
 *
 * // Explicit value
 * option('United States', 'us') // { label: 'United States', value: 'us' }
 *
 * // Usage in select field
 * select({
 *   name: 'country',
 *   label: 'Country',
 *   options: [
 *     option('United States', 'us'),
 *     option('Canada', 'ca'),
 *     option('Mexico', 'mx'),
 *   ],
 * })
 * ```
 */
export const option = (label: string, value?: string): FormFieldOption => ({
  label,
  value: value ?? label.toLowerCase().replace(/\s+/g, "_"),
});

// ============================================================
// Text Input Field Helpers
// ============================================================

/**
 * Creates a text input field configuration.
 *
 * Text fields store simple string values with optional constraints
 * like min/max length and pattern validation.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete text field configuration
 *
 * @example
 * ```typescript
 * // Basic text field
 * text({ name: 'firstName', label: 'First Name', required: true })
 *
 * // Text with validation
 * text({
 *   name: 'username',
 *   label: 'Username',
 *   required: true,
 *   placeholder: 'Enter username',
 *   validation: {
 *     minLength: 3,
 *     maxLength: 20,
 *     pattern: '^[a-zA-Z0-9_]+$',
 *   },
 * })
 * ```
 */
export const text = (config: Omit<TextFormField, "type">): TextFormField => ({
  ...config,
  type: "text",
});

/**
 * Creates an email input field configuration.
 *
 * Email fields provide built-in email format validation.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete email field configuration
 *
 * @example
 * ```typescript
 * // Basic email field
 * email({ name: 'email', label: 'Email Address', required: true })
 *
 * // Email with placeholder
 * email({
 *   name: 'workEmail',
 *   label: 'Work Email',
 *   required: true,
 *   placeholder: 'you@company.com',
 * })
 * ```
 */
export const email = (
  config: Omit<EmailFormField, "type">
): EmailFormField => ({
  ...config,
  type: "email",
});

/**
 * Creates a phone input field configuration.
 *
 * Phone fields are optimized for phone number entry with
 * appropriate keyboard on mobile devices.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete phone field configuration
 *
 * @example
 * ```typescript
 * // Basic phone field
 * phone({ name: 'phone', label: 'Phone Number', required: true })
 *
 * // Phone with placeholder
 * phone({
 *   name: 'mobile',
 *   label: 'Mobile Number',
 *   placeholder: '+1 (555) 123-4567',
 * })
 * ```
 */
export const phone = (
  config: Omit<PhoneFormField, "type">
): PhoneFormField => ({
  ...config,
  type: "phone",
});

/**
 * Creates a URL input field configuration.
 *
 * URL fields provide built-in URL format validation.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete URL field configuration
 *
 * @example
 * ```typescript
 * // Basic URL field
 * url({ name: 'website', label: 'Website URL' })
 *
 * // URL with placeholder
 * url({
 *   name: 'portfolio',
 *   label: 'Portfolio URL',
 *   placeholder: 'https://example.com',
 * })
 * ```
 */
export const url = (config: Omit<UrlFormField, "type">): UrlFormField => ({
  ...config,
  type: "url",
});

/**
 * Creates a textarea field configuration.
 *
 * Textarea fields provide multi-line text input with configurable
 * row count and length validation.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete textarea field configuration
 *
 * @example
 * ```typescript
 * // Basic textarea
 * textarea({ name: 'message', label: 'Message', required: true })
 *
 * // Textarea with rows and validation
 * textarea({
 *   name: 'description',
 *   label: 'Description',
 *   rows: 5,
 *   validation: {
 *     minLength: 10,
 *     maxLength: 500,
 *   },
 * })
 * ```
 */
export const textarea = (
  config: Omit<TextareaFormField, "type">
): TextareaFormField => ({
  ...config,
  type: "textarea",
});

// ============================================================
// Numeric Field Helpers
// ============================================================

/**
 * Creates a number input field configuration.
 *
 * Number fields store numeric values with optional min/max/step
 * constraints.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete number field configuration
 *
 * @example
 * ```typescript
 * // Basic number field
 * number({ name: 'age', label: 'Age', required: true })
 *
 * // Number with range validation
 * number({
 *   name: 'quantity',
 *   label: 'Quantity',
 *   required: true,
 *   validation: {
 *     min: 1,
 *     max: 100,
 *     step: 1,
 *   },
 * })
 * ```
 */
export const number = (
  config: Omit<NumberFormField, "type">
): NumberFormField => ({
  ...config,
  type: "number",
});

// ============================================================
// Selection Field Helpers
// ============================================================

/**
 * Creates a select dropdown field configuration.
 *
 * Select fields display a dropdown list of options. Use the `option()`
 * helper to create options.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete select field configuration
 *
 * @example
 * ```typescript
 * // Basic select
 * select({
 *   name: 'country',
 *   label: 'Country',
 *   required: true,
 *   options: [
 *     option('United States', 'us'),
 *     option('Canada', 'ca'),
 *     option('Mexico', 'mx'),
 *   ],
 * })
 *
 * // Multi-select
 * select({
 *   name: 'interests',
 *   label: 'Interests',
 *   allowMultiple: true,
 *   options: [
 *     option('Technology'),
 *     option('Design'),
 *     option('Business'),
 *   ],
 * })
 * ```
 */
export const select = (
  config: Omit<SelectFormField, "type">
): SelectFormField => ({
  ...config,
  type: "select",
});

/**
 * Creates a single checkbox field configuration.
 *
 * Checkbox fields store boolean values (true/false).
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete checkbox field configuration
 *
 * @example
 * ```typescript
 * // Terms agreement checkbox
 * checkbox({
 *   name: 'agreeToTerms',
 *   label: 'I agree to the terms and conditions',
 *   required: true,
 * })
 *
 * // Newsletter subscription
 * checkbox({
 *   name: 'subscribe',
 *   label: 'Subscribe to our newsletter',
 *   defaultValue: true,
 * })
 * ```
 */
export const checkbox = (
  config: Omit<CheckboxFormField, "type">
): CheckboxFormField => ({
  ...config,
  type: "checkbox",
});

/**
 * Creates a radio group field configuration.
 *
 * Radio group fields allow selecting exactly one option from a list.
 * Use the `option()` helper to create options.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete radio field configuration
 *
 * @example
 * ```typescript
 * radio({
 *   name: 'contactMethod',
 *   label: 'Preferred Contact Method',
 *   required: true,
 *   options: [
 *     option('Email', 'email'),
 *     option('Phone', 'phone'),
 *     option('SMS', 'sms'),
 *   ],
 * })
 * ```
 */
export const radio = (
  config: Omit<RadioFormField, "type">
): RadioFormField => ({
  ...config,
  type: "radio",
});

// ============================================================
// File Field Helpers
// ============================================================

/**
 * Creates a file upload field configuration.
 *
 * File fields allow users to upload files with configurable
 * accepted types, size limits, and multiple file support.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete file field configuration
 *
 * @example
 * ```typescript
 * // Single file upload
 * file({
 *   name: 'resume',
 *   label: 'Upload Resume',
 *   required: true,
 *   accept: 'application/pdf,.doc,.docx',
 *   maxFileSize: 5242880, // 5MB
 * })
 *
 * // Multiple images
 * file({
 *   name: 'photos',
 *   label: 'Upload Photos',
 *   accept: 'image/*',
 *   multiple: true,
 *   maxFileSize: 10485760, // 10MB
 * })
 * ```
 */
export const file = (config: Omit<FileFormField, "type">): FileFormField => ({
  ...config,
  type: "file",
});

// ============================================================
// Date/Time Field Helpers
// ============================================================

/**
 * Creates a date picker field configuration.
 *
 * Date fields provide a date picker with optional min/max constraints.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete date field configuration
 *
 * @example
 * ```typescript
 * // Basic date field
 * date({ name: 'birthdate', label: 'Date of Birth', required: true })
 *
 * // Date with range constraints
 * date({
 *   name: 'eventDate',
 *   label: 'Event Date',
 *   required: true,
 *   min: '2024-01-01',
 *   max: '2024-12-31',
 * })
 * ```
 */
export const date = (config: Omit<DateFormField, "type">): DateFormField => ({
  ...config,
  type: "date",
});

/**
 * Creates a time picker field configuration.
 *
 * Time fields provide a time picker for selecting time values.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete time field configuration
 *
 * @example
 * ```typescript
 * // Basic time field
 * time({ name: 'appointmentTime', label: 'Preferred Time', required: true })
 *
 * // Time with default
 * time({
 *   name: 'meetingTime',
 *   label: 'Meeting Time',
 *   defaultValue: '09:00',
 * })
 * ```
 */
export const time = (config: Omit<TimeFormField, "type">): TimeFormField => ({
  ...config,
  type: "time",
});

// ============================================================
// Special Field Helpers
// ============================================================

/**
 * Creates a hidden field configuration.
 *
 * Hidden fields store values that are not visible to users but
 * are included in the submission data. Useful for tracking
 * metadata like source, campaign, or referrer.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete hidden field configuration
 *
 * @example
 * ```typescript
 * // Track form source
 * hidden({ name: 'source', label: 'Source', defaultValue: 'website' })
 *
 * // Campaign tracking
 * hidden({ name: 'campaign', label: 'Campaign', defaultValue: 'summer-sale' })
 * ```
 */
export const hidden = (
  config: Omit<HiddenFormField, "type">
): HiddenFormField => ({
  ...config,
  type: "hidden",
});
