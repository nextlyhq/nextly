/**
 * CSS Value Validation for Rich Text Security
 *
 * Validates CSS color values and inline style strings to prevent CSS injection
 * attacks in rich text HTML output. Applied at serialization time in
 * `rich-text-html.ts` when Lexical JSON is converted to HTML.
 *
 * @module services/security/css-validator
 * @since 1.0.0
 */

import {
  cssColor,
  hasCssInjection,
  sanitizeInlineStyle as sanitizeInlineStyleValue,
} from "@nextlyhq/blocks-engine";

/**
 * Whether a value carries a shape that must never reach a stylesheet.
 *
 * Delegated rather than implemented: the React renderer asks the same question
 * about the same stored fields and cannot import this package, so the patterns
 * live in `blocks-engine`, which both already depend on. A second copy here is
 * how the two answers drift apart while each looks correct on its own.
 */
function containsInjection(value: string): boolean {
  return hasCssInjection(value);
}

/**
 * CSS properties that the Lexical rich text editor generates for inline styles.
 * Only these properties are permitted in user-supplied `style` attributes.
 * Properties not on this list are silently dropped.
 */

/**
 * Check whether a string is a valid CSS color value.
 *
 * Rejects values containing injection patterns (checked first), then validates
 * the format against known CSS color syntaxes: hex (#fff, #ffffff, #ffffffaa),
 * rgb()/rgba() (comma and space-separated), hsl()/hsla(), and named colors.
 *
 * @example
 * isValidCssColor('#ff0000')         // true
 * isValidCssColor('rgb(255, 0, 0)')  // true
 * isValidCssColor('hsl(0, 100%, 50%)')  // true
 * isValidCssColor('red')             // true
 * isValidCssColor('expression(1)')   // false (injection)
 * isValidCssColor('url(evil)')       // false (injection)
 */
export function isValidCssColor(value: string): boolean {
  return cssColor(value) !== undefined;
}

/**
 * Check whether an inline style string is free from CSS injection patterns.
 *
 * @example
 * isValidInlineStyle('color: red; font-size: 16px')      // true
 * isValidInlineStyle('background: url(javascript:void)') // false
 * isValidInlineStyle('color: expression(alert(1))')      // false
 */
export function isValidInlineStyle(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  return !containsInjection(value);
}

/**
 * Validate a CSS color value, returning the value if valid or `null` if not.
 *
 * Callers should replace `null` with a safe default:
 * - For bgColor: `null` → `#000`
 * - For textColor: `null` → `#fff`
 *
 * @example
 * sanitizeCssColor('#3b82f6')         // '#3b82f6'
 * sanitizeCssColor('rgb(59, 130, 246)')  // 'rgb(59, 130, 246)'
 * sanitizeCssColor('expression(1)')   // null
 * sanitizeCssColor('')                // null
 */
export function sanitizeCssColor(value: string): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return isValidCssColor(trimmed) ? trimmed : null;
}

/**
 * Sanitize an inline style string, keeping only declarations safe to publish.
 *
 * Delegated rather than implemented. The React renderer draws the same stored
 * string and the versions differ compares it, and neither can import this
 * package — so the property allowlist and the value check live in
 * `blocks-engine`, which all three already depend on. A second copy here is how
 * one surface starts publishing what another refuses.
 */
export function sanitizeInlineStyle(value: string): string {
  return sanitizeInlineStyleValue(value);
}
