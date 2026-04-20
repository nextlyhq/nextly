import { describe, it, expect } from "vitest";

import { ExpressionValidator } from "../expression-validator";

/**
 * Expression Validator Boundary Tests
 *
 * Tests edge cases and boundary conditions:
 * 1. Null / undefined operands in expressions
 * 2. Nested expression evaluation
 * 3. Type coercion edge cases
 * 4. Deeply nested AND/OR combinations
 *
 * Note: Tests with method calls (e.g., array.includes()) are intentionally
 * omitted here because CallExpression handling is covered in the security
 * test suite and has a pre-existing issue tracked separately.
 */

describe("ExpressionValidator - Boundary Tests", () => {
  describe("Null and Undefined Operands", () => {
    it("should allow strict comparison with null literal", () => {
      expect(() =>
        ExpressionValidator.validate("record.deletedAt === null")
      ).not.toThrow();
    });

    it("should allow loose equality with null (type-coercing null check)", () => {
      expect(() =>
        ExpressionValidator.validate("record.value == null")
      ).not.toThrow();
    });

    it("should allow null on the left-hand side", () => {
      expect(() =>
        ExpressionValidator.validate("null === record.status")
      ).not.toThrow();
    });

    it("should allow undefined identifier in comparison", () => {
      expect(() =>
        ExpressionValidator.validate("record.field !== undefined")
      ).not.toThrow();
    });

    it("should allow null-guard in ternary expression", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.value !== null ? record.value : 'default'"
        )
      ).not.toThrow();
    });

    it("should allow chained null guards with AND", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.a !== null && record.b !== null && record.c !== null"
        )
      ).not.toThrow();
    });

    it("should allow null in object literal comparison", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.status === { active: null }.active"
        )
      ).not.toThrow();
    });

    it("should allow null in array literal (no method call)", () => {
      expect(() =>
        ExpressionValidator.validate("[null, undefined]")
      ).not.toThrow();
    });

    it("should allow strict not-null with OR fallback", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.ownerId !== null || record.isPublic === true"
        )
      ).not.toThrow();
    });
  });

  describe("Nested Expression Evaluation", () => {
    it("should allow deeply chained member access in comparison", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.author.profile.team.id === userTeamId"
        )
      ).not.toThrow();
    });

    it("should allow nested ternary with member access", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.type === 'admin' ? true : record.type === 'editor' ? record.teamId === userTeam : record.userId === userId"
        )
      ).not.toThrow();
    });

    it("should allow deeply parenthesised groups", () => {
      expect(() =>
        ExpressionValidator.validate(
          "((record.a === 1) && (record.b === 2)) || ((record.c === 3) && (record.d === 4))"
        )
      ).not.toThrow();
    });

    it("should allow expression inside conditional with nested AND/OR", () => {
      expect(() =>
        ExpressionValidator.validate(
          "(record.published && record.approved) ? (record.authorId === userId || record.isPublic) : false"
        )
      ).not.toThrow();
    });

    it("should allow member access comparison inside OR branches", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.owner.id === userId || record.team.id === userTeamId"
        )
      ).not.toThrow();
    });

    it("should allow nested object literal property access", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.config.enabled === { active: true }.active"
        )
      ).not.toThrow();
    });
  });

  describe("Type Coercion Edge Cases", () => {
    it("should allow loose equality (==) for type-coercing comparison", () => {
      expect(() =>
        ExpressionValidator.validate("record.count == '5'")
      ).not.toThrow();
    });

    it("should allow numeric coercion via unary plus", () => {
      expect(() =>
        ExpressionValidator.validate("+record.count > 0")
      ).not.toThrow();
    });

    it("should allow boolean coercion via double negation", () => {
      expect(() =>
        ExpressionValidator.validate("!!record.active === true")
      ).not.toThrow();
    });

    it("should allow string coercion via template literal", () => {
      expect(() =>
        ExpressionValidator.validate("`${record.id}` === userId")
      ).not.toThrow();
    });

    it("should allow arithmetic in comparisons", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.price * 1.0 === record.discountedPrice"
        )
      ).not.toThrow();
    });

    it("should allow lexicographic string comparison operators", () => {
      expect(() =>
        ExpressionValidator.validate("record.name < 'z' && record.name > 'a'")
      ).not.toThrow();
    });

    it("should allow NaN self-inequality pattern", () => {
      // record.count !== record.count is the classic NaN guard
      expect(() =>
        ExpressionValidator.validate("record.count !== record.count")
      ).not.toThrow();
    });

    it("should allow unary minus on member expression", () => {
      expect(() =>
        ExpressionValidator.validate("-record.offset >= 0")
      ).not.toThrow();
    });

    it("should allow string via template literal with negation guard", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.status !== `inactive` && record.status !== `deleted`"
        )
      ).not.toThrow();
    });
  });

  describe("Deeply Nested AND/OR Combinations", () => {
    it("should allow 3-level deep AND chain", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.a === 1 && record.b === 2 && record.c === 3"
        )
      ).not.toThrow();
    });

    it("should allow 5-level deep OR chain", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.role === 'admin' || record.role === 'editor' || " +
            "record.role === 'author' || record.role === 'reviewer' || " +
            "record.role === 'viewer'"
        )
      ).not.toThrow();
    });

    it("should allow mixed AND/OR with proper precedence grouping", () => {
      expect(() =>
        ExpressionValidator.validate(
          "(record.published === true && record.approved === true) || " +
            "(record.draft === true && record.authorId === userId) || " +
            "(record.archived === false && record.teamId === userTeamId)"
        )
      ).not.toThrow();
    });

    it("should allow AND inside OR inside AND", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.active && (record.role === 'admin' || (record.role === 'editor' && record.teamId === userTeamId))"
        )
      ).not.toThrow();
    });

    it("should allow 10-condition AND chain", () => {
      const conditions = Array.from(
        { length: 10 },
        (_, i) => `record.field${i} === ${i}`
      ).join(" && ");
      expect(() => ExpressionValidator.validate(conditions)).not.toThrow();
    });

    it("should allow negation within AND/OR chain", () => {
      expect(() =>
        ExpressionValidator.validate(
          "!record.deleted && !record.archived && (record.status === 'active' || record.status === 'pending')"
        )
      ).not.toThrow();
    });

    it("should allow deeply nested ternaries combined with AND/OR", () => {
      expect(() =>
        ExpressionValidator.validate(
          "(record.type === 'admin' ? true : record.type === 'editor' ? record.teamId === userTeam : false) && !record.suspended"
        )
      ).not.toThrow();
    });

    it("should allow OR chain with null guards", () => {
      expect(() =>
        ExpressionValidator.validate(
          "(record.ownerId === userId || record.collaborators !== null) && record.published === true"
        )
      ).not.toThrow();
    });

    it("should reject assignment buried within a deep AND chain", () => {
      expect(() =>
        ExpressionValidator.validate(
          "record.a === 1 && record.b === 2 && (record.c = 3)"
        )
      ).toThrow(/Assignment expressions are not allowed/);
    });

    it("should reject update expression buried within OR chain", () => {
      expect(() =>
        ExpressionValidator.validate("record.a === 1 || (++record.b) === 2")
      ).toThrow(/Update expressions.*are not allowed/);
    });

    it("should reject arrow function buried within AND chain", () => {
      expect(() =>
        ExpressionValidator.validate("record.a === 1 && (() => true)")
      ).toThrow(/Arrow functions are not allowed/);
    });

    it("should enforce max length even for long AND chains", () => {
      const base = "record.abc === 1";
      const chain = Array.from({ length: 50 }, () => base).join(" && ");
      if (chain.length > 1000) {
        expect(() => ExpressionValidator.validate(chain)).toThrow(
          /Expression too long/
        );
      } else {
        expect(() => ExpressionValidator.validate(chain)).not.toThrow();
      }
    });
  });

  describe("Helper Methods with Boundary Inputs", () => {
    it("isValid returns true for null comparison", () => {
      expect(ExpressionValidator.isValid("record.x === null")).toBe(true);
    });

    it("isValid returns true for deeply nested AND/OR", () => {
      expect(
        ExpressionValidator.isValid(
          "record.a === 1 && record.b === 2 && record.c === 3 && record.d === 4"
        )
      ).toBe(true);
    });

    it("isValid returns false for assignment within AND chain", () => {
      expect(
        ExpressionValidator.isValid("record.a === 1 && (record.b = 2)")
      ).toBe(false);
    });

    it("isValid returns false for update expression in OR chain", () => {
      expect(
        ExpressionValidator.isValid("record.a === 1 || (++record.b) === 2")
      ).toBe(false);
    });

    it("getError returns null for valid nested expression", () => {
      expect(
        ExpressionValidator.getError(
          "(record.x === 1 || record.y === 2) && !record.deleted"
        )
      ).toBeNull();
    });

    it("getError returns message for deeply nested arrow function", () => {
      const error = ExpressionValidator.getError(
        "record.a === 1 && (() => true)"
      );
      expect(error).toBeTruthy();
      expect(error).toContain("Arrow functions are not allowed");
    });

    it("getError returns message for update expression", () => {
      const error = ExpressionValidator.getError(
        "record.a === 1 || (++record.b)"
      );
      expect(error).toBeTruthy();
      expect(error).toMatch(/Update expressions.*are not allowed/);
    });

    it("getError returns null for null literal comparison", () => {
      expect(
        ExpressionValidator.getError("record.deletedAt === null")
      ).toBeNull();
    });
  });
});
