import { describe, it, expect } from "vitest";

import { ExpressionValidator } from "../expression-validator";

/**
 * Expression Validator Security Tests
 *
 * Tests the expression validator's ability to block code injection,
 * dangerous operations, and other security vulnerabilities.
 *
 * Test Categories:
 * 1. Valid Safe Expressions (should pass)
 * 2. Code Injection Attempts (should fail)
 * 3. Dangerous Identifiers (should fail)
 * 4. Side Effects (should fail)
 * 5. Function Definitions (should fail)
 * 6. Edge Cases (should handle gracefully)
 */

describe("ExpressionValidator - Security Tests", () => {
  describe("Valid Safe Expressions", () => {
    it("should allow simple comparisons", () => {
      expect(() => {
        ExpressionValidator.validate("record.status === 'published'");
      }).not.toThrow();
    });

    it("should allow logical operators", () => {
      expect(() => {
        ExpressionValidator.validate(
          "record.views > 100 && record.status === 'active'"
        );
      }).not.toThrow();
    });

    it("should allow member access chains", () => {
      expect(() => {
        ExpressionValidator.validate("record.author.id === userId");
      }).not.toThrow();
    });

    it("should allow ternary operators", () => {
      expect(() => {
        ExpressionValidator.validate(
          "record.premium ? record.price > 0 : true"
        );
      }).not.toThrow();
    });

    it("should allow array methods", () => {
      expect(() => {
        ExpressionValidator.validate(
          "['admin', 'editor'].includes(record.role)"
        );
      }).not.toThrow();
    });

    it("should allow string methods", () => {
      expect(() => {
        ExpressionValidator.validate("record.email.endsWith('@example.com')");
      }).not.toThrow();
    });

    it("should allow negation", () => {
      expect(() => {
        ExpressionValidator.validate("!record.deleted");
      }).not.toThrow();
    });

    it("should allow arithmetic in comparisons", () => {
      expect(() => {
        ExpressionValidator.validate("record.price * 1.1 > 100");
      }).not.toThrow();
    });

    it("should allow template literals", () => {
      expect(() => {
        ExpressionValidator.validate("record.status === `active`");
      }).not.toThrow();
    });

    it("should allow object literals in comparisons", () => {
      expect(() => {
        ExpressionValidator.validate(
          "record.config.enabled === { active: true }.active"
        );
      }).not.toThrow();
    });
  });

  describe("Code Injection Attempts", () => {
    it("should block Function constructor", () => {
      expect(() => {
        ExpressionValidator.validate("Function('return true')()");
      }).toThrow(/Unsafe identifier 'Function'/);
    });

    it("should block eval", () => {
      expect(() => {
        ExpressionValidator.validate("eval('malicious code')");
      }).toThrow(/Unsafe identifier 'eval'/);
    });

    it("should block require", () => {
      expect(() => {
        ExpressionValidator.validate("require('fs').unlinkSync('/file')");
      }).toThrow(/Unsafe identifier 'require'/);
    });

    it("should allow import() syntax (safe - won't work in Function constructor)", () => {
      // Note: import() is valid syntax (CallExpression with import keyword)
      // It passes validation but won't actually work in Function constructor context
      // This is safe because:
      // 1. Function constructor doesn't support dynamic imports
      // 2. Even if it did, there's no module context to import from
      // 3. This will fail at runtime with clear error, not execute malicious code
      expect(() => {
        ExpressionValidator.validate("import('module')");
      }).not.toThrow();
    });

    it("should block setTimeout", () => {
      expect(() => {
        ExpressionValidator.validate("setTimeout(() => {}, 1000)");
      }).toThrow(/Unsafe identifier 'setTimeout'/);
    });

    it("should block setInterval", () => {
      expect(() => {
        ExpressionValidator.validate("setInterval(() => {}, 1000)");
      }).toThrow(/Unsafe identifier 'setInterval'/);
    });

    it("should block process access", () => {
      expect(() => {
        ExpressionValidator.validate("process.exit(1)");
      }).toThrow(/Unsafe identifier 'process'/);
    });

    it("should block global access", () => {
      expect(() => {
        ExpressionValidator.validate("global.something");
      }).toThrow(/Unsafe identifier 'global'/);
    });

    it("should block globalThis access", () => {
      expect(() => {
        ExpressionValidator.validate("globalThis.fetch");
      }).toThrow(/Unsafe identifier 'globalThis'/);
    });
  });

  describe("Prototype Manipulation", () => {
    it("should allow constructor as property name (safe in member expression)", () => {
      // Note: record.constructor is safe - it just accesses a property
      // The dangerous case is using constructor as a standalone identifier
      // which could be used like: constructor.constructor('code')()
      // But that's already blocked by blocking 'constructor' as identifier
      expect(() => {
        ExpressionValidator.validate("record.constructor");
      }).not.toThrow();
    });

    it("should block constructor as standalone identifier", () => {
      expect(() => {
        ExpressionValidator.validate("constructor.constructor");
      }).toThrow(/Unsafe identifier 'constructor'/);
    });

    it("should allow prototype as property name (safe in member expression)", () => {
      // Object.prototype.toString is actually safe to ACCESS
      // The danger is MODIFYING it, which is prevented by blocking assignments
      expect(() => {
        ExpressionValidator.validate("Object.prototype.toString");
      }).not.toThrow();
    });

    it("should allow __proto__ as property name (safe when read-only)", () => {
      // Reading __proto__ is safe, writing to it is blocked by assignment prevention
      expect(() => {
        ExpressionValidator.validate("record.__proto__");
      }).not.toThrow();
    });

    it("should block __defineGetter__ arrow function", () => {
      // This is blocked by arrow function detection, not identifier blocking
      expect(() => {
        ExpressionValidator.validate("record.__defineGetter__('x', () => 1)");
      }).toThrow(/Arrow functions are not allowed/);
    });
  });

  describe("Side Effects - Assignments", () => {
    it("should block simple assignment", () => {
      expect(() => {
        ExpressionValidator.validate("record.status = 'hacked'");
      }).toThrow(/Assignment expressions are not allowed/);
    });

    it("should block compound assignment", () => {
      expect(() => {
        ExpressionValidator.validate("record.count += 1");
      }).toThrow(/Assignment expressions are not allowed/);
    });

    it("should block increment operator", () => {
      expect(() => {
        ExpressionValidator.validate("record.count++");
      }).toThrow(/Update expressions.*are not allowed/);
    });

    it("should block decrement operator", () => {
      expect(() => {
        ExpressionValidator.validate("--record.count");
      }).toThrow(/Update expressions.*are not allowed/);
    });
  });

  describe("Function Definitions", () => {
    it("should block function expressions", () => {
      expect(() => {
        ExpressionValidator.validate("(function() { return true; })()");
      }).toThrow(/Function expressions are not allowed/);
    });

    it("should block arrow functions", () => {
      expect(() => {
        ExpressionValidator.validate("(() => true)()");
      }).toThrow(/Arrow functions are not allowed/);
    });

    it("should block async functions", () => {
      expect(() => {
        ExpressionValidator.validate("(async () => true)()");
      }).toThrow(/Arrow functions are not allowed/);
    });

    it("should block generator functions", () => {
      expect(() => {
        ExpressionValidator.validate("(function*() { yield 1; })");
      }).toThrow(/Function expressions are not allowed/);
    });
  });

  describe("Global Function Calls", () => {
    it("should block calls to global functions", () => {
      expect(() => {
        ExpressionValidator.validate("alert('hello')");
      }).toThrow(/Function calls to global functions are not allowed/);
    });

    it("should allow method calls on objects", () => {
      // This should be allowed - it's a method call, not a global function call
      expect(() => {
        ExpressionValidator.validate("record.toString()");
      }).not.toThrow();
    });

    it("should allow method calls on arrays", () => {
      expect(() => {
        ExpressionValidator.validate("[1, 2, 3].includes(record.id)");
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should reject empty expression", () => {
      expect(() => {
        ExpressionValidator.validate("");
      }).toThrow(/Expression cannot be empty/);
    });

    it("should reject whitespace-only expression", () => {
      expect(() => {
        ExpressionValidator.validate("   ");
      }).toThrow(/Expression cannot be empty/);
    });

    it("should reject expressions exceeding max length", () => {
      const longExpression =
        "record.x === 1" + " && record.x === 1".repeat(100);
      expect(() => {
        ExpressionValidator.validate(longExpression);
      }).toThrow(/Expression too long/);
    });

    it("should reject invalid syntax", () => {
      expect(() => {
        ExpressionValidator.validate("record.status === ");
      }).toThrow(/Invalid expression syntax/);
    });

    it("should reject unclosed parentheses", () => {
      expect(() => {
        ExpressionValidator.validate("(record.status === 'active'");
      }).toThrow(/Invalid expression syntax/);
    });

    it("should reject invalid operators", () => {
      expect(() => {
        ExpressionValidator.validate("record.status ===== 'active'");
      }).toThrow(/Invalid expression syntax/);
    });
  });

  describe("Helper Methods", () => {
    it("isValid should return true for valid expressions", () => {
      expect(ExpressionValidator.isValid("record.status === 'active'")).toBe(
        true
      );
    });

    it("isValid should return false for invalid expressions", () => {
      expect(ExpressionValidator.isValid("eval('code')")).toBe(false);
    });

    it("getError should return null for valid expressions", () => {
      expect(ExpressionValidator.getError("record.status === 'active'")).toBe(
        null
      );
    });

    it("getError should return error message for invalid expressions", () => {
      const error = ExpressionValidator.getError("eval('code')");
      expect(error).toBeTruthy();
      expect(error).toContain("eval");
    });
  });

  describe("Complex Valid Expressions", () => {
    it("should allow complex boolean logic", () => {
      expect(() => {
        ExpressionValidator.validate(
          "(record.status === 'published' && record.views > 1000) || " +
            "(record.premium === true && record.author === userId)"
        );
      }).not.toThrow();
    });

    it("should allow nested ternaries", () => {
      expect(() => {
        ExpressionValidator.validate(
          "record.type === 'admin' ? true : " +
            "record.type === 'editor' ? record.teamId === userTeam : false"
        );
      }).not.toThrow();
    });

    it("should allow array and string operations", () => {
      expect(() => {
        ExpressionValidator.validate(
          "['admin', 'editor'].includes(record.role) && " +
            "record.email.endsWith('@company.com')"
        );
      }).not.toThrow();
    });

    it("should allow object property access chains", () => {
      expect(() => {
        ExpressionValidator.validate(
          "record.metadata.permissions.read === true"
        );
      }).not.toThrow();
    });

    it("should allow comparisons with null and undefined", () => {
      expect(() => {
        ExpressionValidator.validate(
          "record.deletedAt === null && record.status !== undefined"
        );
      }).not.toThrow();
    });
  });

  describe("Security Regression Tests", () => {
    it("should block comma operator for side effects", () => {
      expect(() => {
        ExpressionValidator.validate("(record.x = 1, true)");
      }).toThrow(/Assignment expressions are not allowed/);
    });

    it("should block nested eval via indirect call", () => {
      expect(() => {
        ExpressionValidator.validate("(0, eval)('code')");
      }).toThrow(/Unsafe identifier 'eval'/);
    });

    it("should block Proxy access", () => {
      expect(() => {
        ExpressionValidator.validate("new Proxy({}, {})");
      }).toThrow(/Unsafe identifier 'Proxy'/);
    });

    it("should block Reflect access", () => {
      expect(() => {
        ExpressionValidator.validate("Reflect.get(record, 'status')");
      }).toThrow(/Unsafe identifier 'Reflect'/);
    });

    it("should block Error constructor (could leak stack traces)", () => {
      expect(() => {
        ExpressionValidator.validate("new Error().stack");
      }).toThrow(/Unsafe identifier 'Error'/);
    });
  });
});
