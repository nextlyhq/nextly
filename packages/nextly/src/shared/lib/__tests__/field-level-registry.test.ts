/**
 * Guards the field-level function registry: code-first `validate` /
 * `access` / `hooks` are dropped when field definitions are serialized to
 * the database, so this registry restores them by capturing the live
 * config. A regression would silently disable field access rules and hooks.
 */
import { afterEach, describe, expect, it } from "vitest";

import { validateEntryData } from "../entry-validation";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  attachFieldValidators,
  clearFieldFunctions,
  getFieldFunctions,
  registerFieldFunctions,
  runFieldHooks,
} from "../field-level-registry";

afterEach(() => clearFieldFunctions());

describe("field-level registry", () => {
  it("captures only function-bearing fields and replaces on re-register", () => {
    registerFieldFunctions("collection", "posts", [
      { name: "plain", type: "text" },
      { name: "secret", type: "text", access: { read: () => false } },
    ]);
    expect(Object.keys(getFieldFunctions("collection", "posts")!)).toEqual([
      "secret",
    ]);

    registerFieldFunctions("collection", "posts", [
      { name: "plain", type: "text" },
    ]);
    expect(getFieldFunctions("collection", "posts")).toBeUndefined();
  });

  it("write access strips denied fields silently; overrideAccess bypasses", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "internalScore",
        type: "number",
        access: {
          update: ({ req }: { req: { user?: { role?: string } } }) =>
            req.user?.role === "admin",
        },
      },
    ]);

    const data: Record<string, unknown> = { title: "t", internalScore: 9 };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { role: "editor" },
    });
    expect(data).toEqual({ title: "t" });

    const trusted: Record<string, unknown> = { internalScore: 9 };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: trusted,
      operation: "update",
      user: { role: "editor" },
      overrideAccess: true,
    });
    expect(trusted).toEqual({ internalScore: 9 });
  });

  it("read access strips denied fields and fails secure on throwing rules", async () => {
    registerFieldFunctions("collection", "posts", [
      { name: "hidden", type: "text", access: { read: () => false } },
      {
        name: "broken",
        type: "text",
        access: {
          read: () => {
            throw new Error("boom");
          },
        },
      },
    ]);
    const entry: Record<string, unknown> = {
      id: "1",
      title: "t",
      hidden: "x",
      broken: "y",
    };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
    });
    expect(entry).toEqual({ id: "1", title: "t" });
  });

  it("field hooks transform values in phase order", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "slugish",
        type: "text",
        hooks: {
          beforeChange: [
            ({ value }: { value: unknown }) => String(value).toLowerCase(),
            ({ value }: { value: unknown }) =>
              String(value).replace(/\s+/g, "-"),
          ],
        },
      },
    ]);
    const data: Record<string, unknown> = { slugish: "Hello World" };
    await runFieldHooks({
      kind: "collection",
      slug: "posts",
      phase: "beforeChange",
      data,
      operation: "create",
    });
    expect(data.slugish).toBe("hello-world");
  });

  it("attachFieldValidators makes registered custom validate run in the entry validator", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "code",
        type: "text",
        validate: (value: unknown) =>
          typeof value === "string" && value.startsWith("X")
            ? true
            : "Must start with X",
      },
    ]);
    // Serialized field defs carry no functions — exactly the registry's
    // reason to exist.
    const serializedFields = [{ name: "code", type: "text" }];
    const fields = attachFieldValidators(
      "collection",
      "posts",
      serializedFields
    );
    const issues = await validateEntryData({ code: "nope" }, fields, {
      mode: "create",
    });
    expect(issues).toEqual([
      { path: "code", code: "CUSTOM", message: "Must start with X." },
    ]);
  });

  it("evaluates each access rule against a snapshot, so order does not matter", async () => {
    // Rule on `b` reads `a`; rule on `a` denies. Whether `a` is deleted
    // first must not change `b`'s outcome.
    registerFieldFunctions("collection", "posts", [
      { name: "a", type: "text", access: { update: () => false } },
      {
        name: "b",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) =>
            data.a === "present",
        },
      },
    ]);
    const data: Record<string, unknown> = { a: "present", b: "keep" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    // `a` denied and removed; `b` allowed because the snapshot still had `a`.
    expect(data).toEqual({ b: "keep" });
  });

  it("enforces access rules for fields nested in groups and repeaters", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "meta",
        type: "group",
        fields: [
          { name: "secret", type: "text", access: { update: () => false } },
          { name: "public", type: "text" },
        ],
      },
      {
        name: "rows",
        type: "repeater",
        fields: [
          { name: "hidden", type: "text", access: { update: () => false } },
        ],
      },
    ]);
    const data: Record<string, unknown> = {
      meta: { secret: "x", public: "ok" },
      rows: [{ hidden: "a" }, { hidden: "b" }],
    };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    expect(data.meta).toEqual({ public: "ok" });
    expect(data.rows).toEqual([{}, {}]);
  });

  it("runs hooks for fields nested in groups and repeaters", async () => {
    const upper = {
      beforeChange: [
        ({ value }: { value: unknown }) => String(value).toUpperCase(),
      ],
    };
    registerFieldFunctions("collection", "posts", [
      {
        name: "meta",
        type: "group",
        fields: [{ name: "slug", type: "text", hooks: upper }],
      },
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "slug", type: "text", hooks: upper }],
      },
    ]);
    const data: Record<string, unknown> = {
      meta: { slug: "hi" },
      rows: [{ slug: "one" }, { slug: "two" }],
    };
    await runFieldHooks({
      kind: "collection",
      slug: "posts",
      phase: "beforeChange",
      data,
      operation: "update",
    });
    expect(data.meta).toEqual({ slug: "HI" });
    expect(data.rows).toEqual([{ slug: "ONE" }, { slug: "TWO" }]);
  });
});
