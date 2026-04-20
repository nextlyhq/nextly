/**
 * Email Template Variable Engine
 *
 * Pure-function interpolation engine for email templates.
 * Replaces `{{variableName}}` placeholders with actual values,
 * supports dot-notation nested access (`{{user.name}}`), escapes
 * HTML by default to prevent XSS, and validates required variables
 * against `EmailTemplateVariable[]` metadata.
 *
 * @module services/email/template-engine
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { interpolateTemplate, validateTemplateVariables } from './template-engine';
 *
 * const html = interpolateTemplate(
 *   '<p>Hello, {{userName}}! Visit <a href="{{resetLink}}">here</a>.</p>',
 *   { userName: 'John <script>', resetLink: 'https://example.com/reset?t=abc' }
 * );
 * // '<p>Hello, John &lt;script&gt;! Visit <a href="https://example.com/reset?t=abc">here</a>.</p>'
 * ```
 */

import type { EmailTemplateVariable } from "../../../schemas/email-templates/types";

// ============================================================
// HTML Escaping
// ============================================================

/** Map of characters to their HTML entity equivalents. */
const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Single-pass regex matching all characters that need escaping. */
const HTML_ESCAPE_RE = /[&<>"']/g;

/**
 * Escape HTML special characters in a string.
 *
 * Performs a single-pass replacement to prevent double-escaping.
 * Covers the 5 critical characters: `& < > " '`.
 *
 * @param str - The raw string to escape
 * @returns HTML-safe string
 */
export function escapeHtml(str: string): string {
  return String(str).replace(
    HTML_ESCAPE_RE,
    char => HTML_ENTITY_MAP[char] ?? char
  );
}

// ============================================================
// Nested Variable Resolution
// ============================================================

/**
 * Resolve a dot-notation path against a data object.
 *
 * Supports flat keys (`"userName"`) and nested paths (`"user.name"`).
 * Returns `undefined` if any segment along the path is missing.
 *
 * @param data - The data object to resolve against
 * @param path - Dot-separated property path
 * @returns The resolved value, or `undefined` if not found
 *
 * @example
 * ```typescript
 * resolveVariable({ user: { name: 'Alice' } }, 'user.name'); // 'Alice'
 * resolveVariable({ name: 'Bob' }, 'name');                   // 'Bob'
 * resolveVariable({}, 'missing.path');                         // undefined
 * ```
 */
export function resolveVariable(
  data: Record<string, unknown>,
  path: string
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc !== null && acc !== undefined
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      data
    );
}

// ============================================================
// Template Interpolation
// ============================================================

/**
 * Regex matching `{{variableName}}` or `{{ user.name }}` with
 * optional whitespace inside the braces. Captures the variable
 * path (word characters and dots) in group 1.
 */
const TEMPLATE_VAR_RE = /{{\s*([\w.]+)\s*}}/g;

/**
 * Options for template interpolation.
 */
export interface InterpolateOptions {
  /**
   * Whether to HTML-escape variable values.
   * @default true
   */
  escapeHtml?: boolean;
}

/**
 * Interpolate `{{variable}}` placeholders in a template string.
 *
 * - Replaces `{{varName}}` with the corresponding value from `data`
 * - Supports dot-notation: `{{user.name}}` resolves `data.user.name`
 * - HTML-escapes values by default (opt out with `escapeHtml: false`)
 * - Missing variables are replaced with an empty string
 * - Whitespace inside braces is trimmed: `{{ var }}` works
 *
 * @param template - Template string containing `{{variable}}` placeholders
 * @param data - Key-value pairs (flat or nested) for replacement
 * @param options - Interpolation options
 * @returns The interpolated string
 *
 * @example
 * ```typescript
 * interpolateTemplate('Hello, {{name}}!', { name: 'Alice' });
 * // 'Hello, Alice!'
 *
 * interpolateTemplate('Hi {{user.name}}', { user: { name: 'Bob' } });
 * // 'Hi Bob'
 *
 * // HTML escaping (default):
 * interpolateTemplate('{{content}}', { content: '<script>alert("xss")</script>' });
 * // '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 * ```
 */
export function interpolateTemplate(
  template: string,
  data: Record<string, unknown>,
  options?: InterpolateOptions
): string {
  const shouldEscape = options?.escapeHtml !== false;

  return template.replace(TEMPLATE_VAR_RE, (_match, varPath: string) => {
    const value = resolveVariable(data, varPath);

    if (value === undefined || value === null) {
      return "";
    }

    const stringValue = String(value);
    return shouldEscape ? escapeHtml(stringValue) : stringValue;
  });
}

// ============================================================
// Variable Validation
// ============================================================

/**
 * Result of template variable validation.
 */
export interface TemplateValidationResult {
  /** Whether all required variables are provided. */
  valid: boolean;
  /** Names of required variables that are missing from the data. */
  missing: string[];
}

/**
 * Validate that all required template variables are present in the data.
 *
 * Checks each variable definition where `required: true` against the
 * provided data object. A variable is considered missing if its resolved
 * value is `undefined` or `null`.
 *
 * @param variableDefs - Template variable metadata (from `EmailTemplateRecord.variables`)
 * @param data - The data object to validate against
 * @returns Validation result with `valid` flag and `missing` variable names
 *
 * @example
 * ```typescript
 * const vars: EmailTemplateVariable[] = [
 *   { name: 'userName', description: 'User name', required: true },
 *   { name: 'appName', description: 'App name', required: true },
 *   { name: 'extra', description: 'Optional field' },
 * ];
 *
 * validateTemplateVariables(vars, { userName: 'Alice' });
 * // { valid: false, missing: ['appName'] }
 *
 * validateTemplateVariables(vars, { userName: 'Alice', appName: 'Nextly' });
 * // { valid: true, missing: [] }
 * ```
 */
export function validateTemplateVariables(
  variableDefs: EmailTemplateVariable[] | null | undefined,
  data: Record<string, unknown>
): TemplateValidationResult {
  if (!variableDefs || variableDefs.length === 0) {
    return { valid: true, missing: [] };
  }

  const missing: string[] = [];

  for (const varDef of variableDefs) {
    if (varDef.required) {
      const value = resolveVariable(data, varDef.name);
      if (value === undefined || value === null) {
        missing.push(varDef.name);
      }
    }
  }

  return { valid: missing.length === 0, missing };
}

// ============================================================
// Convenience: Interpolate with Validation
// ============================================================

/**
 * Interpolate a template after validating required variables.
 *
 * Combines `validateTemplateVariables()` and `interpolateTemplate()`
 * in a single call. Throws if any required variable is missing.
 *
 * @param template - Template string with `{{variable}}` placeholders
 * @param data - Key-value pairs for replacement
 * @param variableDefs - Template variable metadata (for required validation)
 * @param options - Interpolation options
 * @returns The interpolated string
 * @throws Error if required variables are missing
 */
export function interpolateWithValidation(
  template: string,
  data: Record<string, unknown>,
  variableDefs?: EmailTemplateVariable[] | null,
  options?: InterpolateOptions
): string {
  const validation = validateTemplateVariables(variableDefs, data);

  if (!validation.valid) {
    throw new Error(
      `Missing required template variables: ${validation.missing.join(", ")}`
    );
  }

  return interpolateTemplate(template, data, options);
}
