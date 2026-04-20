/**
 * Code Field Validators
 *
 * Reusable validation functions for code fields with language-specific syntax checking.
 * These validators can be used in field configurations to ensure code content is valid.
 *
 * @module collections/fields/validators/code-validators
 * @since 1.0.0
 */

import type { CodeFieldValue } from "../types/code";

// ============================================================
// Validator Types
// ============================================================

/**
 * Validation result type for code validators.
 * Returns `true` if valid, or an error message string if invalid.
 */
export type CodeValidationResult = string | true;

/**
 * Validator function signature.
 */
export type CodeValidator = (value: CodeFieldValue) => CodeValidationResult;

// ============================================================
// JSON Validator
// ============================================================

/**
 * Validates JSON syntax.
 *
 * Ensures the code field contains valid, parseable JSON.
 * Provides detailed error messages including line/column information.
 *
 * @example
 * ```typescript
 * const configField: CodeFieldConfig = {
 *   name: 'config',
 *   type: 'code',
 *   admin: { language: 'json' },
 *   validate: validateJSON,
 * };
 * ```
 *
 * @param value - The JSON string to validate
 * @returns `true` if valid, error message if invalid
 */
export function validateJSON(value: CodeFieldValue): CodeValidationResult {
  // Allow empty values (use required: true for mandatory fields)
  if (!value || value.trim() === "") return true;

  try {
    JSON.parse(value);
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Extract line/column info from error message if available
      const match = error.message.match(/position (\d+)/);
      if (match) {
        const position = parseInt(match[1]);
        const lines = value.substring(0, position).split("\n");
        const line = lines.length;
        const column = lines[lines.length - 1].length + 1;
        return `Invalid JSON at line ${line}, column ${column}: ${error.message}`;
      }
      return `Invalid JSON syntax: ${error.message}`;
    }
    return "Invalid JSON: Unable to parse";
  }
}

// ============================================================
// XML/HTML Validator
// ============================================================

/**
 * Validates basic XML/HTML syntax.
 *
 * Performs basic validation checking for:
 * - Properly closed tags
 * - Balanced brackets
 * - Valid tag names
 *
 * Note: This is a basic validator. For comprehensive validation,
 * consider using a proper XML parser library.
 *
 * @example
 * ```typescript
 * const xmlField: CodeFieldConfig = {
 *   name: 'xmlContent',
 *   type: 'code',
 *   admin: { language: 'xml' },
 *   validate: validateXML,
 * };
 * ```
 *
 * @param value - The XML/HTML string to validate
 * @returns `true` if valid, error message if invalid
 */
