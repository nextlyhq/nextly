/**
 * Which variable paths a written email can store, as the check exported for
 * editors reads it: the same answer the document's own schema gives, names the
 * compiler keeps for itself and over-long paths included.
 */
import { describe, expect, it } from "vitest";

import { storableVariablePath } from "../../../api/email-template-preview-types";
import { COMPILER_NAMES, writtenDocumentSchema } from "../written/document";

/** Whether the document's schema accepts `path` as a chip's variable. */
function schemaAccepts(path: string): boolean {
  return writtenDocumentSchema.safeParse({
    version: 1,
    blocks: [{ type: "heading", text: [{ type: "chip", variable: path }] }],
  }).success;
}

describe("a variable path a written email can store", () => {
  const cases = [
    "name",
    "order.total",
    "item.price",
    "first-name",
    "customer.unit price",
    "9lives",
    ".total",
    COMPILER_NAMES.shown,
    `${COMPILER_NAMES.items}.price`,
    `a${".b".repeat(99)}`,
    `a${".b".repeat(100)}`,
  ];

  it("is what the document's schema accepts, case by case", () => {
    for (const path of cases) {
      expect(storableVariablePath(path), path).toBe(schemaAccepts(path));
    }
  });

  it("refuses the compiler's own names and paths over 200 characters", () => {
    expect(storableVariablePath("order.total")).toBe(true);
    expect(storableVariablePath(COMPILER_NAMES.shown)).toBe(false);
    expect(storableVariablePath(`${COMPILER_NAMES.items}.price`)).toBe(false);
    // 199 and 201 characters: the cap is 200.
    expect(storableVariablePath(`a${".b".repeat(99)}`)).toBe(true);
    expect(storableVariablePath(`a${".b".repeat(100)}`)).toBe(false);
    expect(storableVariablePath("first-name")).toBe(false);
  });
});
