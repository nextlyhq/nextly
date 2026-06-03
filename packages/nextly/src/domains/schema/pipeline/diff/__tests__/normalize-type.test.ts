import { describe, expect, it } from "vitest";

import { normalizeType } from "../normalize-type";

describe("normalizeType", () => {
  it("passes undefined through unchanged", () => {
    expect(normalizeType(undefined)).toBeUndefined();
  });

  it("treats PG internal integer aliases as equal", () => {
    // udt_name `int4` vs SQL `integer` vs `serial` (int4 + sequence).
    expect(normalizeType("int4")).toBe(normalizeType("integer"));
    expect(normalizeType("int4")).toBe(normalizeType("serial"));
    expect(normalizeType("int8")).toBe(normalizeType("bigint"));
    expect(normalizeType("int8")).toBe(normalizeType("bigserial"));
    expect(normalizeType("int2")).toBe(normalizeType("smallint"));
  });

  it("treats bool/boolean as equal", () => {
    expect(normalizeType("bool")).toBe(normalizeType("boolean"));
  });

  it("treats timestamptz / 'timestamp with time zone' as equal", () => {
    expect(normalizeType("timestamptz")).toBe(
      normalizeType("timestamp with time zone")
    );
    expect(normalizeType("timestamp")).toBe(
      normalizeType("timestamp without time zone")
    );
  });

  it("treats PG array notation `_text` and `text[]` as equal", () => {
    expect(normalizeType("_text")).toBe(normalizeType("text[]"));
    expect(normalizeType("_int4")).toBe(normalizeType("integer[]"));
  });

  it("strips length/precision modifiers the introspector can never see", () => {
    // The live side reads udt_name (`varchar`, no length), so comparing
    // length is impossible — both sides must collapse to the same token.
    expect(normalizeType("varchar")).toBe(normalizeType("varchar(255)"));
    expect(normalizeType("varchar")).toBe(normalizeType("varchar(16)"));
    expect(normalizeType("numeric")).toBe(normalizeType("numeric(10,2)"));
  });

  it("treats character-varying / varchar and char/bpchar as equal", () => {
    expect(normalizeType("varchar")).toBe(normalizeType("character varying"));
    expect(normalizeType("bpchar")).toBe(normalizeType("char"));
    expect(normalizeType("bpchar")).toBe(normalizeType("character"));
  });

  it("treats float aliases as equal", () => {
    expect(normalizeType("float8")).toBe(normalizeType("double precision"));
    expect(normalizeType("float4")).toBe(normalizeType("real"));
  });

  it("keeps genuinely different types distinct", () => {
    // These are real changes and MUST still diff.
    expect(normalizeType("varchar")).not.toBe(normalizeType("text"));
    expect(normalizeType("int4")).not.toBe(normalizeType("text"));
    expect(normalizeType("text")).not.toBe(normalizeType("text[]"));
    expect(normalizeType("int4")).not.toBe(normalizeType("numeric"));
  });

  it("is case-insensitive", () => {
    expect(normalizeType("INTEGER")).toBe(normalizeType("integer"));
    expect(normalizeType("Timestamp With Time Zone")).toBe(
      normalizeType("timestamptz")
    );
  });
});