export function validateXML(value: CodeFieldValue): CodeValidationResult {
  if (!value || value.trim() === "") return true;

  // Basic XML validation checks
  const tagStack: string[] = [];
  const selfClosingTags = new Set([
    "br",
    "hr",
    "img",
    "input",
    "meta",
    "link",
    "area",
    "base",
    "col",
    "embed",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  // Match opening and closing tags
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
  let match;

  while ((match = tagRegex.exec(value)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();

    // Skip self-closing tags
    if (fullTag.endsWith("/>") || selfClosingTags.has(tagName)) {
      continue;
    }

    // Closing tag
    if (fullTag.startsWith("</")) {
      if (tagStack.length === 0) {
        return `Unexpected closing tag: </${tagName}>`;
      }
      const lastTag = tagStack.pop();
      if (lastTag !== tagName) {
        return `Mismatched tags: expected </${lastTag}>, found </${tagName}>`;
      }
    }
    // Opening tag
    else {
      tagStack.push(tagName);
    }
  }

  // Check for unclosed tags
  if (tagStack.length > 0) {
    return `Unclosed tags: ${tagStack.map(t => `<${t}>`).join(", ")}`;
  }

  return true;
}

// ============================================================
// JavaScript/TypeScript Validator
// ============================================================

/**
 * Validates JavaScript/TypeScript syntax.
 *
 * Uses the Function constructor for basic syntax validation.
 * Note: This only checks if the code is parseable JavaScript,
 * not if it's valid TypeScript or follows best practices.
 *
 * @example
 * ```typescript
 * const scriptField: CodeFieldConfig = {
 *   name: 'customScript',
 *   type: 'code',
 *   admin: { language: 'javascript' },
 *   validate: validateJavaScript,
 * };
 * ```
 *
 * @param value - The JavaScript code to validate
 * @returns `true` if valid, error message if invalid
 */
export function validateJavaScript(
  value: CodeFieldValue
): CodeValidationResult {
  if (!value || value.trim() === "") return true;

  try {
    // Use Function constructor to check syntax
    // This doesn't execute the code, just parses it
    new Function(value);
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return `JavaScript syntax error: ${error.message}`;
    }
    return "Invalid JavaScript code";
  }
}

// ============================================================
// SQL Validator (Basic)
// ============================================================

/**
 * Options for SQL validation.
 */
export interface SQLValidatorOptions {
  /**
   * Forbidden SQL commands (case-insensitive).
   * Common dangerous commands to block.
   *
   * @default ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE', 'DELETE FROM', 'ALTER TABLE']
   */
  forbiddenCommands?: string[];

  /**
   * Allow empty values.
   * @default true
   */
  allowEmpty?: boolean;
}

/**
 * Creates a basic SQL validator with configurable forbidden commands.
 *
 * This is a safety validator, not a comprehensive syntax checker.
 * It blocks potentially dangerous SQL commands.
 *
 * @example
 * ```typescript
 * const queryField: CodeFieldConfig = {
 *   name: 'customQuery',
 *   type: 'code',
 *   admin: { language: 'sql' },
 *   validate: createSQLValidator({
 *     forbiddenCommands: ['DROP', 'DELETE', 'TRUNCATE', 'ALTER'],
 *   }),
 * };
 * ```
 *
 * @param options - Validation options
 * @returns Validator function
 */
export function createSQLValidator(
  options: SQLValidatorOptions = {}
): CodeValidator {
  const {
    forbiddenCommands = [
      "DROP TABLE",
      "DROP DATABASE",
      "TRUNCATE",
      "DELETE FROM",
      "ALTER TABLE",
    ],
    allowEmpty = true,
  } = options;

  return (value: CodeFieldValue): CodeValidationResult => {
    if (!value || value.trim() === "") {
      return allowEmpty ? true : "SQL query is required";
    }

    const upperValue = value.toUpperCase();

    // Check for forbidden commands
    for (const command of forbiddenCommands) {
      if (upperValue.includes(command.toUpperCase())) {
        return `Forbidden SQL command: ${command}`;
      }
    }

    // Basic SQL syntax checks
    const keywords = ["SELECT", "INSERT", "UPDATE", "CREATE", "ALTER"];
    const hasKeyword = keywords.some(keyword => upperValue.includes(keyword));

    if (!hasKeyword) {
      return "SQL query must contain a valid SQL command (SELECT, INSERT, UPDATE, etc.)";
    }

    return true;
  };
}

// ============================================================
// CSS Validator (Basic)
// ============================================================

/**
 * Validates basic CSS syntax.
 *
 * Performs simple validation checking for:
 * - Balanced braces
 * - Basic selector syntax
 * - Property-value pairs
 *
 * @example
 * ```typescript
 * const stylesField: CodeFieldConfig = {
 *   name: 'customStyles',
 *   type: 'code',
 *   admin: { language: 'css' },
 *   validate: validateCSS,
 * };
 * ```
 *
 * @param value - The CSS code to validate
 * @returns `true` if valid, error message if invalid
 */
export function validateCSS(value: CodeFieldValue): CodeValidationResult {
  if (!value || value.trim() === "") return true;

  // Check for balanced braces
  let braceCount = 0;
  for (const char of value) {
    if (char === "{") braceCount++;
    if (char === "}") braceCount--;
    if (braceCount < 0) {
      return "Unbalanced braces: unexpected closing brace }";
    }
  }

  if (braceCount > 0) {
    return `Unbalanced braces: ${braceCount} unclosed brace(s)`;
  }

  // Basic check for property-value pairs (selector { property: value; })
  const ruleRegex = /[^}]*\{[^}]*\}/g;
  const rules = value.match(ruleRegex);

  if (rules) {
    for (const rule of rules) {
      const content = rule.substring(
        rule.indexOf("{") + 1,
        rule.lastIndexOf("}")
      );
      if (content.trim() && !content.includes(":")) {
        return "Invalid CSS: missing colon in property-value pair";
      }
    }
  }

  return true;
}

// ============================================================
// Export All Validators
// ============================================================

/**
 * Collection of all available code validators.
 */
export const codeValidators = {
  json: validateJSON,
  xml: validateXML,
  html: validateXML, // HTML uses same validator as XML
  javascript: validateJavaScript,
  typescript: validateJavaScript, // TS uses same validator as JS
  css: validateCSS,
  sql: createSQLValidator,
} as const;
