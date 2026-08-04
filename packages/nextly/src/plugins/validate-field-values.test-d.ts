/**
 * What a hand-authored declaration must carry.
 *
 * `.test.ts` files are outside the type-check program, so a claim about which
 * keys are admissible has to be asserted here to be checked at all.
 */
import { describe, expectTypeOf, it } from "vitest";

import type { FieldValueDeclaration } from "./validate-field-values";

describe("FieldValueDeclaration", () => {
  it("requires a name", () => {
    // The validator keys values by `name` and skips a field lacking one, so a
    // declaration that omitted it would pass every value unchecked.
    expectTypeOf<{ type: "text" }>().not.toMatchObjectType<
      Pick<FieldValueDeclaration, "name" | "type">
    >();
    expectTypeOf<FieldValueDeclaration["name"]>().toEqualTypeOf<string>();
  });

  it("admits a rule key and a plugin type's own option", () => {
    // Both are the point of the interface: a closed shape would refuse the
    // second, and a bare index signature would lose the first's type.
    expectTypeOf<{
      name: "title";
      type: "text";
      maxLength: 80;
      ratingScale: { max: 5 };
    }>().toExtend<FieldValueDeclaration>();
  });
});
