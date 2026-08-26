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
  normalizeCssValue,
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
const ALLOWED_STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-align",
  "vertical-align",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "white-space",
  "text-transform",
  "opacity",
]);

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
 * Sanitize an inline style string by:
 * 1. Splitting into individual CSS declarations
 * 2. Checking each property name against the allowlist
 * 3. Checking each value against injection patterns
 * 4. Reassembling only passing declarations
 *
 * Properties not on the allowlist are silently dropped.
 * Values containing injection patterns cause the entire declaration to be dropped.
 *
 * @example
 * sanitizeInlineStyle('color: red; font-size: 16px')
 * // 'color: red; font-size: 16px'
 *
 * sanitizeInlineStyle('color: red; behavior: url(evil.htc); font-size: 16px')
 * // 'color: red; font-size: 16px'
 *
 * sanitizeInlineStyle('background-image: url(javascript:alert(1))')
 * // ''
 *
 * sanitizeInlineStyle('color: expression(alert(1))')
 * // ''
 */
export function sanitizeInlineStyle(value: string): string {
  if (!value || typeof value !== "string") return "";

  const normalized = normalizeCssValue(value);
  if (!normalized) return "";

  const declarations = normalized.split(";");
  const safe: string[] = [];

  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const property = trimmed.slice(0, colonIndex).trim().toLowerCase();
    const propValue = trimmed.slice(colonIndex + 1).trim();

    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;

    if (containsInjection(propValue)) continue;

    safe.push(`${property}:${propValue}`);
  }

  return safe.join(";");
}
