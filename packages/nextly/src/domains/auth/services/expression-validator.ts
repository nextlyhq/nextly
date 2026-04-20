import { parse } from "acorn";
import type { Node } from "acorn";
import { simple as walk } from "acorn-walk";

/**
 * Expression Validator for RLS Policy Expressions
 *
 * Validates JavaScript expressions before evaluation to prevent code injection
 * and other security vulnerabilities.
 *
 * Security Features:
 * - AST-based validation (catches all syntax-level attacks)
 * - Whitelist of allowed node types
 * - Blacklist of dangerous identifiers
 * - Length limits
 * - No assignments, function definitions, or other side effects
 *
 * @example
 * ```typescript
 * // Valid expressions:
 * ExpressionValidator.validate("record.status === 'published'");
 * ExpressionValidator.validate("record.views > 100 && record.author === userId");
 *
 * // Invalid expressions (throw errors):
 * ExpressionValidator.validate("Function('return true')()"); // Blocked identifier
 * ExpressionValidator.validate("record.x = 5"); // Assignment not allowed
 * ```
 */
export class ExpressionValidator {
  private static MAX_LENGTH = 1000;

  private static ALLOWED_NODE_TYPES = new Set([
    "Program",
    "ExpressionStatement",
    "BinaryExpression",
    "LogicalExpression",
    "UnaryExpression",
    "Literal",
    "Identifier",
    "MemberExpression",
    "ConditionalExpression",
    "ArrayExpression",
    "ObjectExpression",
    "Property",
    "TemplateLiteral",
    "TemplateElement",
    "ParenthesizedExpression",
  ]);

  private static BLOCKED_IDENTIFIERS = new Set([
    "Function",
    "eval",
    "AsyncFunction",
    "GeneratorFunction",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "constructor",
    "prototype",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "import",
    "require",
    "module",
    "exports",
    "global",
    "globalThis",
    "window",
    "self",
    "process",
    "Buffer",
    "Reflect",
    "Proxy",
    "Error",
    "EvalError",
  ]);

  /**
   * Validate a JavaScript expression for use in RLS policies.
   *
   * @param expression - The JavaScript expression to validate
   * @throws {Error} If expression is invalid or contains dangerous patterns
   *
   * @example
   * ```typescript
   * // Safe expression
   * ExpressionValidator.validate("record.status === 'published'");
   *
   * // Throws error
   * ExpressionValidator.validate("eval('malicious code')");
   * // Error: Unsafe identifier 'eval' not allowed in RLS expressions
   * ```
   */
  static validate(expression: string): void {
    if (!expression || expression.trim().length === 0) {
      throw new Error("Expression cannot be empty");
    }

    if (expression.length > this.MAX_LENGTH) {
      throw new Error(
        `Expression too long (max ${this.MAX_LENGTH} characters, got ${expression.length})`
      );
    }

    try {
      // Wrap in parentheses to ensure it's treated as an expression, not a statement
      const ast = parse(`(${expression})`, {
        ecmaVersion: 2020,
        sourceType: "script",
      });

      // acorn-walk's `simple` accepts Node from acorn; cast required here because
      // the parsed AST type is `Program` but the walk API expects the base `Node` union.
      walk(ast as Node, {
        Identifier(node: Node) {
          const identNode = node as Node & { name: string };
          if (ExpressionValidator.BLOCKED_IDENTIFIERS.has(identNode.name)) {
            throw new Error(
              `Unsafe identifier '${identNode.name}' not allowed in RLS expressions. ` +
                `This identifier could be used for code injection or accessing sensitive APIs.`
            );
          }
        },

        AssignmentExpression(_node: Node) {
          throw new Error(
            "Assignment expressions are not allowed in RLS expressions. " +
              "Expressions must be read-only and have no side effects."
          );
        },

        UpdateExpression(_node: Node) {
          throw new Error(
            "Update expressions (++, --) are not allowed in RLS expressions. " +
              "Expressions must be read-only and have no side effects."
          );
        },

        FunctionExpression(_node: Node) {
          throw new Error(
            "Function expressions are not allowed in RLS expressions. " +
              "Use simple comparisons and logical operators instead."
          );
        },

        ArrowFunctionExpression(_node: Node) {
          throw new Error(
            "Arrow functions are not allowed in RLS expressions. " +
              "Use simple comparisons and logical operators instead."
          );
        },

        CallExpression(node: Node) {
          const callNode = node as Node & {
            callee: Node & { type: string; name?: string };
          };
          if (!ExpressionValidator.ALLOWED_NODE_TYPES.has(node.type)) {
            throw new Error(
              `Unsafe expression: AST node type '${node.type}' is not allowed in RLS expressions`
            );
          }

          // Allow safe method calls like array.includes(); block calls to global identifiers
          if (callNode.callee.type === "Identifier") {
            throw new Error(
              `Function calls to global functions are not allowed in RLS expressions. ` +
                `Found: ${callNode.callee.name ?? "unknown"}(). Use member methods instead (e.g., array.includes()).`
            );
          }
        },

        BinaryExpression(node: Node) {
          if (!ExpressionValidator.ALLOWED_NODE_TYPES.has(node.type)) {
            throw new Error(
              `Unsafe expression: AST node type '${node.type}' is not allowed in RLS expressions`
            );
          }
        },

        LogicalExpression(node: Node) {
          if (!ExpressionValidator.ALLOWED_NODE_TYPES.has(node.type)) {
            throw new Error(
              `Unsafe expression: AST node type '${node.type}' is not allowed in RLS expressions`
            );
          }
        },

        MemberExpression(node: Node) {
          if (!ExpressionValidator.ALLOWED_NODE_TYPES.has(node.type)) {
            throw new Error(
              `Unsafe expression: AST node type '${node.type}' is not allowed in RLS expressions`
            );
          }
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("not allowed")) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid expression syntax: ${message}. ` +
          `Expression must be valid JavaScript with comparisons and logical operators only.`
      );
    }
  }

  /**
   * Check if an expression is valid without throwing.
   *
   * @param expression - The expression to check
   * @returns true if valid, false otherwise
   */
  static isValid(expression: string): boolean {
    try {
      this.validate(expression);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get validation error message for an expression.
   *
   * @param expression - The expression to check
   * @returns Error message if invalid, null if valid
   */
  static getError(expression: string): string | null {
    try {
      this.validate(expression);
      return null;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
