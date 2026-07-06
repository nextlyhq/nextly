/**
 * Plugin field types resolve to their declared storage column via the field-type
 * registry; an unregistered type falls back to a text column.
 *
 * @module domains/schema/services/field-column-descriptor.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../field-types/field-type-registry";
import { getColumnDescriptor } from "./field-column-descriptor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const field = (type: string) => ({ name: "content", type }) as any;

describe("getColumnDescriptor — plugin field types", () => {
  afterEach(() => clearFieldTypes());

  it("maps a registered plugin field type to its storage column (json)", () => {
    clearFieldTypes();
    registerFieldType({
      type: "page-builder",
      storage: "json",
      component: "@x/y#Z",
    });
    const d = getColumnDescriptor(field("page-builder"), "postgres");
    expect(d?.kind).toBe("json");
  });

  it("falls back to a text column for an unregistered field type", () => {
    clearFieldTypes();
    const d = getColumnDescriptor(field("page-builder"), "postgres");
    expect(d?.kind).toBe("text");
  });
});
