import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { coerceDateFieldsToDate } from "../field-transform";

const dateField = (name: string): FieldConfig =>
  ({ name, type: "date" }) as unknown as FieldConfig;
const textField = (name: string): FieldConfig =>
  ({ name, type: "text" }) as unknown as FieldConfig;

describe("coerceDateFieldsToDate", () => {
  it("converts string values for date fields into Date instances", () => {
    const data: Record<string, unknown> = {
      publishedAt: "2026-05-20T12:22:29.417Z",
    };
    const fields = [dateField("publishedAt")];

    coerceDateFieldsToDate(data, fields);

    expect(data.publishedAt).toBeInstanceOf(Date);
    expect((data.publishedAt as Date).toISOString()).toBe(
      "2026-05-20T12:22:29.417Z"
    );
  });

  // Idempotency matters because singles' `update` flow can run the
  // helper across nested-component data that has already been coerced
  // upstream. A non-string `Date` must pass through untouched.
  it("leaves existing Date values unchanged", () => {
    const existing = new Date("2026-01-01T00:00:00.000Z");
    const data: Record<string, unknown> = { startsAt: existing };
    coerceDateFieldsToDate(data, [dateField("startsAt")]);
    expect(data.startsAt).toBe(existing);
  });

  it("ignores null and undefined values", () => {
    const data: Record<string, unknown> = {
      a: null,
      b: undefined,
    };
    coerceDateFieldsToDate(data, [dateField("a"), dateField("b")]);
    expect(data.a).toBeNull();
    expect(data.b).toBeUndefined();
  });

  it("does not touch non-date fields that happen to hold ISO strings", () => {
    const data: Record<string, unknown> = {
      title: "2026-05-20T12:22:29.417Z",
    };
    coerceDateFieldsToDate(data, [textField("title")]);
    expect(data.title).toBe("2026-05-20T12:22:29.417Z");
  });
});
