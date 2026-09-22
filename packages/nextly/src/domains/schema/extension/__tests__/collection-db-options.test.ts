/**
 * Per-collection database options.
 *
 * Each is small, and each has one edge worth a test: an id type that must not
 * change storage, a client id that must not be arbitrary, and a PostgreSQL
 * option that must neither be enforced nor silently swallowed elsewhere.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { uuidV7Timestamp } from "../../../../utils/uuid-v7";
import {
  assertUsableClientId,
  fieldProducesColumn,
  generateId,
  resolvePostgresSchema,
} from "../collection-db-options";

describe("id type", () => {
  it("generates a sortable id for uuidv7", () => {
    expect(uuidV7Timestamp(generateId("uuidv7"))).not.toBeNull();
  });

  it("generates a v4 for uuid, which does not decode a timestamp", () => {
    // The discriminator: a generator ignoring the option would pass the test
    // above and silently give every collection the same id shape.
    expect(uuidV7Timestamp(generateId("uuid"))).toBeNull();
  });

  it("keeps both at the same storage width", () => {
    // Why relations, the REST API and the admin are unaffected: only the
    // bytes differ, not the column.
    expect(generateId("uuid")).toHaveLength(36);
    expect(generateId("uuidv7")).toHaveLength(36);
  });
});

describe("client-supplied ids", () => {
  it("refuses one when the collection has not opted in", () => {
    expect(() => assertUsableClientId("x", false, "posts")).toThrow(
      NextlyError
    );
  });

  it("accepts a UUID when it has", () => {
    const id = "018f2c2e-0000-7000-8000-000000000000";
    expect(assertUsableClientId(id, true, "posts")).toBe(id);
  });

  it("accepts a v4 in a uuidv7 collection", () => {
    // Validated by SHAPE rather than version: a v4 sorts badly and is
    // otherwise correct, so refusing it would reject data that works.
    expect(() =>
      assertUsableClientId(
        "018f2c2e-0000-4000-8000-000000000000",
        true,
        "posts"
      )
    ).not.toThrow();
  });

  it("refuses an arbitrary string", () => {
    // Otherwise a caller could choose a key that collides with a future
    // generated one.
    expect(() => assertUsableClientId("hello", true, "posts")).toThrow(
      NextlyError
    );
    expect(() => assertUsableClientId(42, true, "posts")).toThrow(NextlyError);
  });
});

describe("virtual fields", () => {
  it("produce no column", () => {
    expect(fieldProducesColumn({ type: "text", virtual: true })).toBe(false);
  });

  it("leave ordinary fields alone", () => {
    expect(fieldProducesColumn({ type: "text" })).toBe(true);
    expect(fieldProducesColumn({ type: "text", virtual: false })).toBe(true);
  });
});

describe("the PostgreSQL schema option", () => {
  it("returns the name on PostgreSQL", () => {
    expect(resolvePostgresSchema("cms", "postgresql", () => undefined)).toBe(
      "cms"
    );
  });

  it("is ignored with a WARNING on the other dialects", () => {
    // Refusing would make one config file unusable across dialects, which
    // defeats a portable schema; ignoring it silently would leave an operator
    // believing their tables were namespaced.
    const warn = vi.fn();
    expect(resolvePostgresSchema("cms", "mysql", warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/ignored on mysql/);
  });

  it("says nothing when the option is unset", () => {
    const warn = vi.fn();
    expect(resolvePostgresSchema(undefined, "sqlite", warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a name PostgreSQL could not use", () => {
    expect(() =>
      resolvePostgresSchema("has spaces", "postgresql", () => undefined)
    ).toThrow(NextlyError);
  });
});
