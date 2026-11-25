/**
 * A language's status with the stage it stands in, on one line.
 */
import { describe, expect, it } from "vitest";

import { statusWithStage } from "../language-stage";

describe("a language's status and its stage", () => {
  it("says the status, then the stage", () => {
    expect(statusWithStage("Draft", "In review")).toBe("Draft · In review");
  });

  it("says the status alone where the language stands in no stage", () => {
    expect(statusWithStage("Published", undefined)).toBe("Published");
  });

  it.each(["", "   "])(
    "says the status alone for a stage with no name (%j)",
    stage => {
      expect(statusWithStage("Published", stage)).toBe("Published");
    }
  );

  it("says the stage without the space around its label", () => {
    expect(statusWithStage("Draft", "  In review ")).toBe("Draft · In review");
  });
});
